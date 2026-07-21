import Phaser from "phaser";
import { AgentSprite, FRAME_H, LABEL_Y, BUBBLE_TIP_Y, IDLE_FRAMES, SPRITE_SCALE } from "./AgentSprite";
import type { Direction } from "./AgentSprite";

/**
 * Player-controlled character extending AgentSprite.
 *
 * Uses the same visual system (sprite animations, speech bubbles, opinion rings)
 * but replaces autonomous wandering with keyboard-driven movement and
 * proximity-based NPC interaction.
 */

const PLAYER_SPEED = 160; // px per second
// Conversational radius: how close the player needs to stand to an NPC for
// the proximity prompt to appear AND for the dwell-auto-talk timer to start.
// Bumped from 80 to 110 — the previous radius required pixel-perfect approach
// and made "walking up to someone" feel finicky.
const INTERACTION_RADIUS = 110;
// Auto-open chat after this many ms of standing within INTERACTION_RADIUS
// AND not actively moving. Mimics natural NPC interactions in adventure games.
// Set to 0 to disable.
const DWELL_AUTO_TALK_MS = 1200;
const LEGACY_PLAYER_SPRITE_SCALE = 4.4; // 16px frames × 4.4 ≈ 70px (matches 32px × 2.2)

interface PlayerConfig {
  id: string;
  name: string;
  initials: string;
  color: string;
  town: string;
  spriteKey?: string;
}

interface JoystickState {
  active: boolean;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  identifier: number | null;
}

export class PlayerSprite extends AgentSprite {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  // eKey listener is attached via `keydown-E` event; we hold a ref for cleanup.
  private eKey?: Phaser.Input.Keyboard.Key;
  private nearbyAgentId: string | null = null;
  private nearbySprite: AgentSprite | null = null;
  private wasMoving = false;
  private youBadge: Phaser.GameObjects.Container;
  private interactPrompt: Phaser.GameObjects.Container;
  private promptVisible = false;
  private promptPulseTween?: Phaser.Tweens.Tween;
  public inputEnabled = true;

  // Dwell-to-auto-talk state: when the player stands within INTERACTION_RADIUS
  // of an NPC AND is not actively moving, after DWELL_AUTO_TALK_MS we
  // automatically open the chat. Cleared on any movement or when the agent
  // leaves the radius.
  private dwellStartMs = 0;
  private dwellAutoFired = false;

  // Touch joystick
  private joystick: JoystickState = {
    active: false, originX: 0, originY: 0, dx: 0, dy: 0, identifier: null,
  };
  private joystickGraphics?: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: PlayerConfig) {
    super(scene, x, y, cfg);
    this.isPlayer = true;

    // Pick the right scale for whichever player sheet was loaded.
    if (this.bodySprite) {
      const isLegacy16 = cfg.spriteKey === "char-player";
      const scale = isLegacy16 ? LEGACY_PLAYER_SPRITE_SCALE : SPRITE_SCALE;
      this.bodySprite.setScale(scale);
      this.spriteBaseScale = scale;
    }

    // Enable physics body for tilemap collision
    scene.physics.world.enable(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (body) {
      body.setSize(24, 16);
      // Container bodies subtract displayOrigin (origin × setSize dims from
      // AgentSprite) during the physics sync, so a bare (-12, -8) offset put
      // the box ~(24, 47) px up-left of the sprite. Compensate with the
      // container's display origin so the 24×16 box sits centered on the feet.
      body.setOffset(this.displayOriginX - 12, this.displayOriginY - 8);
      body.setCollideWorldBounds(true);
    }

    // ── Keyboard setup ──────────────────────────────────────
    // CRITICAL: every addKey()/addKeys()/createCursorKeys() call defaults to
    // enableCapture=true, which Phaser implements as preventDefault() on the
    // matching browser keydown. That eats the keys before the focused chat
    // <input> can receive them — so typing W/A/S/D in the chat was impossible.
    //
    // We pass enableCapture=false to all of them. We still get Key.isDown
    // state for movement polling, but Phaser stops calling preventDefault, so
    // when the chat input is focused the same keystrokes also reach the DOM.
    // (updatePlayer additionally checks document.activeElement to skip moving
    //  while typing.)
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = scene.input.keyboard;
    if (kb) {
      kb.disableGlobalCapture();
      this.cursors = {
        up:    kb.addKey(KC.UP,    false),
        down:  kb.addKey(KC.DOWN,  false),
        left:  kb.addKey(KC.LEFT,  false),
        right: kb.addKey(KC.RIGHT, false),
        space: kb.addKey(KC.SPACE, false),
        shift: kb.addKey(KC.SHIFT, false),
      } as Phaser.Types.Input.Keyboard.CursorKeys;
      this.wasd = kb.addKeys("W,A,S,D", false) as any;
      this.eKey = kb.addKey(KC.E, false);
      kb.on("keydown-E", () => {
        // Guard: if the user is typing in a text field, E is their input
        // character, not an interaction command.
        const active = document.activeElement;
        const typing = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || (active as HTMLElement).isContentEditable);
        if (typing) return;
        this.onInteract();
      });
    }

    // ── "YOU" badge ─────────────────────────────────────────
    this.youBadge = this.createYouBadge(scene);
    this.add(this.youBadge);

    // ── "Press E" interaction prompt ────────────────────────
    this.interactPrompt = this.createInteractPrompt(scene);
    this.interactPrompt.setVisible(false);
    this.interactPrompt.setAlpha(0);
    this.add(this.interactPrompt);

    // ── Touch joystick (mobile) ─────────────────────────────
    if (typeof window !== "undefined" && "ontouchstart" in window) {
      this.setupTouchJoystick(scene);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // "YOU" Badge — polished civic-blue capsule below name label
  // ──────────────────────────────────────────────────────────────

  private createYouBadge(scene: Phaser.Scene): Phaser.GameObjects.Container {
    const badge = scene.add.container(0, LABEL_Y + 14);

    const bg = scene.add.graphics();
    const w = 28, h = 14, r = 7;
    // Drop shadow
    bg.fillStyle(0x000000, 0.15);
    bg.fillRoundedRect(-w / 2 + 1, 1, w, h, r);
    // Gradient-like fill (lighter top, darker bottom)
    bg.fillStyle(0x4a7abf, 1);
    bg.fillRoundedRect(-w / 2, 0, w, h, r);
    bg.fillStyle(0x3b5998, 1);
    bg.fillRoundedRect(-w / 2, h * 0.4, w, h * 0.6, { tl: 0, tr: 0, bl: r, br: r });
    // Subtle highlight at top
    bg.fillStyle(0xffffff, 0.15);
    bg.fillRoundedRect(-w / 2 + 2, 1, w - 4, 5, { tl: r - 2, tr: r - 2, bl: 0, br: 0 });

    const text = scene.add.text(0, h / 2, "YOU", {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "7px",
      fontStyle: "bold",
      color: "#ffffff",
      resolution: 2,
    });
    text.setOrigin(0.5, 0.5);

    badge.add([bg, text]);

    // Gentle float tween distinct from idle bob
    scene.tweens.add({
      targets: badge,
      y: LABEL_Y + 13,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    return badge;
  }

  // ──────────────────────────────────────────────────────────────
  // "Press E" Interaction Prompt
  // ──────────────────────────────────────────────────────────────

  private createInteractPrompt(scene: Phaser.Scene): Phaser.GameObjects.Container {
    // Significantly larger + more aesthetic than v1 — the previous prompt was
    // 52×20 with a 9px font that disappeared next to the NPC. This version is
    // 86×26 with bigger key caps and a soft warm halo behind it.
    const prompt = scene.add.container(0, BUBBLE_TIP_Y - 22);

    // Soft warm halo (a layered glow that anchors the prompt visually so it
    // never gets lost against the building behind the NPC).
    const halo = scene.add.graphics();
    halo.fillStyle(0xffe4b5, 0.16);
    halo.fillCircle(0, 0, 32);
    halo.fillStyle(0xffe4b5, 0.10);
    halo.fillCircle(0, 0, 44);
    prompt.add(halo);

    // Capsule background — slightly larger, warmer black with a gold border.
    const bg = scene.add.graphics();
    const w = 86, h = 26, r = 13;
    bg.fillStyle(0x0e0e0e, 0.88);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    // Inset highlight
    bg.fillStyle(0xffffff, 0.05);
    bg.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, 8, { tl: r - 2, tr: r - 2, bl: 0, br: 0 });
    // Gold border
    bg.lineStyle(1.2, 0xc4a35a, 0.85);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    prompt.add(bg);

    // "E" key cap — chunkier, with a soft drop shadow.
    const keyCap = scene.add.graphics();
    const kx = -34, ky = -9, kw = 18, kh = 18;
    keyCap.fillStyle(0x000000, 0.45);
    keyCap.fillRoundedRect(kx, ky + 2, kw, kh, 4);
    keyCap.fillStyle(0xffffff, 0.96);
    keyCap.fillRoundedRect(kx, ky, kw, kh, 4);
    keyCap.fillStyle(0xffffff, 0.25);
    keyCap.fillRoundedRect(kx + 1, ky, kw - 2, 5, { tl: 3, tr: 3, bl: 0, br: 0 });
    keyCap.lineStyle(0.8, 0xb8a983, 0.7);
    keyCap.strokeRoundedRect(kx, ky, kw, kh, 4);
    prompt.add(keyCap);

    const eText = scene.add.text(kx + kw / 2, 0, "E", {
      fontFamily: "Inter, monospace",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#1a1a1a",
      resolution: 2,
    });
    eText.setOrigin(0.5, 0.5);
    prompt.add(eText);

    const talkText = scene.add.text(kx + kw + 6, 0, "Talk", {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "11px",
      fontStyle: "bold",
      color: "#fff7e0",
      resolution: 2,
    });
    talkText.setOrigin(0, 0.5);
    prompt.add(talkText);

    // Auto-talk dwell hint (tiny progress dots that fill as the player stands still).
    // We draw three dots; PlayerSprite.update will tween their alpha based on dwell time.
    const dotsContainer = scene.add.container(28, 0);
    for (let i = 0; i < 3; i++) {
      const d = scene.add.graphics();
      d.fillStyle(0xc4a35a, 0.45);
      d.fillCircle(i * 6, 0, 1.6);
      dotsContainer.add(d);
    }
    dotsContainer.setName("dwellDots");
    prompt.add(dotsContainer);

    prompt.setDepth(500);
    return prompt;
  }

  private showInteractPrompt() {
    if (this.promptVisible) return;
    this.promptVisible = true;
    this.interactPrompt.setVisible(true);
    this.interactPrompt.setScale(0.7);
    this.interactPrompt.setAlpha(0);

    this.scene.tweens.add({
      targets: this.interactPrompt,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 180,
      ease: "Back.easeOut",
    });

    this.promptPulseTween = this.scene.tweens.add({
      targets: this.interactPrompt,
      scaleX: { from: 0.97, to: 1.03 },
      scaleY: { from: 0.97, to: 1.03 },
      alpha: { from: 0.85, to: 1.0 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: 200,
    });
  }

  private hideInteractPrompt() {
    if (!this.promptVisible) return;
    this.promptVisible = false;
    this.promptPulseTween?.stop();
    this.promptPulseTween = undefined;

    this.scene.tweens.add({
      targets: this.interactPrompt,
      alpha: 0,
      scaleX: 0.8,
      scaleY: 0.8,
      duration: 120,
      ease: "Quad.easeIn",
      onComplete: () => {
        this.interactPrompt.setVisible(false);
      },
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Touch joystick
  // ──────────────────────────────────────────────────────────────

  private setupTouchJoystick(scene: Phaser.Scene) {
    const radius = 60;
    this.joystickGraphics = scene.add.graphics();
    this.joystickGraphics.setScrollFactor(0);
    // Screen-space UI — above the sky tint (6000) and lamp glows (6001).
    this.joystickGraphics.setDepth(7000);
    this.joystickGraphics.setVisible(false);

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.joystick.active) return;
      // Lower-left quadrant of the canvas
      if (p.x > scene.scale.width * 0.4 || p.y < scene.scale.height * 0.5) return;
      this.joystick.active = true;
      this.joystick.originX = p.x;
      this.joystick.originY = p.y;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.joystick.identifier = p.id;
      this.drawJoystick(radius);
    });

    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.joystick.active || p.id !== this.joystick.identifier) return;
      const dx = p.x - this.joystick.originX;
      const dy = p.y - this.joystick.originY;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        this.joystick.dx = (dx / len) * radius;
        this.joystick.dy = (dy / len) * radius;
      } else {
        this.joystick.dx = dx;
        this.joystick.dy = dy;
      }
      this.drawJoystick(radius);
    });

    const release = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.joystick.identifier) return;
      this.joystick.active = false;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.joystick.identifier = null;
      this.joystickGraphics?.setVisible(false);
    };
    scene.input.on("pointerup", release);
    scene.input.on("pointerupoutside", release);
  }

  private drawJoystick(radius: number) {
    const g = this.joystickGraphics;
    if (!g) return;
    g.clear();
    g.setVisible(true);
    // Outer ring
    g.lineStyle(2, 0xffffff, 0.35);
    g.strokeCircle(this.joystick.originX, this.joystick.originY, radius);
    g.fillStyle(0x000000, 0.18);
    g.fillCircle(this.joystick.originX, this.joystick.originY, radius);
    // Knob
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(
      this.joystick.originX + this.joystick.dx,
      this.joystick.originY + this.joystick.dy,
      radius * 0.35,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Frame update — keyboard movement + proximity detection
  // ──────────────────────────────────────────────────────────────

  updatePlayer(_delta: number) {
    const body = this.body as Phaser.Physics.Arcade.Body | undefined;

    // Skip movement if input is disabled or a text field is focused
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (!this.inputEnabled || typing) {
      body?.setVelocity(0, 0);
      if (this.wasMoving) {
        this.wasMoving = false;
        this.playIdle(this.currentDirection);
        this.beginIdle();
      }
      this.syncDepth();
      this.checkProximity();
      return;
    }

    // Read input
    let vx = 0, vy = 0;
    if (this.cursors?.left.isDown || this.wasd?.A.isDown) vx -= 1;
    if (this.cursors?.right.isDown || this.wasd?.D.isDown) vx += 1;
    if (this.cursors?.up.isDown || this.wasd?.W.isDown) vy -= 1;
    if (this.cursors?.down.isDown || this.wasd?.S.isDown) vy += 1;

    // Joystick override
    if (this.joystick.active) {
      const max = 60;
      vx = this.joystick.dx / max;
      vy = this.joystick.dy / max;
    }

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0 && !this.joystick.active) {
      const inv = 1 / Math.SQRT2;
      vx *= inv;
      vy *= inv;
    }

    const moving = Math.abs(vx) > 0.08 || Math.abs(vy) > 0.08;

    if (moving) {
      // Stop idle tween if we were standing
      if (!this.wasMoving) {
        this.idleTween?.stop();
        this.bodySprite?.setScale(this.spriteBaseScale);
        this.shadowTween?.stop();
        this.groundShadow.setScale(1);
      }

      // Determine facing direction
      const newDir: Direction =
        Math.abs(vx) > Math.abs(vy)
          ? vx > 0 ? "right" : "left"
          : vy > 0 ? "down" : "up";

      if (newDir !== this.currentDirection || !this.wasMoving) {
        this.currentDirection = newDir;
        this.playWalk(this.currentDirection);
      }

      // Velocity-based movement (respects physics collision)
      if (body) {
        body.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
      } else {
        // Fallback: direct position (no physics body)
        const speed = PLAYER_SPEED * (_delta / 1000);
        this.x = Phaser.Math.Clamp(this.x + vx * speed, 40, 1160);
        this.y = Phaser.Math.Clamp(this.y + vy * speed, 40, 760);
      }
      this.homeY = this.y;

      this.wasMoving = true;
    } else {
      body?.setVelocity(0, 0);
      if (this.wasMoving) {
        // Just stopped — play idle
        this.wasMoving = false;
        this.playIdle(this.currentDirection);
        this.beginIdle();
      }
    }

    this.syncDepth();
    this.checkProximity();
  }

  // ──────────────────────────────────────────────────────────────
  // Proximity detection
  // ──────────────────────────────────────────────────────────────

  private checkProximity() {
    const townScene = this.scene as any;
    if (!townScene.getNearbyAgent) return;

    const result = townScene.getNearbyAgent(this.x, this.y, INTERACTION_RADIUS);
    const newId = result?.agentId ?? null;

    if (newId !== this.nearbyAgentId) {
      // Clear previous highlight
      if (this.nearbySprite) {
        this.nearbySprite.setProximityHighlight(false);
        this.nearbySprite = null;
      }
      this.nearbyAgentId = newId;
      // Reset the dwell timer whenever the nearby agent changes.
      this.dwellStartMs = 0;
      this.dwellAutoFired = false;

      if (result) {
        this.nearbySprite = result.sprite;
        result.sprite.setProximityHighlight(true);
        this.showInteractPrompt();
      } else {
        this.hideInteractPrompt();
      }

      // Emit to React
      this.scene.events.emit("proximity-agent", newId);
    }

    // Dwell-to-auto-talk: while standing still inside the radius, count up.
    // Movement (this.wasMoving) resets the timer. Typing in a text field
    // also pauses dwell so the chat can't reopen itself while the user types.
    const activeEl = document.activeElement;
    const typingNow = !!activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || (activeEl as HTMLElement).isContentEditable);
    if (
      this.nearbyAgentId &&
      this.inputEnabled &&
      !this.wasMoving &&
      !this.dwellAutoFired &&
      !typingNow &&
      DWELL_AUTO_TALK_MS > 0
    ) {
      const now = this.scene.time.now;
      if (this.dwellStartMs === 0) {
        this.dwellStartMs = now;
      } else if (now - this.dwellStartMs >= DWELL_AUTO_TALK_MS) {
        // Auto-open chat as if the player pressed E.
        this.dwellAutoFired = true;
        this.onInteract();
      }
      // Visual progress: the three dots in the prompt fill left-to-right so
      // the player can see the auto-talk timer counting down.
      this.renderDwellProgress((now - this.dwellStartMs) / DWELL_AUTO_TALK_MS);
    } else {
      if (this.wasMoving) {
        // Reset while moving so the user can pass by without triggering.
        this.dwellStartMs = 0;
      }
      this.renderDwellProgress(0);
    }
  }

  /** Fill the three dwell-progress dots left-to-right based on `progress` (0..1). */
  private renderDwellProgress(progress: number) {
    const dots = this.interactPrompt.getByName("dwellDots") as Phaser.GameObjects.Container | null;
    if (!dots) return;
    const p = Phaser.Math.Clamp(progress, 0, 1);
    const children = dots.list as Phaser.GameObjects.GameObject[];
    for (let i = 0; i < children.length; i++) {
      // Each dot owns 1/N of the progress bar; alpha rises from 0.25 → 1.0
      // as the bar fills past it.
      const local = Phaser.Math.Clamp(p * children.length - i, 0, 1);
      const alpha = 0.25 + 0.75 * local;
      (children[i] as Phaser.GameObjects.Graphics).setAlpha(alpha);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // E key interaction
  // ──────────────────────────────────────────────────────────────

  private onInteract() {
    if (!this.nearbyAgentId || !this.inputEnabled) return;

    if (this.nearbySprite) {
      // Player faces the NPC, NPC faces back + takes a step toward us.
      this.faceToward(this.nearbySprite.x, this.nearbySprite.y);
      this.nearbySprite.respondToInteractRequest(this.x, this.y);
    }

    this.scene.events.emit("player-interact", this.nearbyAgentId);
  }

  override destroy(fromScene?: boolean) {
    this.promptPulseTween?.stop();
    this.joystickGraphics?.destroy();
    super.destroy(fromScene);
  }
}


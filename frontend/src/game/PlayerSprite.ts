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
const INTERACTION_RADIUS = 80; // px — conversational distance
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
      body.setOffset(-12, -8); // center on feet
      body.setCollideWorldBounds(true);
    }

    // ── Keyboard setup ──────────────────────────────────────
    // Disable global capture so keys pass through to DOM inputs (chat bar).
    const kb = scene.input.keyboard;
    if (kb) {
      kb.disableGlobalCapture();
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys("W,A,S,D") as any;
      this.eKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      kb.on("keydown-E", () => this.onInteract());
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
    const prompt = scene.add.container(0, BUBBLE_TIP_Y - 18);

    // Background capsule
    const bg = scene.add.graphics();
    const w = 52, h = 20, r = 10;
    bg.fillStyle(0x1a1a1a, 0.78);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    // Subtle border
    bg.lineStyle(0.5, 0xffffff, 0.12);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);

    // "E" key cap
    const keyCap = scene.add.graphics();
    const kx = -12, ky = -6, kw = 14, kh = 13;
    // Key shadow (inset feel)
    keyCap.fillStyle(0x333333, 0.6);
    keyCap.fillRoundedRect(kx, ky + 1, kw, kh, 3);
    // Key face
    keyCap.fillStyle(0xffffff, 0.92);
    keyCap.fillRoundedRect(kx, ky, kw, kh, 3);
    // Subtle top highlight
    keyCap.fillStyle(0xffffff, 0.15);
    keyCap.fillRoundedRect(kx + 1, ky, kw - 2, 4, { tl: 2, tr: 2, bl: 0, br: 0 });

    const eText = scene.add.text(-5, 0, "E", {
      fontFamily: "Inter, monospace",
      fontSize: "9px",
      fontStyle: "bold",
      color: "#1a1a1a",
      resolution: 2,
    });
    eText.setOrigin(0.5, 0.5);

    const talkText = scene.add.text(12, 0, "Talk", {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "9px",
      color: "#ffffff",
      resolution: 2,
    });
    talkText.setOrigin(0, 0.5);
    talkText.setAlpha(0.65);

    prompt.add([bg, keyCap, eText, talkText]);
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
    this.joystickGraphics.setDepth(2000);
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


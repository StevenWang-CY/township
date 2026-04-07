import Phaser from "phaser";
import { AgentSprite, FRAME_H, LABEL_Y, BUBBLE_TIP_Y, IDLE_FRAMES } from "./AgentSprite";
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
const PLAYER_SPRITE_SCALE = 4.4; // 16px frames × 4.4 ≈ 70px (matches 32px × 2.2)

interface PlayerConfig {
  id: string;
  name: string;
  initials: string;
  color: string;
  town: string;
  spriteKey?: string;
}

export class PlayerSprite extends AgentSprite {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private eKey!: Phaser.Input.Keyboard.Key;
  private nearbyAgentId: string | null = null;
  private nearbySprite: AgentSprite | null = null;
  private wasMoving = false;
  private youBadge: Phaser.GameObjects.Container;
  private interactPrompt: Phaser.GameObjects.Container;
  private promptVisible = false;
  private promptPulseTween?: Phaser.Tweens.Tween;
  public inputEnabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: PlayerConfig) {
    super(scene, x, y, cfg);
    this.isPlayer = true;

    // Override sprite scale for 16px player.png frames
    if (this.charSprite && cfg.spriteKey === "char-player") {
      this.charSprite.setScale(PLAYER_SPRITE_SCALE);
    }
    this.spriteBaseScale = PLAYER_SPRITE_SCALE;

    // Enable physics body for tilemap collision
    scene.physics.world.enable(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (body) {
      body.setSize(24, 16);
      body.setOffset(-12, -8); // center on feet
      body.setCollideWorldBounds(true);
    }

    // ── Keyboard setup ──────────────────────────────────────
    const kb = scene.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      // Release Space capture so it can be typed in DOM inputs (chat bar)
      kb.removeCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);
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

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const inv = 1 / Math.SQRT2;
      vx *= inv;
      vy *= inv;
    }

    const moving = vx !== 0 || vy !== 0;

    if (moving) {
      // Stop idle tween if we were standing
      if (!this.wasMoving) {
        this.idleTween?.stop();
        this.charSprite?.setScale(this.spriteBaseScale);
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

    // Face the target agent
    if (this.nearbySprite) {
      const dx = this.nearbySprite.x - this.x;
      const dy = this.nearbySprite.y - this.y;
      this.currentDirection = Math.abs(dx) > Math.abs(dy)
        ? dx > 0 ? "right" : "left"
        : dy > 0 ? "down" : "up";
      this.playIdle(this.currentDirection);

      // Make the NPC face the player too
      const npcDir: Direction = Math.abs(dx) > Math.abs(dy)
        ? dx > 0 ? "left" : "right"
        : dy > 0 ? "up" : "down";
      this.nearbySprite.currentDirection = npcDir;
      // Force idle in the new direction — use the public moveToPosition to self
      // to trigger the idle frame without actually moving
      if (this.nearbySprite.usingSpritesheet) {
        // Access the sprite's idle method via the scene event workaround:
        // We trigger a tiny move that resolves immediately, which resets facing
        this.nearbySprite.moveToPosition(
          this.nearbySprite.x,
          this.nearbySprite.y,
        );
      }
    }

    this.scene.events.emit("player-interact", this.nearbyAgentId);
  }

  override destroy(fromScene?: boolean) {
    this.promptPulseTween?.stop();
    super.destroy(fromScene);
  }
}

import Phaser from "phaser";

/**
 * Spritesheet layout: 96 × 128 px → 3 cols × 4 rows → 12 frames (32×32 each)
 *
 *  Row 0  frames  0-2  →  walk DOWN
 *  Row 1  frames  3-5  →  walk LEFT
 *  Row 2  frames  6-8  →  walk RIGHT
 *  Row 3  frames  9-11 →  walk UP
 *
 * Frame 1 / 4 / 7 / 10  =  mid-stride "stand" pose per direction.
 */

export const SPRITE_SCALE = 2.2;          // 32 × 2.2 ≈ 70 px display height
export const FRAME_H = 32 * SPRITE_SCALE; // ~70 px – sprite top to feet
export const SHADOW_Y = 4;                // px below feet (container y=0 = feet)
export const LABEL_Y = 12;                // name tag below feet
export const BUBBLE_TIP_Y = -(FRAME_H + 8); // speech-bubble pointer just above head
export const WALK_FPS = 9;
export const IDLE_FRAMES: Record<string, number> = { down: 1, left: 4, right: 7, up: 10 };

export type Direction = "down" | "left" | "right" | "up";

interface AgentConfig {
  id: string;
  name: string;
  initials: string;
  color: string;
  town: string;
  opinionColor?: string;
  spriteKey?: string;
}

export class AgentSprite extends Phaser.GameObjects.Container {
  protected charSprite?: Phaser.GameObjects.Sprite;
  private fallbackBody?: Phaser.GameObjects.Graphics;
  private initialsText?: Phaser.GameObjects.Text;
  protected groundShadow: Phaser.GameObjects.Ellipse;
  private opinionRing: Phaser.GameObjects.Graphics;
  protected nameLabel: Phaser.GameObjects.Text;
  private bubbleGroup: Phaser.GameObjects.Container;
  private bubbleBg: Phaser.GameObjects.Graphics;
  private bubbleText: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  protected idleTween?: Phaser.Tweens.Tween;
  protected shadowTween?: Phaser.Tweens.Tween;
  private moveTween?: Phaser.Tweens.Tween;

  // Proximity highlight layers
  private proxGlow?: Phaser.GameObjects.Graphics;
  private proxTweens: Phaser.Tweens.Tween[] = [];

  public agentId: string;
  public agentName: string;
  public townId: string;
  private agentColor: string;
  private opinionColor: string;
  public usingSpritesheet = false;
  public currentDirection: Direction = "down";
  protected isMoving = false;
  protected isPlayer = false;
  protected homeY = 0; // base Y for idle bob

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: AgentConfig) {
    super(scene, x, y);

    this.agentId = cfg.id;
    this.agentName = cfg.name;
    this.townId = cfg.town;
    this.agentColor = cfg.color;
    this.opinionColor = cfg.opinionColor ?? "#FFFFFF";
    this.homeY = y;

    // ── Ground shadow ellipse ────────────────────────────────
    this.groundShadow = scene.add.ellipse(0, SHADOW_Y, 36, 12, 0x000000, 0.2);
    this.add(this.groundShadow);

    // ── Opinion ring ─────────────────────────────────────────
    this.opinionRing = scene.add.graphics();
    this.redrawRing();
    this.add(this.opinionRing);

    // ── Character sprite / fallback circle ───────────────────
    if (cfg.spriteKey && scene.textures.exists(cfg.spriteKey)) {
      this.charSprite = scene.add.sprite(0, 0, cfg.spriteKey, IDLE_FRAMES.down);
      this.charSprite.setScale(SPRITE_SCALE);
      // origin (0.5, 1) → feet perfectly at container origin (y = 0)
      this.charSprite.setOrigin(0.5, 1);
      this.add(this.charSprite);
      this.usingSpritesheet = true;
    } else {
      this.fallbackBody = scene.add.graphics();
      this.drawFallback();
      this.add(this.fallbackBody);

      const initials = cfg.initials.slice(0, 2);
      this.initialsText = scene.add.text(0, -FRAME_H * 0.5, initials, {
        fontFamily: "monospace",
        fontSize: "12px",
        fontStyle: "bold",
        color: "#fff",
        resolution: 2,
      });
      this.initialsText.setOrigin(0.5, 0.5);
      this.add(this.initialsText);
    }

    // ── Name tag ─────────────────────────────────────────────
    const first = cfg.name.split(/[\s"'&]/)[0];
    this.nameLabel = scene.add.text(0, LABEL_Y, first, {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "9px",
      fontStyle: "bold",
      color: "#ffffff",
      stroke: "#111111",
      strokeThickness: 3,
      resolution: 2,
    });
    this.nameLabel.setOrigin(0.5, 0);
    this.add(this.nameLabel);

    // ── Speech bubble ─────────────────────────────────────────
    this.bubbleGroup = scene.add.container(0, 0);
    this.bubbleBg = scene.add.graphics();
    this.bubbleText = scene.add.text(0, BUBBLE_TIP_Y - 10, "", {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "9px",
      color: "#1a1a1a",
      align: "center",
      wordWrap: { width: 135, useAdvancedWrap: true },
      lineSpacing: 1,
      resolution: 2,
    });
    this.bubbleText.setOrigin(0.5, 1);
    this.bubbleGroup.add([this.bubbleBg, this.bubbleText]);
    this.bubbleGroup.setVisible(false);
    this.add(this.bubbleGroup);

    // ── Interaction ──────────────────────────────────────────
    this.setSize(48, FRAME_H + LABEL_Y + 12);
    this.setInteractive({ cursor: "pointer" });

    this.on("pointerover", () => {
      if (this.isMoving) return;
      scene.tweens.add({ targets: this, scaleX: 1.1, scaleY: 1.1, duration: 110, ease: "Back.easeOut" });
      this.nameLabel.setColor("#FFD700");
    });
    this.on("pointerout", () => {
      scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 110, ease: "Back.easeOut" });
      this.nameLabel.setColor("#ffffff");
    });
    this.on("pointerdown", () => {
      if (!this.isPlayer) {
        scene.events.emit("agent-clicked", this.agentId);
      }
      scene.tweens.add({ targets: this, scaleX: 0.9, scaleY: 0.9, duration: 65, yoyo: true, ease: "Quad.easeOut" });
    });

    scene.add.existing(this);
    this.syncDepth();
    this.beginIdle();
  }

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  /** Called every frame by TownScene to keep depth sorted by Y. */
  syncDepth() {
    this.setDepth(100 + Math.floor(this.y));
  }

  /**
   * Smoothly move to world position (tx, ty).
   * Plays the correct walk animation, shadow squish, and calls onComplete when done.
   */
  moveToPosition(tx: number, ty: number, onComplete?: () => void) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) {
      onComplete?.();
      return;
    }

    // Pick the dominant direction for facing
    this.currentDirection =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0 ? "right" : "left"
        : dy > 0 ? "down" : "up";

    this.isMoving = true;
    this.idleTween?.stop();
    this.shadowTween?.stop();
    this.moveTween?.stop();

    // Walk animation
    this.playWalk(this.currentDirection);

    // Shadow squish while walking
    this.shadowTween = this.scene.tweens.add({
      targets: this.groundShadow,
      scaleX: 1.45,
      scaleY: 0.6,
      duration: 260,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Duration: ~3 px / ms → faster for short hops, capped
    const duration = Phaser.Math.Clamp(dist * 3.8, 600, 2800);

    this.moveTween = this.scene.tweens.add({
      targets: this,
      x: tx,
      y: ty,
      duration,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        this.syncDepth();
        this.homeY = this.y;
      },
      onComplete: () => {
        this.isMoving = false;
        this.setScale(1);
        this.shadowTween?.stop();
        this.groundShadow.setScale(1);
        this.playIdle(this.currentDirection);
        this.beginIdle();
        onComplete?.();
      },
    });
  }

  /** Show a Smallville-style speech bubble. Auto-hides after `duration` ms. */
  showSpeechBubble(text: string, duration = 5000) {
    const t = text.length > 85 ? text.slice(0, 82) + "…" : text;
    this.bubbleText.setText(t);

    const pad = 10;
    const bw = Math.max(this.bubbleText.width + pad * 2, 55);
    const bh = this.bubbleText.height + pad * 2;
    const bx = -bw / 2;
    const bodyTop = BUBBLE_TIP_Y - bh - 8;
    const tailBase = bodyTop + bh;

    this.bubbleBg.clear();

    // Drop shadow
    this.bubbleBg.fillStyle(0x000000, 0.13);
    this.bubbleBg.fillRoundedRect(bx + 3, bodyTop + 3, bw, bh, 9);

    // White body
    this.bubbleBg.fillStyle(0xffffff, 0.97);
    this.bubbleBg.fillRoundedRect(bx, bodyTop, bw, bh, 9);

    // Subtle border
    this.bubbleBg.lineStyle(1.5, 0xbbbbbb, 0.9);
    this.bubbleBg.strokeRoundedRect(bx, bodyTop, bw, bh, 9);

    // Tail (pointer pointing down to agent head)
    this.bubbleBg.fillStyle(0xffffff, 0.97);
    this.bubbleBg.fillTriangle(-7, tailBase, 7, tailBase, 0, BUBBLE_TIP_Y);
    // Cover the seam between tail and body
    this.bubbleBg.lineStyle(2, 0xffffff, 1);
    this.bubbleBg.lineBetween(-6, tailBase, 6, tailBase);
    // Tail side outlines
    this.bubbleBg.lineStyle(1.5, 0xbbbbbb, 0.8);
    this.bubbleBg.strokeTriangle(-7, tailBase, 7, tailBase, 0, BUBBLE_TIP_Y + 2);

    this.bubbleGroup.setVisible(true);
    this.bubbleGroup.setDepth(400);
    this.bubbleGroup.setScale(0.55);
    this.bubbleGroup.setAlpha(0);

    this.scene.tweens.add({
      targets: this.bubbleGroup,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 230,
      ease: "Back.easeOut",
    });

    this.bubbleTimer?.remove();
    this.bubbleTimer = this.scene.time.delayedCall(duration, () => {
      this.scene.tweens.add({
        targets: this.bubbleGroup,
        alpha: 0,
        scaleX: 0.75,
        scaleY: 0.75,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => {
          this.bubbleGroup.setVisible(false);
          this.bubbleGroup.setScale(1);
        },
      });
    });
  }

  setOpinionColor(color: string) {
    this.opinionColor = color;
    this.redrawRing();

    // Ripple burst from agent
    const c = Phaser.Display.Color.HexStringToColor(color).color;
    const ripple = this.scene.add.graphics();
    ripple.lineStyle(4, c, 0.75);
    ripple.strokeCircle(this.x, this.y - FRAME_H * 0.5, 22);
    this.scene.tweens.add({
      targets: ripple,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 550,
      ease: "Quad.easeOut",
      onComplete: () => ripple.destroy(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  protected playWalk(dir: Direction) {
    if (!this.usingSpritesheet || !this.charSprite) return;
    const key = `${this.charSprite.texture.key}-walk-${dir}`;
    if (this.scene.anims.exists(key)) this.charSprite.play(key, true);
  }

  protected playIdle(dir: Direction) {
    if (!this.usingSpritesheet || !this.charSprite) return;
    // Stop any running anim and set the stand pose for this direction
    this.charSprite.stop();
    this.charSprite.setFrame(IDLE_FRAMES[dir]);
  }

  /** Gentle vertical bob + shadow breath when standing still. */
  protected beginIdle() {
    this.playIdle(this.currentDirection);

    const period = 1300 + Math.random() * 600;
    const phase = Math.random() * period;

    this.idleTween = this.scene.tweens.add({
      targets: this,
      y: this.homeY - 2.5,
      duration: period,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: phase,
    });

    this.shadowTween = this.scene.tweens.add({
      targets: this.groundShadow,
      scaleX: 0.78,
      scaleY: 0.78,
      duration: period,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: phase,
    });
  }

  private redrawRing() {
    this.opinionRing.clear();
    if (this.opinionColor === "#FFFFFF") return; // undecided → no ring
    const c = Phaser.Display.Color.HexStringToColor(this.opinionColor).color;
    const cy = -FRAME_H * 0.55; // vertically centered on sprite body
    // Soft halo
    this.opinionRing.lineStyle(6, c, 0.15);
    this.opinionRing.strokeCircle(0, cy, 30);
    // Mid ring
    this.opinionRing.lineStyle(3, c, 0.45);
    this.opinionRing.strokeCircle(0, cy, 25);
    // Sharp inner ring
    this.opinionRing.lineStyle(1.5, c, 0.92);
    this.opinionRing.strokeCircle(0, cy, 20);
  }

  private drawFallback() {
    if (!this.fallbackBody) return;
    this.fallbackBody.clear();
    const c = Phaser.Display.Color.HexStringToColor(this.agentColor).color;
    const cy = -FRAME_H * 0.5;
    // Soft shadow blob
    this.fallbackBody.fillStyle(0x000000, 0.18);
    this.fallbackBody.fillCircle(2, cy + 2, 22);
    // Body
    this.fallbackBody.fillStyle(c, 1);
    this.fallbackBody.fillCircle(0, cy, 22);
    // Specular
    this.fallbackBody.fillStyle(0xffffff, 0.22);
    this.fallbackBody.fillCircle(-6, cy - 8, 10);
  }

  /** Multi-layered proximity glow — shown when the player is nearby. */
  setProximityHighlight(active: boolean) {
    if (active && !this.proxGlow) {
      const cy = -FRAME_H * 0.55;
      const civicBlue = 0x3b5998;

      this.proxGlow = this.scene.add.graphics();
      this.add(this.proxGlow);
      // Ensure glow is behind the character sprite
      this.sendToBack(this.proxGlow);
      this.sendToBack(this.groundShadow);

      // Draw three concentric layers
      // Outer halo
      this.proxGlow.lineStyle(4, civicBlue, 0.08);
      this.proxGlow.strokeCircle(0, cy, 38);
      // Inner ring
      this.proxGlow.lineStyle(1.5, civicBlue, 0.25);
      this.proxGlow.strokeCircle(0, cy, 28);
      // Soft radial fill
      this.proxGlow.fillStyle(civicBlue, 0.06);
      this.proxGlow.fillCircle(0, cy, 30);

      this.proxGlow.setAlpha(0);

      // Fade in
      const fadeIn = this.scene.tweens.add({
        targets: this.proxGlow,
        alpha: 1,
        duration: 250,
        ease: "Quad.easeOut",
      });
      this.proxTweens.push(fadeIn);

      // Breathing pulse
      const breathe = this.scene.tweens.add({
        targets: this.proxGlow,
        scaleX: { from: 0.95, to: 1.1 },
        scaleY: { from: 0.95, to: 1.1 },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      this.proxTweens.push(breathe);
    } else if (!active && this.proxGlow) {
      // Stop breathing tweens
      for (const t of this.proxTweens) t.stop();
      this.proxTweens = [];

      const glow = this.proxGlow;
      this.proxGlow = undefined;

      this.scene.tweens.add({
        targets: glow,
        alpha: 0,
        duration: 200,
        ease: "Quad.easeIn",
        onComplete: () => {
          glow.destroy();
        },
      });
    }
  }

  override destroy(fromScene?: boolean) {
    this.idleTween?.stop();
    this.shadowTween?.stop();
    this.moveTween?.stop();
    this.bubbleTimer?.remove();
    for (const t of this.proxTweens) t.stop();
    this.proxGlow?.destroy();
    super.destroy(fromScene);
  }
}

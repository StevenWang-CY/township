import Phaser from "phaser";
import { playEmote, type EmoteKey } from "./EmoteRegistry";

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
export type GestureKind = "nod" | "shake_head" | "shrug" | "laugh" | "point" | "none";
export type AgentActivity =
  | "walking"
  | "idle"
  | "working"
  | "talking"
  | "eating"
  | "praying"
  | "sleeping"
  | "thinking"
  | "celebrating"
  | "voting";

export type BubbleSentiment = "positive" | "negative" | "neutral";

export interface AgentConfig {
  id: string;
  name: string;
  initials: string;
  color: string;
  town: string;
  opinionColor?: string;
  spriteKey?: string;
  outfitKey?: string;
  accessoryKey?: string;
  tint?: number;
  partner?: { spriteKey?: string; name: string; initials: string; tint?: number };
  /** Ambient background NPC — no opinion ring, no interaction, no nameplate. */
  ambient?: boolean;
}

interface BubbleEntry {
  group: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  timer?: Phaser.Time.TimerEvent;
  height: number;
}

export class AgentSprite extends Phaser.GameObjects.Container {
  // Layered sprite stack
  protected bodySprite?: Phaser.GameObjects.Sprite;
  protected outfitSprite?: Phaser.GameObjects.Sprite;
  protected accessorySprite?: Phaser.GameObjects.Sprite;
  protected coupleSprite?: Phaser.GameObjects.Sprite;
  /** Back-compat alias used by older code paths (== bodySprite). */
  protected charSprite?: Phaser.GameObjects.Sprite;

  private fallbackBody?: Phaser.GameObjects.Graphics;
  private initialsText?: Phaser.GameObjects.Text;
  protected groundShadow: Phaser.GameObjects.Ellipse;
  private opinionRing: Phaser.GameObjects.Graphics;
  protected nameLabel: Phaser.GameObjects.Text;

  // Bubble stacking
  private bubbleQueue: BubbleEntry[] = [];
  protected idleTween?: Phaser.Tweens.Tween;
  protected shadowTween?: Phaser.Tweens.Tween;
  private moveTween?: Phaser.Tweens.Tween;

  // Proximity highlight layers
  private proxGlow?: Phaser.GameObjects.Graphics;
  private proxTweens: Phaser.Tweens.Tween[] = [];

  // Activity-state extras
  private activityFx?: Phaser.GameObjects.GameObject;
  private activityTimer?: Phaser.Time.TimerEvent;

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
  protected spriteBaseScale = SPRITE_SCALE;

  private currentActivity: AgentActivity = "idle";
  private currentGesture: GestureKind = "none";
  private hasPartner = false;
  protected ambient = false;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: AgentConfig) {
    super(scene, x, y);

    this.agentId = cfg.id;
    this.agentName = cfg.name;
    this.townId = cfg.town;
    this.agentColor = cfg.color;
    this.opinionColor = cfg.opinionColor ?? "#FFFFFF";
    this.homeY = y;
    this.ambient = !!cfg.ambient;

    // ── Ground shadow ellipse ────────────────────────────────
    this.groundShadow = scene.add.ellipse(0, SHADOW_Y, 36, 12, 0x000000, 0.2);
    this.add(this.groundShadow);

    // ── Opinion ring ─────────────────────────────────────────
    this.opinionRing = scene.add.graphics();
    if (!this.ambient) this.redrawRing();
    this.add(this.opinionRing);

    // ── Layered character sprite stack ───────────────────────
    if (cfg.spriteKey && scene.textures.exists(cfg.spriteKey)) {
      this.bodySprite = scene.add.sprite(0, 0, cfg.spriteKey, IDLE_FRAMES.down);
      this.bodySprite.setScale(SPRITE_SCALE);
      this.bodySprite.setOrigin(0.5, 1);
      if (cfg.tint !== undefined) this.bodySprite.setTint(cfg.tint);
      this.add(this.bodySprite);
      this.charSprite = this.bodySprite;
      this.usingSpritesheet = true;

      // Optional outfit overlay
      if (cfg.outfitKey && scene.textures.exists(cfg.outfitKey)) {
        this.outfitSprite = scene.add.sprite(0, 0, cfg.outfitKey, IDLE_FRAMES.down);
        this.outfitSprite.setScale(SPRITE_SCALE);
        this.outfitSprite.setOrigin(0.5, 1);
        this.add(this.outfitSprite);
      }
      // Optional accessory overlay
      if (cfg.accessoryKey && scene.textures.exists(cfg.accessoryKey)) {
        this.accessorySprite = scene.add.sprite(0, 0, cfg.accessoryKey, IDLE_FRAMES.down);
        this.accessorySprite.setScale(SPRITE_SCALE);
        this.accessorySprite.setOrigin(0.5, 1);
        this.add(this.accessorySprite);
      }

      // Couple / partner — render side-by-side
      if (cfg.partner) {
        this.hasPartner = true;
        const partnerKey = cfg.partner.spriteKey && scene.textures.exists(cfg.partner.spriteKey)
          ? cfg.partner.spriteKey
          : cfg.spriteKey;
        this.coupleSprite = scene.add.sprite(18, 0, partnerKey, IDLE_FRAMES.down);
        this.coupleSprite.setScale(SPRITE_SCALE);
        this.coupleSprite.setOrigin(0.5, 1);
        if (cfg.partner.tint !== undefined) this.coupleSprite.setTint(cfg.partner.tint);
        this.add(this.coupleSprite);
        // Wider shadow under the pair
        this.groundShadow.setSize(60, 14);
      }

      // Sync overlay frames whenever the body anim advances.
      this.bodySprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, () => this.syncOverlayFrame());
      this.bodySprite.on("framechange", () => this.syncOverlayFrame());
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
    this.nameLabel.setVisible(false); // Rendered by DOM CanvasOverlay instead
    this.add(this.nameLabel);

    // ── Interaction ──────────────────────────────────────────
    this.setSize(48, FRAME_H + LABEL_Y + 12);
    if (this.ambient) {
      // Ambient NPCs: no interaction, no nameplate, no opinion ring.
      this.nameLabel.setVisible(false);
      this.opinionRing.setVisible(false);
    } else {
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
    }

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
    this.currentActivity = "walking";
    this.idleTween?.stop();
    this.bodySprite?.setScale(this.spriteBaseScale); // reset breathing scaleY
    this.shadowTween?.stop();
    this.groundShadow.setScale(1); // reset shadow scale
    this.moveTween?.stop();

    // Walk animation — frameRate scales with stride length so long sprints
    // cycle the legs faster than short hops.
    this.playWalk(this.currentDirection);
    const frameRate = Phaser.Math.Clamp(6 + dist / 220, 5, 14);
    if (this.bodySprite?.anims) this.bodySprite.anims.timeScale = frameRate / WALK_FPS;
    if (this.outfitSprite?.anims) this.outfitSprite.anims.timeScale = frameRate / WALK_FPS;
    if (this.accessorySprite?.anims) this.accessorySprite.anims.timeScale = frameRate / WALK_FPS;
    if (this.coupleSprite?.anims) this.coupleSprite.anims.timeScale = frameRate / WALK_FPS;

    // Shadow squish while walking — variable frame rate by distance
    const squishDur = Phaser.Math.Clamp(180 + dist * 0.15, 220, 320);
    this.shadowTween = this.scene.tweens.add({
      targets: this.groundShadow,
      scaleX: 1.45,
      scaleY: 0.6,
      duration: squishDur,
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
        // Reset animation timeScale to default after a walk.
        if (this.bodySprite?.anims) this.bodySprite.anims.timeScale = 1;
        if (this.outfitSprite?.anims) this.outfitSprite.anims.timeScale = 1;
        if (this.accessorySprite?.anims) this.accessorySprite.anims.timeScale = 1;
        if (this.coupleSprite?.anims) this.coupleSprite.anims.timeScale = 1;
        this.playIdle(this.currentDirection);
        this.currentActivity = "idle";
        this.beginIdle();
        onComplete?.();
      },
    });
  }

  /** Turn to face a target without moving. */
  faceToward(otherX: number, otherY: number) {
    const dx = otherX - this.x;
    const dy = otherY - this.y;
    this.currentDirection =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0 ? "right" : "left"
        : dy > 0 ? "down" : "up";
    this.playIdle(this.currentDirection);
  }

  /** Show a Smallville-style speech bubble with stacking + sentiment-tinted border. */
  showSpeechBubble(text: string, duration?: number, sentiment: BubbleSentiment = "neutral") {
    const t = text.length > 140 ? text.slice(0, 137) + "…" : text;
    const dur = duration ?? Math.min(8000, Math.max(2000, t.length * 50));

    const group = this.scene.add.container(0, 0);
    const bg = this.scene.add.graphics();
    const txt = this.scene.add.text(0, 0, t, {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "9px",
      color: "#1a1a1a",
      align: "center",
      wordWrap: { width: 135, useAdvancedWrap: true },
      lineSpacing: 1,
      resolution: 2,
    });
    txt.setOrigin(0.5, 1);

    const pad = 10;
    const bw = Math.max(txt.width + pad * 2, 55);
    const bh = txt.height + pad * 2;
    const bx = -bw / 2;
    // Auto-flip if the body would clip above the canvas top.
    const headY = this.y + BUBBLE_TIP_Y;
    const flip = headY - bh - 14 < 8;
    const bodyTop = flip
      ? BUBBLE_TIP_Y + 22       // below head
      : BUBBLE_TIP_Y - bh - 8;  // above head
    const tailBase = flip ? bodyTop : bodyTop + bh;
    const tailTip = flip ? BUBBLE_TIP_Y + 8 : BUBBLE_TIP_Y;

    // Sentiment color
    let borderColor = 0xbbbbbb;
    if (sentiment === "positive") borderColor = 0xb8d8a8;
    else if (sentiment === "negative") borderColor = 0xe5b6b2;

    bg.clear();
    // Drop shadow
    bg.fillStyle(0x000000, 0.13);
    bg.fillRoundedRect(bx + 3, bodyTop + 3, bw, bh, 9);
    // White body
    bg.fillStyle(0xffffff, 0.97);
    bg.fillRoundedRect(bx, bodyTop, bw, bh, 9);
    // Sentiment border
    bg.lineStyle(1.5, borderColor, 0.9);
    bg.strokeRoundedRect(bx, bodyTop, bw, bh, 9);
    // Tail
    bg.fillStyle(0xffffff, 0.97);
    bg.fillTriangle(-7, tailBase, 7, tailBase, 0, tailTip);
    bg.lineStyle(2, 0xffffff, 1);
    bg.lineBetween(-6, tailBase, 6, tailBase);
    bg.lineStyle(1.5, borderColor, 0.8);
    bg.strokeTriangle(-7, tailBase, 7, tailBase, 0, tailTip + (flip ? -2 : 2));

    // Position the text inside the body
    txt.setY(bodyTop + bh - pad);
    txt.setX(0);

    group.add([bg, txt]);
    group.setDepth(400);
    group.setScale(0.55);
    group.setAlpha(0);
    this.add(group);

    // Stack: push older bubbles up & dim them
    const stackOffset = bh + 6;
    for (const old of this.bubbleQueue) {
      old.group.y -= stackOffset;
      old.group.setAlpha(Math.max(0.4, old.group.alpha - 0.25));
    }

    const entry: BubbleEntry = { group, bg, text: txt, height: bh };
    this.bubbleQueue.push(entry);

    this.scene.tweens.add({
      targets: group,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 230,
      ease: "Back.easeOut",
    });

    entry.timer = this.scene.time.delayedCall(dur, () => {
      this.scene.tweens.add({
        targets: group,
        alpha: 0,
        scaleX: 0.75,
        scaleY: 0.75,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => {
          group.destroy();
          this.bubbleQueue = this.bubbleQueue.filter((e) => e !== entry);
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

  /* ── Activity state machine ───────────────────────────── */

  setActivity(activity: AgentActivity) {
    if (activity === this.currentActivity) return;
    this.clearActivityFx();
    this.currentActivity = activity;

    switch (activity) {
      case "walking":
        this.playWalk(this.currentDirection);
        break;
      case "idle":
        this.playIdle(this.currentDirection);
        this.beginIdle();
        break;
      case "working":
        // gentle bob already in beginIdle()
        this.playIdle(this.currentDirection);
        break;
      case "talking":
        this.playIdle(this.currentDirection);
        // Occasional nod while talking
        this.activityTimer = this.scene.time.addEvent({
          delay: 2400, loop: true,
          callback: () => this.playGesture(Math.random() < 0.5 ? "nod" : "point"),
        });
        break;
      case "eating":
        this.playIdle(this.currentDirection);
        this.activityTimer = this.scene.time.addEvent({
          delay: 4000, loop: true,
          callback: () => this.spawnFloatGlyph("♨", "#c87a3a"),
        });
        break;
      case "praying":
        this.playIdle("up");
        this.activityTimer = this.scene.time.addEvent({
          delay: 3000, loop: true,
          callback: () => this.spawnFloatGlyph("✧", "#e8c060"),
        });
        break;
      case "sleeping":
        this.playIdle(this.currentDirection);
        if (this.bodySprite) this.bodySprite.setRotation(0.12);
        this.activityTimer = this.scene.time.addEvent({
          delay: 1100, loop: true,
          callback: () => this.spawnFloatGlyph("Z", "#6b7d8c"),
        });
        break;
      case "thinking":
        this.showEmote("reflecting");
        break;
      case "celebrating":
        this.scene.tweens.add({
          targets: this, scaleX: 1.12, scaleY: 1.12,
          duration: 220, yoyo: true, repeat: 2, ease: "Sine.easeInOut",
        });
        playEmote(this.scene, "joy", this.x, this.y - FRAME_H * 0.5);
        break;
      case "voting": {
        // Blue glow ring under feet
        const ring = this.scene.add.graphics();
        ring.lineStyle(2, 0x3b5998, 0.85);
        ring.strokeCircle(this.x, this.y + 4, 18);
        this.scene.tweens.add({
          targets: ring,
          scaleX: 1.3, scaleY: 1.3, alpha: 0,
          duration: 1100, repeat: -1, ease: "Sine.easeOut",
        });
        this.activityFx = ring;
        break;
      }
    }
  }

  getActivity(): AgentActivity { return this.currentActivity; }
  getGesture(): GestureKind { return this.currentGesture; }

  private clearActivityFx() {
    this.activityTimer?.remove(false);
    this.activityTimer = undefined;
    if (this.activityFx) {
      (this.activityFx as Phaser.GameObjects.GameObject).destroy();
      this.activityFx = undefined;
    }
    if (this.bodySprite) this.bodySprite.setRotation(0);
  }

  private spawnFloatGlyph(glyph: string, color: string) {
    const tx = this.scene.add.text(this.x, this.y - FRAME_H * 0.7, glyph, {
      fontFamily: "Inter, monospace",
      fontSize: "11px",
      fontStyle: "bold",
      color,
      resolution: 2,
    });
    tx.setOrigin(0.5, 1);
    tx.setDepth(500);
    this.scene.tweens.add({
      targets: tx, y: tx.y - 22, alpha: 0,
      duration: 1100, ease: "Sine.easeOut",
      onComplete: () => tx.destroy(),
    });
  }

  /* ── Gestures ─────────────────────────────────────────── */

  playGesture(kind: GestureKind) {
    if (kind === "none" || !this.bodySprite) return;
    this.currentGesture = kind;
    const sprite = this.bodySprite;
    const base = this.spriteBaseScale;

    switch (kind) {
      case "nod":
        this.scene.tweens.add({
          targets: sprite,
          scaleY: { from: base, to: base * 0.92 },
          duration: 140,
          yoyo: true, repeat: 1, ease: "Sine.easeInOut",
        });
        playEmote(this.scene, "agree", this.x, this.y - FRAME_H * 0.5);
        break;
      case "shake_head":
        this.scene.tweens.add({
          targets: sprite,
          scaleX: { from: base, to: base * 1.08 },
          duration: 110, yoyo: true, repeat: 2, ease: "Sine.easeInOut",
        });
        playEmote(this.scene, "disagree", this.x, this.y - FRAME_H * 0.5);
        break;
      case "shrug":
        this.scene.tweens.add({
          targets: sprite,
          rotation: { from: -0.08, to: 0.08 },
          duration: 170, yoyo: true, repeat: 1, ease: "Sine.easeInOut",
          onComplete: () => sprite.setRotation(0),
        });
        playEmote(this.scene, "confusion", this.x, this.y - FRAME_H * 0.5);
        break;
      case "laugh":
        this.scene.tweens.add({
          targets: sprite,
          scaleX: base * 1.05, scaleY: base * 1.08,
          duration: 100, yoyo: true, repeat: 2, ease: "Sine.easeInOut",
        });
        playEmote(this.scene, "joy", this.x, this.y - FRAME_H * 0.5);
        break;
      case "point": {
        const dx = { down: 0, left: -14, right: 14, up: 0 }[this.currentDirection];
        const dy = { down: 8, left: -FRAME_H * 0.5, right: -FRAME_H * 0.5, up: -FRAME_H * 0.7 }[this.currentDirection];
        const arrow = this.scene.add.graphics();
        arrow.fillStyle(0x4a7abf, 0.95);
        arrow.fillTriangle(0, -4, 0, 4, 8, 0);
        arrow.setPosition(this.x + dx, this.y + dy);
        arrow.setDepth(510);
        this.scene.tweens.add({
          targets: arrow,
          alpha: 0,
          x: arrow.x + Math.sign(dx) * 8,
          duration: 450,
          onComplete: () => arrow.destroy(),
        });
        break;
      }
    }

    this.scene.time.delayedCall(500, () => { this.currentGesture = "none"; });
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  protected playWalk(dir: Direction) {
    if (!this.usingSpritesheet || !this.bodySprite) return;
    const key = `${this.bodySprite.texture.key}-walk-${dir}`;
    if (this.scene.anims.exists(key)) this.bodySprite.play(key, true);
    if (this.coupleSprite) {
      const coupleKey = `${this.coupleSprite.texture.key}-walk-${dir}`;
      if (this.scene.anims.exists(coupleKey)) this.coupleSprite.play(coupleKey, true);
    }
    // Position the partner perpendicular to the direction of motion.
    if (this.coupleSprite) {
      const perp = (dir === "left" || dir === "right") ? { x: 0, y: -12 } : { x: 18, y: 0 };
      this.coupleSprite.setPosition(perp.x, perp.y);
    }
  }

  protected playIdle(dir: Direction) {
    if (!this.usingSpritesheet || !this.bodySprite) return;
    this.bodySprite.stop();
    this.bodySprite.setFrame(IDLE_FRAMES[dir]);
    this.outfitSprite?.setFrame(IDLE_FRAMES[dir]);
    this.accessorySprite?.setFrame(IDLE_FRAMES[dir]);
    if (this.coupleSprite) {
      this.coupleSprite.stop();
      this.coupleSprite.setFrame(IDLE_FRAMES[dir]);
    }
  }

  /** Body's anim advanced — propagate the frame to overlays + partner. */
  private syncOverlayFrame() {
    if (!this.bodySprite) return;
    const frame = this.bodySprite.frame.name;
    this.outfitSprite?.setFrame(frame);
    this.accessorySprite?.setFrame(frame);
    // Partner shares the same stride — if it's not running its own anim, mirror frame.
    if (this.coupleSprite && !this.coupleSprite.anims?.isPlaying) {
      this.coupleSprite.setFrame(frame);
    }
  }

  /** Breathing idle: subtle scaleY pulse + inverse shadow shrink. */
  protected beginIdle() {
    this.playIdle(this.currentDirection);

    const period = 1200;
    const phase = Math.random() * period;

    // Breathing: subtle vertical scale on body sprite
    if (this.bodySprite) {
      this.idleTween = this.scene.tweens.add({
        targets: this.bodySprite,
        scaleY: this.spriteBaseScale * 1.03,
        duration: period,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: phase,
      });
    }

    // Shadow inverse: shrink when character "inhales"
    this.shadowTween = this.scene.tweens.add({
      targets: this.groundShadow,
      scaleX: 0.92,
      scaleY: 0.85,
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

  // ────────────────────────────────────────────────────────────
  // State-driven emotes
  // ────────────────────────────────────────────────────────────

  /** Show an overhead emote — dispatches through `EmoteRegistry`. */
  showEmote(type: EmoteKey | "reflecting" | "opinion_changed") {
    if (type === "opinion_changed") {
      const tint = Phaser.Display.Color.HexStringToColor(this.opinionColor).color;
      playEmote(this.scene, "opinion_changed", this.x, this.y - FRAME_H * 0.5, { tint });
      return;
    }
    if (type === "reflecting") {
      playEmote(this.scene, "reflecting", this.x, this.y - FRAME_H * 0.7);
      return;
    }
    playEmote(this.scene, type, this.x, this.y - FRAME_H * 0.5);
  }

  /** Export position data for DOM overlay rendering. */
  getOverlayInfo(): { id: string; name: string; x: number; y: number; visible: boolean } {
    return {
      id: this.agentId,
      name: this.agentName.split(/[\s"'&]/)[0],
      x: this.x,
      y: this.y + LABEL_Y,
      visible: this.visible && this.alpha > 0,
    };
  }

  /** Is this sprite a paired duo (composite couple agent)? */
  hasCouple(): boolean { return this.hasPartner; }

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

  /**
   * Walk one or two steps toward (px, py) and face them. Used when a player
   * presses E and the NPC responds.
   */
  respondToInteractRequest(px: number, py: number) {
    const dx = px - this.x;
    const dy = py - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 28) {
      this.faceToward(px, py);
      return;
    }
    // Walk half the remaining distance, capped at ~30 px.
    const step = Math.min(30, dist * 0.5);
    const tx = this.x + (dx / dist) * step;
    const ty = this.y + (dy / dist) * step;
    this.moveToPosition(tx, ty, () => this.faceToward(px, py));
  }

  override destroy(fromScene?: boolean) {
    this.idleTween?.stop();
    this.shadowTween?.stop();
    this.moveTween?.stop();
    for (const b of this.bubbleQueue) {
      b.timer?.remove();
      b.group.destroy();
    }
    this.bubbleQueue = [];
    this.clearActivityFx();
    for (const t of this.proxTweens) t.stop();
    this.proxGlow?.destroy();
    super.destroy(fromScene);
  }
}

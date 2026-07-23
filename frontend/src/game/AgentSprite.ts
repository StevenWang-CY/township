import Phaser from "phaser";
import { playEmote, type EmoteKey } from "./EmoteRegistry";
import {
  ensureBallotTexture,
  ensureRingTextures,
  ensureShadowTexture,
  ensureSquareTexture,
  reducedMotion,
} from "./pixelTextures";

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
/** Default side-by-side offset for a couple's companion body (perpendicular to facing). */
export const COMPANION_OFFSET = 18;

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
  /**
   * Baked palette-swap sheet (scripts/mapgen/outfits.py). Preferred over
   * `tint` when the texture exists.
   */
  customKey?: string;
  /**
   * @deprecated Outfit overlays were removed (flat-rect chest patches read as
   * floating shapes besides the figure). Use `customKey`/`tint` instead.
   * Kept on the type for back-compat with existing callers; ignored at runtime.
   */
  outfitKey?: string;
  /** Pixel accessory overlay sheet key (scripts/mapgen/accessories.py). */
  accessoryKey?: string;
  tint?: number;
  /** Couple partner — rendered as a real trailing second body. */
  partner?: { name: string; spriteKey?: string; tint?: number };
  /** Ambient background NPC — no opinion ring, no interaction, no nameplate. */
  ambient?: boolean;
}

interface BubbleEntry {
  group: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  timer?: Phaser.Time.TimerEvent;
  height: number;
  /** Extra upward shift applied when newer bubbles stack beneath this one. */
  stackOffset: number;
}

export class AgentSprite extends Phaser.GameObjects.Container {
  // Layered sprite stack
  protected bodySprite?: Phaser.GameObjects.Sprite;
  protected accessorySprite?: Phaser.GameObjects.Sprite;
  /** Back-compat alias used by older code paths (== bodySprite). */
  protected charSprite?: Phaser.GameObjects.Sprite;

  private fallbackBody?: Phaser.GameObjects.Graphics;
  private initialsText?: Phaser.GameObjects.Text;
  protected groundShadow: Phaser.GameObjects.Image;
  /** 2-frame chunky pixel opinion ring (A visible, B = shimmer frame). */
  private ringA: Phaser.GameObjects.Image;
  private ringB: Phaser.GameObjects.Image;
  private ringShimmerTimer?: Phaser.Time.TimerEvent;
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
  private reservedTarget: { x: number; y: number } | null = null;
  private currentGesture: GestureKind = "none";
  private partnerInfo?: { name: string; tint: number };
  /** Companion body sprite for couple agents — a real second body that
   *  trails the lead with a delayed follow + offset walk phase. */
  private companionSprite?: Phaser.GameObjects.Sprite;
  /** Companion ground shadow. */
  private companionShadow?: Phaser.GameObjects.Image;
  /** Delayed-follow tween moving the companion to its next local offset. */
  private companionTween?: Phaser.Tweens.Tween;
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

    // ── Opinion ring — chunky pixel ground ellipse at the feet,
    //    2-frame shimmer. Sits UNDER the shadow like a native tile marker.
    this.ringA = scene.add.image(0, SHADOW_Y + 1, "__WHITE").setVisible(false);
    this.ringB = scene.add.image(0, SHADOW_Y + 1, "__WHITE").setVisible(false);
    this.add(this.ringA);
    this.add(this.ringB);

    // ── Ground shadow — dithered 3-tone pixel texture ────────
    this.groundShadow = scene.add.image(0, SHADOW_Y, ensureShadowTexture(scene));
    this.add(this.groundShadow);

    if (!this.ambient) this.applyRing();

    // ── Layered character sprite stack ───────────────────────
    // Prefer the baked palette-swap sheet; fall back to base sheet + tint.
    const bodyKey =
      cfg.customKey && scene.textures.exists(cfg.customKey)
        ? cfg.customKey
        : cfg.spriteKey && scene.textures.exists(cfg.spriteKey)
          ? cfg.spriteKey
          : undefined;
    if (bodyKey) {
      this.bodySprite = scene.add.sprite(0, 0, bodyKey, IDLE_FRAMES.down);
      this.bodySprite.setScale(SPRITE_SCALE);
      this.bodySprite.setOrigin(0.5, 1);
      // Runtime tint only when no custom sheet took over.
      if (bodyKey === cfg.spriteKey && cfg.tint !== undefined) {
        this.bodySprite.setTint(cfg.tint);
      }
      this.add(this.bodySprite);
      this.charSprite = this.bodySprite;
      this.usingSpritesheet = true;

      // Accessory overlay — real pixel sheet (kippah/hijab/cap/hardhat/
      // glasses) generated per base sheet and played frame-locked with the
      // body. Skip silently if the texture wasn't generated rather than
      // creating an empty sprite that would draw as a stray rectangle.
      if (cfg.accessoryKey) {
        if (scene.textures.exists(cfg.accessoryKey)) {
          this.accessorySprite = scene.add.sprite(0, 0, cfg.accessoryKey, IDLE_FRAMES.down);
          this.accessorySprite.setScale(SPRITE_SCALE);
          this.accessorySprite.setOrigin(0.5, 1);
          this.add(this.accessorySprite);
        } else if (typeof console !== "undefined") {
          console.warn(`[AgentSprite] accessory texture "${cfg.accessoryKey}" not found for ${cfg.id}`);
        }
      }

      // Couple agents — a real second body (its own spritesheet, never a
      // tinted clone) that trails the lead ~12px behind with a delayed
      // follow and an offset walk phase. Falls back to the lead sheet +
      // tint only if the partner texture failed to load.
      if (cfg.partner) {
        this.partnerInfo = {
          name: cfg.partner.name,
          tint: cfg.partner.tint ?? 0xc8b89c,
        };
        const partnerKey =
          cfg.partner.spriteKey && scene.textures.exists(cfg.partner.spriteKey)
            ? cfg.partner.spriteKey
            : bodyKey;

        // Companion ground shadow (slightly smaller than the lead's).
        this.companionShadow = scene.add.image(COMPANION_OFFSET, SHADOW_Y, ensureShadowTexture(scene));
        this.companionShadow.setScale(0.85).setAlpha(0.9);
        this.addAt(this.companionShadow, 0); // behind everything

        this.companionSprite = scene.add.sprite(COMPANION_OFFSET, 0, partnerKey, IDLE_FRAMES.down);
        this.companionSprite.setScale(SPRITE_SCALE * 0.96);
        this.companionSprite.setOrigin(0.5, 1);
        if (partnerKey === bodyKey) this.companionSprite.setTint(this.partnerInfo.tint);
        // Insert directly beneath the lead body sprite.
        const leadIdx = this.getIndex(this.bodySprite);
        if (leadIdx >= 0) this.addAt(this.companionSprite, leadIdx);
        else this.add(this.companionSprite);
      }

      // Sync accessory frame whenever the body anim advances.
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
    // Rendered in-canvas so the label can never detach from its sprite the
    // way screen-space DOM labels did under a zoomed follow-camera. TownScene
    // declutters labels each tick (pair lanes + crowd badges).
    this.nameLabel.setVisible(!this.ambient);
    this.add(this.nameLabel);

    // ── Interaction ──────────────────────────────────────────
    this.setSize(48, FRAME_H + LABEL_Y + 12);
    if (this.ambient) {
      // Ambient NPCs: no interaction, no nameplate, no opinion ring.
      this.nameLabel.setVisible(false);
      this.ringA.setVisible(false);
      this.ringB.setVisible(false);
    } else {
      this.setInteractive({ cursor: "pointer" });

      // Hover: gentle lift, not a Back.easeOut overshoot. The earlier 1.1×
      // bounce felt twitchy during normal cursor passes.
      this.on("pointerover", () => {
        if (this.isMoving) return;
        scene.tweens.add({ targets: this, scaleX: 1.05, scaleY: 1.05, duration: 130, ease: "Sine.easeOut" });
        this.nameLabel.setColor("#FFD700");
      });
      this.on("pointerout", () => {
        scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 130, ease: "Sine.easeOut" });
        this.nameLabel.setColor("#ffffff");
      });
      this.on("pointerdown", () => {
        if (!this.isPlayer) {
          scene.events.emit("agent-clicked", this.agentId);
        }
        // Slightly less aggressive press: 0.94 instead of 0.9.
        scene.tweens.add({ targets: this, scaleX: 0.94, scaleY: 0.94, duration: 80, yoyo: true, ease: "Quad.easeOut" });
      });
    }

    scene.add.existing(this);
    this.syncDepth();
    this.beginIdle();
  }

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  /** Bubbles live at scene level (see showSpeechBubble) — above rooftops.
   *  Anything anchored to the speaker must follow them frame-by-frame. */
  static readonly BUBBLE_DEPTH = 6500;

  /** Called every frame by TownScene to keep depth sorted by Y. */
  syncDepth() {
    this.setDepth(100 + Math.floor(this.y));
    // Keep scene-level speech bubbles glued to the speaker.
    for (const bubble of this.bubbleQueue) {
      bubble.group.setPosition(this.x, this.y - bubble.stackOffset);
    }
  }

  /** Is this agent mid-walk (positional tween active)? */
  isWalking(): boolean {
    return this.isMoving;
  }

  /** In-flight walk target — other agents treat it as occupied ground. */
  getReservedTarget(): { x: number; y: number } | null {
    return this.reservedTarget;
  }

  /** Label declutter hooks (TownScene): stack a colliding pair into lanes. */
  setLabelSlot(dy: number) {
    this.nameLabel.setY(LABEL_Y + dy);
  }

  /** Label declutter hooks (TownScene): hide labels merged into a crowd badge. */
  setLabelVisible(visible: boolean) {
    this.nameLabel.setVisible(visible && !this.ambient);
  }

  /** Gentle position correction from the overlap-resolver (never mid-walk). */
  nudgeTo(x: number, y: number) {
    if (this.isMoving) return;
    this.setPosition(x, y);
    this.homeY = y;
    this.syncDepth();
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
    this.reservedTarget = { x: tx, y: ty };
    this.stopIdleMotion();
    this.moveTween?.stop();

    // Walk animation — frameRate scales with stride length so long sprints
    // cycle the legs faster than short hops.
    this.playWalk(this.currentDirection);
    const frameRate = Phaser.Math.Clamp(6 + dist / 220, 5, 14);
    if (this.bodySprite?.anims) this.bodySprite.anims.timeScale = frameRate / WALK_FPS;
    if (this.accessorySprite?.anims) this.accessorySprite.anims.timeScale = frameRate / WALK_FPS;
    if (this.companionSprite?.anims) this.companionSprite.anims.timeScale = frameRate / WALK_FPS;

    // Shadow stride — hint of weight shift, not a trampoline hop.
    // Duration roughly matches the 9 fps × 3-frame walk cycle (~333 ms).
    const squishDur = Phaser.Math.Clamp(320 + dist * 0.15, 360, 460);
    if (!reducedMotion()) {
      this.shadowTween = this.scene.tweens.add({
        targets: this.groundShadow,
        scaleX: 1.18,
        scaleY: 0.88,
        duration: squishDur,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: 30,
      });
    }

    // Duration: short hops feel responsive (280 ms min), long walks remain
    // leisurely. The previous 600 ms floor made 8 px steps look like sliding.
    const duration = Phaser.Math.Clamp(dist * 3.8, 280, 2800);

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
        this.reservedTarget = null;
        this.setScale(1);
        this.shadowTween?.stop();
        this.groundShadow.setScale(1);
        // Reset animation timeScale to default after a walk.
        if (this.bodySprite?.anims) this.bodySprite.anims.timeScale = 1;
        if (this.accessorySprite?.anims) this.accessorySprite.anims.timeScale = 1;
        if (this.companionSprite?.anims) this.companionSprite.anims.timeScale = 1;
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

  /** Pixel 9-slice speech bubble: parchment fill, 2px ink border, square
   *  corners (2px notch), stepped tail. Keeps stacking + auto-flip.
   *
   *  `emphasis` renders the conversation-spotlight variant: larger type and
   *  a wider measure so backend dialogue reads at gameplay distance instead
   *  of as a tiny tooltip. */
  showSpeechBubble(text: string, duration?: number, sentiment: BubbleSentiment = "neutral", emphasis = false) {
    const t = text.length > 140 ? text.slice(0, 137) + "…" : text;
    const dur = duration ?? Math.min(8000, Math.max(2000, t.length * 50));

    // Scene-level, NOT a child of this container: container children share
    // the speaker's y-sorted depth, which let the buildings-top roof layer
    // (depth 5000) swallow any bubble whose speaker stood in front of a
    // building. The group tracks the speaker from syncDepth() instead.
    const group = this.scene.add.container(this.x, this.y);
    const bg = this.scene.add.graphics();
    const txt = this.scene.add.text(0, 0, t, {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: emphasis ? "11px" : "10px",
      fontStyle: emphasis ? "bold" : "normal",
      color: "#2c2416",
      align: "center",
      wordWrap: { width: emphasis ? 176 : 150, useAdvancedWrap: true },
      lineSpacing: 2,
      resolution: 3,
    });
    txt.setOrigin(0.5, 1);

    const pad = emphasis ? 10 : 9;
    const bw = Math.ceil(Math.max(txt.width + pad * 2, 55));
    const bh = Math.ceil(txt.height + pad * 2);
    const camera = this.scene.cameras.main;
    const view = camera.worldView;

    // Stable three-lane placement keeps nearby residents from laying every
    // bubble on the same horizontal band during dense replay moments.
    let laneHash = 0;
    for (const ch of this.agentId) laneHash = (laneHash * 31 + ch.charCodeAt(0)) >>> 0;
    let laneOffset = (laneHash % 3) * (Math.min(bh, 36) + 6);

    // Auto-flip against the camera's visible world (not the full map), then
    // fall back to the base lane if neither stacked side has enough room.
    const headY = this.y + BUBBLE_TIP_Y;
    let flip = headY - bh - 8 - laneOffset < view.top + 8;
    if (flip && headY + 22 + laneOffset + bh > view.bottom - 8) laneOffset = 0;
    if (headY - bh - 8 - laneOffset >= view.top + 8) flip = false;
    const bodyTop = Math.round(flip
      ? BUBBLE_TIP_Y + 22 + laneOffset       // below head
      : BUBBLE_TIP_Y - bh - 8 - laneOffset); // above head
    const tailBase = flip ? bodyTop : bodyTop + bh;
    const tailTip = flip ? BUBBLE_TIP_Y + 8 : BUBBLE_TIP_Y;

    // Keep the parchment body inside the current camera while leaving the
    // pixel tail anchored to the resident. The tail stays at x=0; only the
    // body and text slide, like a typeset callout near a page margin.
    const nominalLeft = this.x - bw / 2;
    let bodyOffsetX = 0;
    if (nominalLeft < view.left + 8) bodyOffsetX = view.left + 8 - nominalLeft;
    else if (nominalLeft + bw > view.right - 8) bodyOffsetX = view.right - 8 - (nominalLeft + bw);
    bodyOffsetX = Phaser.Math.Clamp(bodyOffsetX, -bw / 2 + 12, bw / 2 - 12);
    const bx = Math.round(-bw / 2 + bodyOffsetX);

    // Ink color carries the sentiment; fill stays parchment.
    const PARCH = 0xf6eedd;
    let ink = 0x3a3226;
    if (sentiment === "positive") ink = 0x50663e;
    else if (sentiment === "negative") ink = 0x8a4a42;

    bg.clear();
    // Hard drop shadow, offset one "pixel" (2px) down-right.
    bg.fillStyle(0x2c2416, 0.16);
    bg.fillRect(bx + 2, bodyTop + 3, bw, bh);
    // Parchment body as a cross so the 2px corners stay notched.
    bg.fillStyle(PARCH, 0.98);
    bg.fillRect(bx + 2, bodyTop, bw - 4, bh);
    bg.fillRect(bx, bodyTop + 2, bw, bh - 4);
    // 2px ink border, skipping the notched corners.
    bg.fillStyle(ink, 1);
    bg.fillRect(bx + 2, bodyTop, bw - 4, 2);            // top
    bg.fillRect(bx + 2, bodyTop + bh - 2, bw - 4, 2);   // bottom
    bg.fillRect(bx, bodyTop + 2, 2, bh - 4);            // left
    bg.fillRect(bx + bw - 2, bodyTop + 2, 2, bh - 4);   // right
    // Stepped pixel tail. Its length is derived from the actual flipped /
    // unflipped gap so it always reaches the head instead of floating a few
    // pixels away near the top edge of the map.
    const tailDir = Math.sign(tailTip - tailBase) || 1;
    const tailSteps = Math.max(1, Math.ceil(Math.abs(tailTip - tailBase) / 2));
    for (let i = 0; i < tailSteps; i++) {
      const y = tailBase + tailDir * (i + (flip ? 1 : 0)) * 2;
      const inkHalf = Math.max(1, 7 - i * 2);
      const parchHalf = Math.max(0, inkHalf - 2);
      bg.fillStyle(ink, 1);
      bg.fillRect(-inkHalf, y, inkHalf * 2, 2);
      if (parchHalf > 0) {
        bg.fillStyle(PARCH, 0.98);
        bg.fillRect(-parchHalf, y, parchHalf * 2, 2);
      }
    }
    // Open the border where the tail meets the body.
    bg.fillStyle(PARCH, 0.98);
    bg.fillRect(-5, flip ? bodyTop : bodyTop + bh - 2, 10, 2);

    // Position the text inside the body
    txt.setY(bodyTop + bh - pad);
    txt.setX(bodyOffsetX);

    group.add([bg, txt]);
    group.setDepth(AgentSprite.BUBBLE_DEPTH);
    const limitMotion = reducedMotion();
    group.setScale(limitMotion ? 1 : 0.55);
    group.setAlpha(limitMotion ? 1 : 0);

    // Stack: push older bubbles up & dim them
    const stackOffset = bh + 6;
    for (const old of this.bubbleQueue) {
      old.stackOffset += stackOffset;
      old.group.setAlpha(Math.max(0.4, old.group.alpha - 0.25));
    }

    const entry: BubbleEntry = { group, bg, text: txt, height: bh, stackOffset: 0 };
    this.bubbleQueue.push(entry);
    this.syncDepth();

    if (!limitMotion) {
      this.scene.tweens.add({
        targets: group,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 230,
        ease: "Stepped",
        easeParams: [5],
      });
    }

    entry.timer = this.scene.time.delayedCall(dur, () => {
      if (limitMotion) {
        group.destroy();
        this.bubbleQueue = this.bubbleQueue.filter((e) => e !== entry);
        return;
      }
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

  setOpinionColor(color: string, emphasize = false) {
    const changed = color !== this.opinionColor;
    this.opinionColor = color;
    this.applyRing();
    if ((!changed && !emphasize) || this.ambient || color === "#FFFFFF") return;

    if (reducedMotion()) return;

    // Ring color-morph pulse: the fresh ring lands with a chunky, stepped
    // settle instead of a smooth vector ripple.
    this.scene.tweens.add({
      targets: [this.ringA, this.ringB],
      scaleX: { from: 1.45, to: 1 },
      scaleY: { from: 1.45, to: 1 },
      alpha: { from: 0.4, to: 1 },
      duration: 420,
      ease: "Stepped",
      easeParams: [5],
    });

    const c = Phaser.Display.Color.HexStringToColor(color).color;
    this.burstConfetti(c);
    this.dropBallot(c);
  }

  /** Snap an existing resident to an authoritative replay snapshot.
   *
   * Unlike the normal event methods, this deliberately has no celebratory or
   * conversational side-effects: seeking is navigation through recorded
   * state, not a request to replay every transient animation between cursors.
   */
  syncReplayState(
    x: number,
    y: number,
    opinionColor: string,
    activity: AgentActivity,
  ) {
    this.moveTween?.stop();
    this.moveTween = undefined;
    this.shadowTween?.stop();
    this.shadowTween = undefined;
    this.isMoving = false;
    this.scene.tweens.killTweensOf(this.leadLayers());
    this.stopIdleMotion();
    this.clearActivityFx();

    for (const bubble of this.bubbleQueue) {
      bubble.timer?.remove(false);
      this.scene.tweens.killTweensOf(bubble.group);
      bubble.group.destroy();
    }
    this.bubbleQueue = [];
    this.currentGesture = "none";

    this.setPosition(x, y);
    this.homeY = y;
    this.reservedTarget = null;
    this.groundShadow.setScale(1);
    this.syncDepth();
    this.setOpinionColor(opinionColor, false);
    this.setActivity(activity, true);
  }

  getOpinionColor(): string { return this.opinionColor; }
  getSpeechBubbleCount(): number { return this.bubbleQueue.length; }

  clearSpeechBubbles() {
    for (const bubble of this.bubbleQueue) {
      bubble.timer?.remove(false);
      this.scene.tweens.killTweensOf(bubble.group);
      bubble.group.destroy();
    }
    this.bubbleQueue = [];
  }

  /** Six square confetti chips in the new opinion color. */
  private burstConfetti(color: number) {
    const squareKey = ensureSquareTexture(this.scene);
    const x0 = this.x, y0 = this.y - FRAME_H * 0.55;
    const parts: Array<{ img: Phaser.GameObjects.Image; vx: number; vy: number }> = [];
    for (let i = 0; i < 6; i++) {
      const img = this.scene.add.image(x0, y0, squareKey);
      img.setTint(color).setDepth(500);
      const a = -Math.PI / 2 + (i - 2.5) * 0.42;
      const sp = 70 + (i % 3) * 26;
      parts.push({ img, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 620,
      ease: "Linear",
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        for (const p of parts) {
          p.img.setPosition(x0 + p.vx * t, y0 + p.vy * t + 160 * t * t);
          p.img.setAlpha(1 - t * t);
        }
      },
      onComplete: () => parts.forEach((p) => p.img.destroy()),
    });
  }

  /** Tiny pixel ballot arcing into the sprite. */
  private dropBallot(color: number) {
    const key = ensureBallotTexture(this.scene);
    const ballot = this.scene.add.image(this.x - 26, this.y - FRAME_H - 26, key);
    // Pale mix of the option color so the paper stays papery.
    const c = Phaser.Display.Color.IntegerToColor(color);
    const pale = Phaser.Display.Color.GetColor(
      Math.round(c.red + (255 - c.red) * 0.45),
      Math.round(c.green + (255 - c.green) * 0.45),
      Math.round(c.blue + (255 - c.blue) * 0.45),
    );
    ballot.setTint(pale).setScale(2).setDepth(505);
    const p0 = { x: this.x - 26, y: this.y - FRAME_H - 26 };
    const p1 = { x: this.x + 6, y: this.y - FRAME_H - 46 };
    const p2 = { x: this.x, y: this.y - FRAME_H * 0.45 };
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 520,
      ease: "Sine.easeIn",
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const u = 1 - t;
        ballot.setPosition(
          u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
          u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
        );
      },
      onComplete: () => {
        ballot.destroy();
        // A soft square poof where it lands.
        const poof = this.scene.add.image(p2.x, p2.y, ensureSquareTexture(this.scene));
        poof.setTint(0xffffff).setAlpha(0.9).setScale(2).setDepth(505);
        this.scene.tweens.add({
          targets: poof,
          scaleX: 4,
          scaleY: 4,
          alpha: 0,
          duration: 240,
          ease: "Quad.easeOut",
          onComplete: () => poof.destroy(),
        });
      },
    });
  }

  /* ── Activity state machine ───────────────────────────── */

  setActivity(activity: AgentActivity, force = false) {
    if (!force && activity === this.currentActivity) return;
    this.clearActivityFx();
    this.stopIdleMotion();
    this.currentActivity = activity;

    switch (activity) {
      case "walking":
        this.playWalk(this.currentDirection);
        break;
      case "idle":
        this.beginIdle();
        break;
      case "working":
        this.beginIdle();
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
        for (const layer of this.leadLayers()) layer.setRotation(0.12);
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
    for (const layer of this.leadLayers()) layer.setRotation(0);
  }

  private spawnFloatGlyph(glyph: string, color: string) {
    if (reducedMotion()) return;
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
    if (reducedMotion()) return;
    this.currentGesture = kind;
    const sprite = this.bodySprite;
    const layers = this.leadLayers();
    const base = this.spriteBaseScale;

    switch (kind) {
      case "nod":
        this.scene.tweens.add({
          targets: layers,
          scaleY: { from: base, to: base * 0.92 },
          duration: 140,
          yoyo: true, repeat: 1, ease: "Sine.easeInOut",
        });
        playEmote(this.scene, "agree", this.x, this.y - FRAME_H * 0.5);
        break;
      case "shake_head":
        this.scene.tweens.add({
          targets: layers,
          scaleX: { from: base, to: base * 1.08 },
          duration: 110, yoyo: true, repeat: 2, ease: "Sine.easeInOut",
        });
        playEmote(this.scene, "disagree", this.x, this.y - FRAME_H * 0.5);
        break;
      case "shrug":
        this.scene.tweens.add({
          targets: layers,
          rotation: { from: -0.08, to: 0.08 },
          duration: 170, yoyo: true, repeat: 1, ease: "Sine.easeInOut",
          onComplete: () => layers.forEach((layer) => layer.setRotation(0)),
        });
        playEmote(this.scene, "confusion", this.x, this.y - FRAME_H * 0.5);
        break;
      case "laugh":
        this.scene.tweens.add({
          targets: layers,
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

  /** Trailing follow: while walking the companion drifts to ~12px behind
   *  the lead (delayed target via a short tween); at rest the pair settles
   *  side-by-side. The companion's walk cycle runs a half-phase behind so
   *  the two bodies never stride in lockstep. */
  private updateCompanion(dir: Direction, mode: "walk" | "idle") {
    const sprite = this.companionSprite;
    if (!sprite) return;
    let ox: number;
    let oy: number;
    if (mode === "walk") {
      // Behind = opposite the travel direction (slight lateral offset so the
      // trailing body never hides fully behind the lead).
      switch (dir) {
        case "down":  ox = 9;   oy = -12; break;
        case "up":    ox = -9;  oy = 12;  break;
        case "left":  ox = 13;  oy = -3;  break;
        case "right": ox = -13; oy = -3;  break;
      }
    } else {
      // Side-by-side at rest, perpendicular to facing.
      switch (dir) {
        case "down":  ox = COMPANION_OFFSET + 2;    oy = 0;  break;
        case "up":    ox = -(COMPANION_OFFSET + 2); oy = 0;  break;
        case "left":  ox = COMPANION_OFFSET - 2;    oy = -2; break;
        case "right": ox = -(COMPANION_OFFSET - 2); oy = -2; break;
      }
    }
    // Delayed target: ease the companion toward the new offset instead of
    // snapping — this is what makes the second body read as *following*.
    this.companionTween?.stop();
    if (reducedMotion()) {
      sprite.setPosition(ox, oy);
      this.companionShadow?.setPosition(ox, SHADOW_Y + oy);
    } else {
      this.companionTween = this.scene.tweens.add({
        targets: sprite,
        x: ox,
        y: oy,
        duration: 340,
        ease: "Sine.easeOut",
        onUpdate: () => {
          this.companionShadow?.setPosition(sprite.x, SHADOW_Y + sprite.y);
        },
      });
    }

    const base = `${sprite.texture.key}-${mode}-${dir}`;
    if (mode === "idle" && reducedMotion()) {
      sprite.stop();
      sprite.setFrame(IDLE_FRAMES[dir]);
      return;
    }
    if (this.scene.anims.exists(base)) {
      const wasPlaying = sprite.anims.isPlaying && sprite.anims.currentAnim?.key === base;
      sprite.play(base, true);
      // Offset walk phase — half a cycle behind the lead.
      if (mode === "walk" && !wasPlaying) sprite.anims.setProgress(0.5);
    } else {
      sprite.stop();
      sprite.setFrame(IDLE_FRAMES[dir]);
    }
  }

  protected playWalk(dir: Direction) {
    this.updateCompanion(dir, "walk");
    if (!this.usingSpritesheet || !this.bodySprite) return;
    const key = `${this.bodySprite.texture.key}-walk-${dir}`;
    if (this.scene.anims.exists(key)) {
      this.bodySprite.play(key, true);
    } else {
      // Surface the missing-anim regression once per key/session rather than
      // silently freezing the agent at frame 0. The data manager survives
      // across scene reloads but not page reloads.
      const warned: Set<string> = (this.scene.data.get("_warnedMissingAnims") as Set<string>) ?? new Set();
      if (!warned.has(key)) {
        warned.add(key);
        this.scene.data.set("_warnedMissingAnims", warned);
        if (typeof console !== "undefined") {
          console.warn(`[AgentSprite] walk animation "${key}" not registered — falling back to idle frame.`);
        }
      }
      this.bodySprite.setFrame(IDLE_FRAMES[dir]);
    }
  }

  protected playIdle(dir: Direction) {
    this.updateCompanion(dir, "idle");
    if (!this.usingSpritesheet || !this.bodySprite) return;
    if (reducedMotion()) {
      this.bodySprite.stop();
      this.bodySprite.setFrame(IDLE_FRAMES[dir]);
      this.accessorySprite?.setFrame(IDLE_FRAMES[dir]);
      return;
    }
    // Prefer the per-direction idle anim (registered in TownScene) for a
    // gentle weight-shift; fall back to a static frame if the anim was never
    // registered (covers fallback / legacy sprite sheets).
    const idleKey = `${this.bodySprite.texture.key}-idle-${dir}`;
    if (this.scene.anims.exists(idleKey)) {
      this.bodySprite.play(idleKey, true);
    } else {
      this.bodySprite.stop();
      this.bodySprite.setFrame(IDLE_FRAMES[dir]);
    }
    this.accessorySprite?.setFrame(IDLE_FRAMES[dir]);
  }

  /** Body's anim advanced — propagate the frame to the accessory overlay. */
  private syncOverlayFrame() {
    if (!this.bodySprite) return;
    const frame = this.bodySprite.frame.name;
    this.accessorySprite?.setFrame(frame);
  }

  /** Lead body + accessory are a single visual rig. Every transform tween
   *  must target both or the overlay visibly swims off the head. */
  private leadLayers(): Phaser.GameObjects.Sprite[] {
    return [this.bodySprite, this.accessorySprite]
      .filter((layer): layer is Phaser.GameObjects.Sprite => !!layer);
  }

  /** Stop decorative idle motion and restore exact shared transforms. */
  private stopIdleMotion() {
    this.idleTween?.stop();
    this.idleTween = undefined;
    this.shadowTween?.stop();
    this.shadowTween = undefined;
    for (const layer of this.leadLayers()) {
      layer.setScale(this.spriteBaseScale);
      layer.setRotation(0);
    }
    this.groundShadow.setScale(1);
  }

  /** Breathing idle: legible scaleY pulse + shadow that breathes with the body. */
  protected beginIdle() {
    this.stopIdleMotion();
    this.playIdle(this.currentDirection);

    // A static, frame-perfect pose is preferable to decorative breathing
    // when the user asks the interface to reduce motion.
    if (reducedMotion()) return;

    // Calmer, more visible breath. Period is held long enough to read at
    // gameplay distance; phase is capped so the village's agents share a
    // loose collective rhythm rather than each breathing on their own clock.
    const period = 1900;
    const phase = Math.random() * 600;

    const layers = this.leadLayers();
    if (layers.length > 0) {
      this.idleTween = this.scene.tweens.add({
        targets: layers,
        scaleY: this.spriteBaseScale * 1.06,
        duration: period,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: phase,
      });
    }

    // Shadow EXPANDS with the body's inhale — heavier on the ground reads as
    // breathing in. The previous "shrink on inhale" felt like sinking.
    this.shadowTween = this.scene.tweens.add({
      targets: this.groundShadow,
      scaleX: 1.06,
      scaleY: 1.04,
      duration: period,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: phase,
    });
  }

  /** Point the two ring images at the pixel-ring textures for the current
   *  opinion color and (re)start the subtle 2-frame shimmer. */
  private applyRing() {
    this.ringShimmerTimer?.remove(false);
    this.ringShimmerTimer = undefined;

    if (this.opinionColor === "#FFFFFF") { // undecided → no opinion ring
      this.ringA.setVisible(false);
      this.ringB.setVisible(false);
      return;
    }
    const [keyA, keyB] = ensureRingTextures(this.scene, this.opinionColor);
    this.ringA.setTexture(keyA).setVisible(true);
    this.ringB.setTexture(keyB).setVisible(false);
    if (!reducedMotion()) {
      this.ringShimmerTimer = this.scene.time.addEvent({
        delay: 480,
        loop: true,
        callback: () => {
          // Settings can change while the scene is running. Stop an existing
          // shimmer immediately instead of requiring an agent re-render.
          if (reducedMotion()) {
            this.ringA.setVisible(true);
            this.ringB.setVisible(false);
            this.ringShimmerTimer?.remove(false);
            this.ringShimmerTimer = undefined;
            return;
          }
          const showB = !this.ringB.visible;
          this.ringB.setVisible(showB);
          this.ringA.setVisible(!showB);
        },
      });
    }
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
  hasCouple(): boolean { return !!this.partnerInfo; }

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
    this.companionTween?.stop();
    this.ringShimmerTimer?.remove(false);
    for (const b of this.bubbleQueue) {
      b.timer?.remove();
      b.group.destroy();
    }
    this.bubbleQueue = [];
    this.clearActivityFx();
    for (const t of this.proxTweens) t.stop();
    this.proxGlow?.destroy();
    this.companionSprite?.destroy();
    this.companionShadow?.destroy();
    super.destroy(fromScene);
  }
}

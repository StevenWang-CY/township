/**
 * Conversations — choreography for every on-screen exchange.
 *
 * The backend says WHO talks and WHAT they say; this module makes it read
 * as a conversation: participants approach and settle into a formation,
 * face one another, the speaker leans in while listeners nod (or shake
 * their heads at a line they disagree with), a thin parchment strip names
 * the topic, and when the exchange ends everyone takes a half-step back,
 * turns away, and drifts off — instead of freezing in place.
 *
 * It owns a registry keyed by conversation id so overlapping exchanges
 * never cancel each other, and every timer it schedules is cancellable so
 * a replay seek can wipe the stage clean in one call (clearAll).
 */
import Phaser from "phaser";
import { RENDER_DPR } from "./config";
import { AgentSprite, LABEL_Y, type BubbleSentiment, type Direction, type GestureKind } from "./AgentSprite";
import type { Pt } from "./NavGrid";
import { PIXEL_FONT, drawPixelPlate, pixelText, reducedMotion } from "./pixelTextures";

export type ConversationKind = "backend" | "encounter";

export interface ConversationSpec {
  id?: string;
  participants: string[];
  /** Landmark name the backend chose (used when participants start far apart). */
  location?: string;
  topic?: string;
}

/** What the choreographer needs from the scene (closures over private state). */
export interface ChoreoHost {
  scene: Phaser.Scene;
  getSprite(id: string): AgentSprite | undefined;
  landmarkEntrance(name: string): Pt | undefined;
  nearestWalkable(p: Pt): Pt;
  findFreeNear(x: number, y: number, opts?: { clearOf?: number; exclude?: AgentSprite }): Pt;
  gatherSlotFor(key: string, cx: number, cy: number, sprite: AgentSprite, opts?: { skipCenter?: boolean }): Pt;
  releaseGatherSlot(agentId: string): void;
  /** A facing chat pair (32 px apart) at the meeting place — the spec's
   *  location, else where the participants dwell, else the nearest
   *  landmark to `near`. Null when the town has no spot registry. */
  chatPair?(ids: [string, string], near: Pt, location?: string): [Pt, Pt] | null;
  /** Walk a resident back to the seat their day gives them (their porch,
   *  their bench, back inside) once an exchange ends. */
  returnToDwell?(agentId: string): void;
  /** Standing spots for a group of three or more at the meeting place
   *  (a facing pair plus porch/lawn/bench seats within reach). */
  chatCluster?(ids: string[], near: Pt, location?: string): Pt[] | null;
  /** Current option id for a resident ("" when unknown). */
  stanceOf(agentId: string): string;
}

interface Convo {
  id: string;
  kind: ConversationKind;
  participants: string[];
  anchor: Pt;
  slots: Map<string, Pt>;
  arrived: Set<string>;
  formed: boolean;
  lastSpeaker?: string;
  lastSpeechAt: number;
  timers: Phaser.Time.TimerEvent[];
}

interface Plate {
  kind: "topic" | "takeaway";
  convoId: string;
  group: Phaser.GameObjects.Container;
  follow: string[];
  timer?: Phaser.Time.TimerEvent;
}

/** Half of the face-to-face gap for a pair (26 px reads as conversational
 *  distance for ~26 px-wide bodies without merging silhouettes). */
const PAIR_HALF_GAP = 16;
/** Participants further than this from the centroid walk to the backend's
 *  named landmark instead of meeting in the middle of nowhere. */
const FAR_PARTICIPANT_PX = 160;
const FAREWELL_STEP_PX = 4;
const DISPERSE_PX = 36;
const MAX_PLATES = 2;
const TAKEAWAY_MS = 3200;
const PLATE_DEPTH = AgentSprite.BUBBLE_DEPTH - 1;

function dominantDir(dx: number, dy: number): Direction {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
}

export class ConversationChoreographer {
  private convos = new Map<string, Convo>();
  private agentConvo = new Map<string, string>();
  private plates: Plate[] = [];
  /** Post-conversation timers (farewells) that outlive their registry entry. */
  private looseTimers: Phaser.Time.TimerEvent[] = [];

  constructor(private readonly host: ChoreoHost) {}

  /* ── Queries ─────────────────────────────────────────────── */

  hasActive(kind?: ConversationKind): boolean {
    if (!kind) return this.convos.size > 0;
    for (const c of this.convos.values()) if (c.kind === kind) return true;
    return false;
  }

  inConversation(agentId: string): boolean {
    return this.agentConvo.has(agentId);
  }

  conversationOf(agentId: string): string | undefined {
    return this.agentConvo.get(agentId);
  }

  /** True once the resident has settled into a formation slot. */
  isFormedParticipant(agentId: string): boolean {
    const id = this.agentConvo.get(agentId);
    const c = id ? this.convos.get(id) : undefined;
    return !!c && c.arrived.has(agentId);
  }

  /* ── Lifecycle ───────────────────────────────────────────── */

  /**
   * Begin a conversation: claim the participants, pick the meeting point,
   * and walk everyone into formation. Returns the registry id, or null when
   * fewer than two participants have sprites in this town.
   */
  start(spec: ConversationSpec, kind: ConversationKind): string | null {
    const ids = spec.participants.filter((id, i, arr) => arr.indexOf(id) === i);
    const sprites = ids
      .map((id) => this.host.getSprite(id))
      .filter((s): s is AgentSprite => !!s && s.active);
    if (sprites.length < 2) return null;
    const id = spec.id ?? `adhoc:${sprites.map((s) => s.agentId).sort().join("+")}`;
    if (this.convos.has(id)) return id;

    // A resident is in at most one conversation; a fresh backend exchange
    // cuts an ambient encounter off cleanly (no farewell choreography).
    for (const s of sprites) {
      const prev = this.agentConvo.get(s.agentId);
      if (prev) this.end(prev, { farewell: false });
    }

    let ax = sprites.reduce((sum, s) => sum + s.x, 0) / sprites.length;
    let ay = sprites.reduce((sum, s) => sum + s.y, 0) / sprites.length;
    const far = sprites.some((s) => Phaser.Math.Distance.Between(s.x, s.y, ax, ay) > FAR_PARTICIPANT_PX);
    if (far && spec.location) {
      const entrance = this.host.landmarkEntrance(spec.location);
      if (entrance) {
        ax = entrance.x;
        ay = entrance.y;
      }
    }
    const anchor = this.host.nearestWalkable({ x: ax, y: ay });

    const convo: Convo = {
      id,
      kind,
      participants: sprites.map((s) => s.agentId),
      anchor,
      slots: new Map(),
      arrived: new Set(),
      formed: false,
      lastSpeechAt: 0,
      timers: [],
    };
    this.convos.set(id, convo);
    for (const s of sprites) this.agentConvo.set(s.agentId, id);

    if (sprites.length === 2) {
      // The resident already on the left takes the left slot: short walks,
      // no crossing paths, and a horizontal flank so both faces stay visible.
      const [l, r] = sprites[0].x <= sprites[1].x ? [sprites[0], sprites[1]] : [sprites[1], sprites[0]];
      const pair = this.host.chatPair?.([l.agentId, r.agentId], anchor, spec.location) ?? null;
      if (pair) {
        // Authored chat spots: a porch step, a park path — never asphalt,
        // never the same tile twice.
        convo.slots.set(l.agentId, pair[0]);
        convo.slots.set(r.agentId, pair[1]);
        convo.anchor = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      } else {
        const left = this.host.findFreeNear(anchor.x - PAIR_HALF_GAP, anchor.y, { clearOf: 24 });
        let right = this.host.findFreeNear(anchor.x + PAIR_HALF_GAP, anchor.y, { clearOf: 24 });
        if (Phaser.Math.Distance.Between(left.x, left.y, right.x, right.y) < 24) {
          right = this.host.findFreeNear(anchor.x + PAIR_HALF_GAP * 2, anchor.y + 12, { clearOf: 24 });
        }
        convo.slots.set(l.agentId, left);
        convo.slots.set(r.agentId, right);
      }
    } else {
      const cluster = this.host.chatCluster?.(sprites.map((s) => s.agentId), anchor, spec.location) ?? null;
      if (cluster && cluster.length === sprites.length) {
        sprites.forEach((s, i) => convo.slots.set(s.agentId, cluster[i]));
        convo.anchor = {
          x: cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length,
          y: cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length,
        };
      } else {
        for (const s of sprites) {
          convo.slots.set(
            s.agentId,
            this.host.gatherSlotFor(`convo:${id}`, anchor.x, anchor.y, s, { skipCenter: true }),
          );
        }
      }
    }
    for (const s of sprites) {
      const slot = convo.slots.get(s.agentId) ?? anchor;
      s.clearLean();
      s.moveToPosition(slot.x, slot.y, () => this.onArrive(id, s));
    }
    if (kind === "backend" && spec.topic) this.showTopic(convo, spec.topic);
    return id;
  }

  private onArrive(id: string, s: AgentSprite) {
    const convo = this.convos.get(id);
    if (!convo || this.agentConvo.get(s.agentId) !== id || !s.active) return;
    convo.arrived.add(s.agentId);
    if (convo.participants.length === 2) {
      const otherId = convo.participants.find((p) => p !== s.agentId);
      const other = otherId ? (convo.slots.get(otherId) ?? this.host.getSprite(otherId)) : undefined;
      if (other) s.faceToward(other.x, other.y);
    } else {
      s.faceToward(convo.anchor.x, convo.anchor.y);
    }
    s.setActivity("talking");
    convo.formed = convo.participants.every((p) => convo.arrived.has(p) || !this.host.getSprite(p));
  }

  /**
   * A line was spoken. The speaker leans toward the group; listeners turn
   * to the speaker and, with a little stagger and some randomness, nod —
   * or shake their heads at a negative line from someone they disagree
   * with. Gestures are quiet (no emote glyph) so the bubble stays the focus.
   */
  onSpeech(agentId: string, sentiment: BubbleSentiment = "neutral") {
    const id = this.agentConvo.get(agentId);
    if (!id) return;
    const convo = this.convos.get(id);
    const speaker = this.host.getSprite(agentId);
    if (!convo || !speaker) return;
    if (convo.lastSpeaker && convo.lastSpeaker !== agentId) {
      this.host.getSprite(convo.lastSpeaker)?.clearLean();
    }
    convo.lastSpeaker = agentId;
    convo.lastSpeechAt = this.host.scene.time.now;
    if (!speaker.isWalking()) speaker.setLean(Math.sign(convo.anchor.x - speaker.x) * 2);

    const speakerStance = this.host.stanceOf(agentId);
    let i = 0;
    for (const pid of convo.participants) {
      if (pid === agentId) continue;
      const listener = this.host.getSprite(pid);
      if (!listener || !listener.active || listener.isWalking() || !convo.arrived.has(pid)) continue;
      listener.faceToward(speaker.x, speaker.y);
      const sameStance = speakerStance !== "" && this.host.stanceOf(pid) === speakerStance;
      const roll = Math.random();
      let gesture: GestureKind | null = null;
      if (sentiment === "negative" && !sameStance) {
        if (roll < 0.35) gesture = "shake_head";
      } else if (roll < 0.6) {
        gesture = "nod";
      }
      if (!gesture) continue;
      const delay = 300 + i * 220 + Math.floor(Math.random() * 200);
      i++;
      convo.timers.push(this.host.scene.time.delayedCall(delay, () => {
        if (this.agentConvo.get(pid) !== id || !listener.active || listener.isWalking()) return;
        listener.playGesture(gesture as GestureKind, { quiet: true });
      }));
    }
  }

  /**
   * End one conversation (scoped by id). An unknown id ends everything
   * without choreography — the capture pipeline relies on that to reset the
   * stage between shots. With `farewell`, participants step back, turn away
   * and drift a few tiles apart, staggered so the group visibly breaks up.
   */
  end(id: string, opts?: { summary?: string; farewell?: boolean }) {
    const convo = this.convos.get(id);
    if (!convo) {
      this.endAll({ farewell: false });
      return;
    }
    this.convos.delete(id);
    for (const t of convo.timers) t.remove(false);
    this.destroyPlatesFor(id);
    if (opts?.summary && opts.summary.trim()) this.showTakeaway(convo, opts.summary.trim());

    const farewell = (opts?.farewell ?? true) && !reducedMotion();
    let i = 0;
    for (const pid of convo.participants) {
      if (this.agentConvo.get(pid) !== id) continue;
      this.agentConvo.delete(pid);
      const s = this.host.getSprite(pid);
      if (!s || !s.active) continue;
      s.clearLean();
      if (convo.participants.length > 2) this.host.releaseGatherSlot(pid);
      const release = () => {
        if (!s.active || this.agentConvo.has(pid)) return; // re-engaged already
        s.setActivity("idle");
        const home = this.host.returnToDwell;
        if (!farewell) {
          if (home) home(pid);
          return;
        }
        const dx = s.x - convo.anchor.x;
        const dy = s.y - convo.anchor.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // Half-step back, then turn away, then go back to the day (or, with
        // no seat registry, wander a couple of tiles off).
        s.nudgeTo(s.x + ux * FAREWELL_STEP_PX, s.y + uy * FAREWELL_STEP_PX);
        this.looseTimers.push(this.host.scene.time.delayedCall(180, () => {
          if (!s.active || this.agentConvo.has(pid) || s.isWalking()) return;
          s.faceToward(s.x + ux * 10, s.y + uy * 10);
        }));
        this.looseTimers.push(this.host.scene.time.delayedCall(420, () => {
          if (!s.active || this.agentConvo.has(pid) || s.isWalking()) return;
          if (home) {
            home(pid);
            return;
          }
          const goal = this.host.findFreeNear(
            convo.anchor.x + ux * DISPERSE_PX,
            convo.anchor.y + uy * DISPERSE_PX,
            { clearOf: 30, exclude: s },
          );
          if (Phaser.Math.Distance.Between(s.x, s.y, goal.x, goal.y) <= 48) {
            s.moveToPosition(goal.x, goal.y, undefined, { arriveFacing: dominantDir(ux, uy) });
          }
        }));
      };
      if (i === 0) release();
      else this.looseTimers.push(this.host.scene.time.delayedCall(180 * i, release));
      i++;
    }
  }

  endAll(opts?: { farewell?: boolean }) {
    for (const id of [...this.convos.keys()]) this.end(id, { farewell: opts?.farewell ?? false });
  }

  /** Wipe every conversation, timer and plate with no choreography — the
   *  replay seek path. Sprites are re-posed by the caller afterwards. */
  clearAll() {
    for (const convo of this.convos.values()) {
      for (const t of convo.timers) t.remove(false);
      for (const pid of convo.participants) this.host.getSprite(pid)?.clearLean();
    }
    this.convos.clear();
    this.agentConvo.clear();
    for (const t of this.looseTimers) t.remove(false);
    this.looseTimers = [];
    for (const p of this.plates) this.destroyPlate(p);
    this.plates = [];
  }

  /** Per-frame: keep plates glued to their group; prune finished timers. */
  update() {
    for (const p of [...this.plates]) this.positionPlate(p);
    if (this.looseTimers.length > 16) {
      this.looseTimers = this.looseTimers.filter((t) => !t.hasDispatched);
    }
  }

  destroy() {
    this.clearAll();
  }

  /* ── Plates: topic strip + takeaway card ─────────────────── */

  private showTopic(convo: Convo, topic: string) {
    if (this.plates.filter((p) => p.kind === "topic").length >= MAX_PLATES) return;
    const label = topic.length > 30 ? `${topic.slice(0, 29)}…` : topic;
    const txt = this.caption(label, 0x5a4a34);
    const w = Math.ceil(txt.width + 14);
    const h = 14;
    const g = this.host.scene.add.graphics();
    drawPixelPlate(g, -w / 2, 0, w, h, { shadow: 0.12, ink: 0x7a6a50, fill: 0xf3e9d3 });
    txt.setPosition(0, h / 2);
    const group = this.host.scene.add.container(0, 0, [g, txt]).setDepth(PLATE_DEPTH);
    const plate: Plate = { kind: "topic", convoId: convo.id, group, follow: convo.participants.slice() };
    this.plates.push(plate);
    this.positionPlate(plate);
    this.revealPlate(group, 0.94);
  }

  private showTakeaway(convo: Convo, summary: string) {
    if (this.plates.filter((p) => p.kind === "takeaway").length >= MAX_PLATES) return;
    const body = summary.length > 96 ? `${summary.slice(0, 95)}…` : summary;
    const header = this.caption("TAKEAWAY", 0x8a7a5c).setOrigin(0.5, 0);
    const txt = this.host.scene.add.text(0, 0, body, {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "9px",
      color: "#2c2416",
      align: "center",
      wordWrap: { width: 150, useAdvancedWrap: true },
      lineSpacing: 1,
      resolution: RENDER_DPR,
    }).setOrigin(0.5, 0);
    const pad = 7;
    const w = Math.ceil(Math.max(txt.width, header.width) + pad * 2);
    const h = Math.ceil(header.height + 2 + txt.height + pad * 2);
    const g = this.host.scene.add.graphics();
    drawPixelPlate(g, -w / 2, 0, w, h, { shadow: 0.14 });
    header.setPosition(0, pad);
    txt.setPosition(0, pad + header.height + 2);
    const group = this.host.scene.add.container(0, 0, [g, header, txt]).setDepth(PLATE_DEPTH);
    const plate: Plate = { kind: "takeaway", convoId: convo.id, group, follow: convo.participants.slice() };
    this.plates.push(plate);
    this.positionPlate(plate);
    this.revealPlate(group, 1);
    plate.timer = this.host.scene.time.delayedCall(TAKEAWAY_MS, () => {
      if (reducedMotion()) {
        this.destroyPlate(plate);
        return;
      }
      this.host.scene.tweens.add({
        targets: group,
        alpha: 0,
        duration: 220,
        ease: "Quad.easeIn",
        onComplete: () => this.destroyPlate(plate),
      });
    });
  }

  /** Small-caps caption in the pixel font (web type where it is missing). */
  private caption(text: string, ink: number): Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text {
    const scene = this.host.scene;
    if (scene.cache.bitmapFont.has(PIXEL_FONT)) {
      return scene.add.bitmapText(0, 0, PIXEL_FONT, pixelText(text)).setTint(ink).setOrigin(0.5, 0.5);
    }
    return scene.add.text(0, 0, text.toUpperCase(), {
      fontFamily: "Inter, 'Helvetica Neue', sans-serif",
      fontSize: "7px",
      fontStyle: "bold",
      color: `#${ink.toString(16).padStart(6, "0")}`,
      resolution: RENDER_DPR,
    }).setOrigin(0.5, 0.5);
  }

  private revealPlate(group: Phaser.GameObjects.Container, alpha: number) {
    if (reducedMotion()) {
      group.setAlpha(alpha);
      return;
    }
    group.setAlpha(0).setScale(0.7);
    this.host.scene.tweens.add({
      targets: group,
      alpha,
      scaleX: 1,
      scaleY: 1,
      duration: 200,
      ease: "Stepped",
      easeParams: [4],
    });
  }

  private positionPlate(p: Plate) {
    const sprites = p.follow
      .map((id) => this.host.getSprite(id))
      .filter((s): s is AgentSprite => !!s && s.active);
    if (sprites.length === 0) {
      this.destroyPlate(p);
      return;
    }
    const midX = sprites.reduce((sum, s) => sum + s.x, 0) / sprites.length;
    const bottom = Math.max(...sprites.map((s) => s.y));
    p.group.setPosition(Math.round(midX), Math.round(bottom + LABEL_Y + 16));
  }

  private destroyPlatesFor(convoId: string) {
    for (const p of this.plates.filter((x) => x.convoId === convoId && x.kind === "topic")) this.destroyPlate(p);
  }

  private destroyPlate(p: Plate) {
    p.timer?.remove(false);
    this.host.scene.tweens.killTweensOf(p.group);
    p.group.destroy();
    this.plates = this.plates.filter((x) => x !== p);
  }
}

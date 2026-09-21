/**
 * CivicLayer — the election as the town itself shows it.
 *
 * The simulation's phases leave marks on the world: yard signs on lawns
 * take a resident's colour once opinions are public, the civic banners
 * drift toward the town's leader, the notice board pins each headline as
 * it lands, the polling place opens for the decide phase (VOTE sign,
 * ballot box, a roped lane, a warm light after dusk), and results hang
 * bunting in the winner's colour, post a tally at the kiosk, and light the
 * park brazier in the evening.
 *
 * Everything is derived from one `CivicEnv` value through a single
 * idempotent `apply(env, residents, { animate })`: a replay seek passes
 * `animate: false` and lands on the identical final state with no
 * transient effects, while paced playback gets the stepped flips, drops
 * and pops. All props are registry stamps from the tile kit
 * (`stampDefs.json`) or canvas pixel textures — no vector shapes.
 */
import Phaser from "phaser";
import { ensureSingleTexture, ensureStampTexture, propDepth, type MapAnchor } from "./SceneAmbience";
import {
  PIXEL_FONT,
  PIXEL_FONT_OUTLINED,
  drawPixelPlate,
  ensureDitheredDiscTexture,
  pixelText,
  reducedMotion,
} from "./pixelTextures";
import type { PartOfDay } from "./WorldClock";
import type { Pt } from "./NavGrid";

export type ElectionPhase = "seed" | "converse" | "news" | "opinion" | "decide" | "results";

export interface CivicEnv {
  phase: ElectionPhase;
  round: number;
  totalRounds: number;
  /** Opinions are public: signs and banners may take colour. */
  opinionRevealed: boolean;
  /** Every headline so far, oldest first. */
  headlines: string[];
  /** This town's stance counts by option id (no undecided). */
  tally: Record<string, number>;
  /** Leading option id, or null on a tie / no stances. */
  leader: string | null;
  /** Final result once the run ended (winner null on a tie). */
  result: { winner: string | null; tally: Record<string, number> } | null;
  /** Short option labels for the tally board. */
  labels: Record<string, string>;
}

export interface CivicResident {
  id: string;
  /** Landmark name the resident calls home ("" when unknown). */
  home: string;
  optionId: string;
  color: string;
  undecided: boolean;
}

export interface CivicHost {
  scene: Phaser.Scene;
  optionColor(id: string): string;
  landmarkEntrance(name: string): Pt | undefined;
  nearestWalkable(p: Pt): Pt;
}

export interface CivicSnapshot {
  phase: ElectionPhase | null;
  signsTinted: number;
  signs: number;
  banner: string | null;
  headlines: number;
  pollingOpen: boolean;
  bunting: string | null;
  tallyRows: number;
  brazierLit: boolean;
}

const CREAM = 0xf3e9d3;
const INK = 0x3a3226;
/** Above every y-sorted sprite, below the roof layer and the sky tint. */
const BOARD_DEPTH = 4995;
const GLOW_DEPTH = 6001;
const GLOW_PARTS: ReadonlySet<PartOfDay> = new Set<PartOfDay>(["dusk", "night", "dawn"]);
const MAX_SHEETS = 3;
const CAPTION_MS = 8000;

function hexToInt(color: string): number {
  return Phaser.Display.Color.HexStringToColor(color).color;
}

function intToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Pinned paper sheet: cream, two ink lines, a red pin, a shaded edge. */
function ensureSheetTexture(scene: Phaser.Scene): string {
  const key = "px-sheet";
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, 6, 7);
  if (!canvas) return key;
  const ctx = canvas.context;
  ctx.fillStyle = "#f4ead6";
  ctx.fillRect(0, 0, 6, 7);
  ctx.fillStyle = "#c9bfa8";
  ctx.fillRect(5, 0, 1, 7);
  ctx.fillRect(0, 6, 6, 1);
  ctx.fillStyle = "#6b5a44";
  ctx.fillRect(1, 2, 4, 1);
  ctx.fillRect(1, 4, 3, 1);
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(2, 0, 2, 1);
  canvas.refresh();
  return key;
}

function ensurePollGlowTexture(scene: Phaser.Scene): string {
  return ensureDitheredDiscTexture(scene, "px-poll-glow", 72, [255, 196, 110], (t) => (1 - t) ** 1.5 * 0.8, 2);
}

function ensureFireGlowTexture(scene: Phaser.Scene): string {
  return ensureDitheredDiscTexture(scene, "px-fire-glow", 56, [255, 170, 80], (t) => (1 - t) ** 1.4 * 0.9, 2);
}

/** Fit a headline to the pixel font: uppercase, ≤ `max` chars on a word edge. */
function fitCaption(text: string, max = 30): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const edge = cut.lastIndexOf(" ");
  return `${(edge > max * 0.5 ? cut.slice(0, edge) : cut).trim()}-`;
}

interface Sign {
  anchor: MapAnchor;
  post: Phaser.GameObjects.Image;
  board: Phaser.GameObjects.Image;
  color: number | null;
  flipping?: Phaser.Tweens.Tween;
}

interface Banner {
  img: Phaser.GameObjects.Image;
  color: number;
  lerp?: Phaser.Tweens.Tween;
}

export class CivicLayer {
  private readonly scene: Phaser.Scene;
  private signs: Sign[] = [];
  private banners: Banner[] = [];
  private board?: { anchor: MapAnchor; sheets: Phaser.GameObjects.Image[]; caption?: Phaser.GameObjects.Container; captionTimer?: Phaser.Time.TimerEvent };
  private headlines: string[] = [];
  private pollAnchor?: MapAnchor;
  private pollObjects: Phaser.GameObjects.GameObject[] = [];
  private pollGlow?: Phaser.GameObjects.Image;
  private pollingOpen = false;
  private buntingAnchor?: MapAnchor;
  private bunting: Phaser.GameObjects.Image[] = [];
  private buntingColor: number | null = null;
  private tally?: Phaser.GameObjects.Container;
  private tallyKey = "";
  private brazierAnchor?: MapAnchor;
  private fire?: Phaser.GameObjects.Sprite;
  private fireGlow?: Phaser.GameObjects.Image;
  private brazierLit = false;
  private part: PartOfDay = "morning";
  private env: CivicEnv | null = null;
  private seatCache = new Map<string, number>();
  /** Lamp posts near the polling door decide which side the VOTE sign takes. */
  private lamps: MapAnchor[] = [];

  constructor(private readonly host: CivicHost, anchors: MapAnchor[]) {
    this.scene = host.scene;
    const seen = new Set<string>();
    for (const a of anchors) {
      switch (a.kind) {
        case "yardsign": {
          // The generator may seat two signs on one lawn cell; one is enough.
          const k = `${Math.round(a.x)}:${Math.round(a.y)}`;
          if (seen.has(k)) break;
          seen.add(k);
          const postKey = ensureSingleTexture(this.scene, "yard_post");
          const boardKey = ensureSingleTexture(this.scene, "yard_board");
          if (!postKey || !boardKey) break;
          const post = this.scene.add.image(a.x, a.y, postKey).setOrigin(0.5, 1).setDepth(propDepth(a.y));
          const board = this.scene.add.image(a.x, a.y - 16, boardKey).setOrigin(0.5, 1).setDepth(propDepth(a.y) + 0.5);
          this.signs.push({ anchor: a, post, board, color: null });
          break;
        }
        case "banner": {
          const key = ensureStampTexture(this.scene, "banner_plain");
          if (!key) break;
          const img = this.scene.add.image(a.x, a.y, key).setOrigin(0.5, 1).setDepth(propDepth(a.y)).setTint(CREAM);
          this.banners.push({ img, color: CREAM });
          break;
        }
        case "noticeboard":
          this.board = this.board ?? { anchor: a, sheets: [] };
          break;
        case "pollplace":
          this.pollAnchor = this.pollAnchor ?? a;
          break;
        case "bunting":
          this.buntingAnchor = this.buntingAnchor ?? a;
          break;
        case "brazier":
          this.brazierAnchor = this.brazierAnchor ?? a;
          break;
        case "lamp":
          this.lamps.push(a);
          break;
      }
    }
    // Stable order for seat assignment: left to right, top to bottom.
    this.signs.sort((p, q) => p.anchor.x - q.anchor.x || p.anchor.y - q.anchor.y);
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  apply(env: CivicEnv, residents: CivicResident[], opts: { animate: boolean }) {
    const animate = opts.animate && !reducedMotion();
    const prev = this.env;
    this.env = env;

    // Yard signs: one seat per resident, a resident's colour once public.
    const seats = this.assignSeats(residents);
    this.signs.forEach((sign, i) => {
      const r = seats.get(i);
      const color = env.opinionRevealed && r && !r.undecided ? hexToInt(r.color) : null;
      this.setSignColor(sign, color, animate);
    });

    // Banners follow the leader; a tie (or nothing public yet) is cream.
    const bannerColor = env.opinionRevealed && env.leader ? hexToInt(this.host.optionColor(env.leader)) : CREAM;
    for (const b of this.banners) this.setBannerColor(b, bannerColor, animate);

    // Notice board: the last three headlines, newest on the right.
    const lastPrev = prev?.headlines[prev.headlines.length - 1];
    const lastNext = env.headlines[env.headlines.length - 1];
    this.setHeadlines(env.headlines.slice(-MAX_SHEETS), animate);
    if (animate && lastNext && lastNext !== lastPrev) this.showCaption(lastNext);
    else if (!animate) this.clearCaption();

    // Polling place opens for the decide phase and stays dressed for results.
    this.setPollingOpen(env.phase === "decide" || env.phase === "results", animate);

    // Results: bunting, tally, brazier.
    this.setResults(env.phase === "results" ? env : null, animate);
  }

  setPartOfDay(part: PartOfDay) {
    this.part = part;
    this.syncLights();
  }

  isPollingOpen(): boolean {
    return this.pollingOpen;
  }

  getPollingPlace(): { name: string; x: number; y: number } | null {
    const a = this.pollAnchor;
    return a ? { name: a.name ?? "", x: a.x, y: a.y } : null;
  }

  /** Where a voter stands to cast: just in front of the ballot box. */
  getBallotBoxPoint(): Pt | null {
    const a = this.pollAnchor;
    if (!a) return null;
    return this.host.nearestWalkable({ x: a.x + 16, y: a.y + 20 });
  }

  /** Queue slots south of the rope lane, nearest the box first. */
  getBallotQueueSlots(n: number): Pt[] {
    const a = this.pollAnchor;
    if (!a) return [];
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      out.push(this.host.nearestWalkable({ x: a.x - 8 - 28 * i, y: a.y + 46 }));
    }
    return out;
  }

  /** The door side with no lamp post in the way (left, else right, else far left). */
  private signSide(a: MapAnchor): number {
    const blocked = (dx: number) => this.lamps.some((l) => Math.abs(l.x - (a.x + dx)) < 18 && Math.abs(l.y - (a.y + 4)) < 26);
    if (!blocked(-16)) return -16;
    if (!blocked(38)) return 38;
    return -40;
  }

  snapshot(): CivicSnapshot {
    return {
      phase: this.env?.phase ?? null,
      signs: this.signs.length,
      signsTinted: this.signs.filter((s) => s.color !== null).length,
      banner: this.banners[0] ? intToHex(this.banners[0].color) : null,
      headlines: this.headlines.length,
      pollingOpen: this.pollingOpen,
      bunting: this.buntingColor === null ? null : intToHex(this.buntingColor),
      tallyRows: this.tally ? this.tally.getData("rows") as number : 0,
      brazierLit: this.brazierLit,
    };
  }

  destroy() {
    for (const s of this.signs) { s.flipping?.stop(); s.post.destroy(); s.board.destroy(); }
    for (const b of this.banners) { b.lerp?.stop(); b.img.destroy(); }
    this.signs = [];
    this.banners = [];
    if (this.board) {
      for (const sheet of this.board.sheets) sheet.destroy();
      this.board.captionTimer?.remove(false);
      this.board.caption?.destroy();
      this.board.sheets = [];
    }
    this.clearPoll();
    this.clearResults();
  }

  /* ── Yard signs ─────────────────────────────────────────────────────── */

  /**
   * Deterministic seats: residents with a stance first (a lawn with a sign
   * to show beats a blank one when seats are scarce), then the undecided,
   * each sorted by id; every resident takes the first free sign on their
   * own home's lawn, then (second pass) the free sign nearest their home.
   * Signs may stay blank; nobody gets two.
   */
  private assignSeats(residents: CivicResident[]): Map<number, CivicResident> {
    const sorted = [...residents].sort((p, q) =>
      Number(p.undecided) - Number(q.undecided) || p.id.localeCompare(q.id));
    const key = sorted.map((r) => `${r.id}@${r.home}`).join("|") + `#${this.signs.length}`;
    const cached = this.seatCache.get(key);
    const out = new Map<number, CivicResident>();
    if (cached !== undefined) {
      // Same roster → same seats; refresh the resident records (stance moves).
      const order = this.seatOrder(sorted);
      order.forEach((idx, i) => { if (idx >= 0) out.set(idx, sorted[i]); });
      return out;
    }
    const order = this.seatOrder(sorted);
    order.forEach((idx, i) => { if (idx >= 0) out.set(idx, sorted[i]); });
    this.seatCache.set(key, 1);
    return out;
  }

  private seatOrder(sorted: CivicResident[]): number[] {
    const taken = new Set<number>();
    const result: number[] = sorted.map(() => -1);
    // Pass 1: own lawn.
    sorted.forEach((r, i) => {
      if (!r.home) return;
      const idx = this.signs.findIndex((s, j) => !taken.has(j) && (s.anchor.props?.home ?? "") === r.home);
      if (idx >= 0) { taken.add(idx); result[i] = idx; }
    });
    // Pass 2: nearest free sign to home (or the first free sign).
    sorted.forEach((r, i) => {
      if (result[i] >= 0) return;
      const home = r.home ? this.host.landmarkEntrance(r.home) : undefined;
      let best = -1;
      let bestD = Infinity;
      this.signs.forEach((s, j) => {
        if (taken.has(j)) return;
        const d = home ? Phaser.Math.Distance.Between(home.x, home.y, s.anchor.x, s.anchor.y) : j;
        if (d < bestD) { bestD = d; best = j; }
      });
      if (best >= 0) { taken.add(best); result[i] = best; }
    });
    return result;
  }

  private setSignColor(sign: Sign, color: number | null, animate: boolean) {
    if (sign.color === color && !sign.flipping) return;
    sign.flipping?.stop();
    sign.flipping = undefined;
    sign.color = color;
    const paint = () => {
      if (color === null) sign.board.clearTint();
      else sign.board.setTint(color);
    };
    if (!animate) {
      sign.board.setScale(1, 1);
      paint();
      return;
    }
    // A stepped flip: the board turns edge-on, repaints, and turns back.
    sign.flipping = this.scene.tweens.add({
      targets: sign.board,
      scaleX: { from: 1, to: 0.1 },
      duration: 160,
      ease: "Stepped",
      easeParams: [3],
      onComplete: () => {
        paint();
        sign.flipping = this.scene.tweens.add({
          targets: sign.board,
          scaleX: { from: 0.1, to: 1 },
          duration: 160,
          ease: "Stepped",
          easeParams: [3],
          onComplete: () => { sign.flipping = undefined; sign.board.setScale(1, 1); },
        });
      },
    });
  }

  /* ── Banners ────────────────────────────────────────────────────────── */

  private setBannerColor(b: Banner, color: number, animate: boolean) {
    if (b.color === color && !b.lerp) return;
    b.lerp?.stop();
    b.lerp = undefined;
    const from = Phaser.Display.Color.ValueToColor(b.color);
    const to = Phaser.Display.Color.ValueToColor(color);
    b.color = color;
    if (!animate) {
      b.img.setTint(color);
      return;
    }
    // Four stepped shades between the old and the new colour.
    b.lerp = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 900,
      ease: "Stepped",
      easeParams: [4],
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 100, Math.round(t * 100));
        b.img.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      },
      onComplete: () => { b.img.setTint(color); b.lerp = undefined; },
    });
  }

  /* ── Notice board ───────────────────────────────────────────────────── */

  private sheetSlot(i: number): Pt {
    const a = this.board!.anchor;
    // Three columns across the cork face (the kiosk is a 2x2 stamp above
    // its anchor); the shallow y offsets keep the pins from lining up.
    return { x: a.x - 9 + i * 8, y: a.y - 27 + (i % 2) * 2 };
  }

  private setHeadlines(headlines: string[], animate: boolean) {
    if (!this.board) { this.headlines = headlines; return; }
    const same = headlines.length === this.headlines.length && headlines.every((h, i) => h === this.headlines[i]);
    if (same) return;
    const key = ensureSheetTexture(this.scene);
    const b = this.board;
    // Rebuild the pinned set; only a newly appended sheet drops in.
    const appended = animate && headlines.length > 0
      && this.headlines.length < headlines.length
      && headlines.slice(0, this.headlines.length).every((h, i) => h === this.headlines[i]);
    for (const sheet of b.sheets) sheet.destroy();
    b.sheets = [];
    headlines.forEach((_, i) => {
      const p = this.sheetSlot(i);
      const sheet = this.scene.add.image(p.x, p.y, key).setOrigin(0.5, 0).setDepth(BOARD_DEPTH);
      b.sheets.push(sheet);
      if (appended && i === headlines.length - 1) {
        sheet.setY(p.y - 18).setAlpha(0.6);
        this.scene.tweens.add({
          targets: sheet,
          y: p.y,
          alpha: 1,
          duration: 260,
          ease: "Stepped",
          easeParams: [4],
        });
      }
    });
    this.headlines = headlines;
  }

  private clearCaption() {
    if (!this.board) return;
    this.board.captionTimer?.remove(false);
    this.board.captionTimer = undefined;
    this.board.caption?.destroy();
    this.board.caption = undefined;
  }

  private showCaption(text: string) {
    if (!this.board) return;
    const b = this.board;
    this.clearCaption();
    const label = pixelText(fitCaption(text));
    const w = 12 + label.length * 6;
    const h = 16;
    const g = this.scene.add.graphics();
    drawPixelPlate(g, -w / 2, 0, w, h, { shadow: 0.12, ink: 0x7a6a50, fill: CREAM });
    const txt = this.scene.cache.bitmapFont.has(PIXEL_FONT)
      ? this.scene.add.bitmapText(-w / 2 + 6, 4, PIXEL_FONT, label).setTint(INK)
      : this.scene.add.text(-w / 2 + 6, 3, label, { fontFamily: "Inter, sans-serif", fontSize: "9px", color: "#3a3226" });
    const group = this.scene.add.container(b.anchor.x, b.anchor.y - 52, [g, txt]).setDepth(BOARD_DEPTH + 1);
    b.caption = group;
    group.setAlpha(0);
    this.scene.tweens.add({ targets: group, alpha: 1, y: b.anchor.y - 56, duration: 200, ease: "Stepped", easeParams: [3] });
    b.captionTimer = this.scene.time.delayedCall(CAPTION_MS, () => {
      this.scene.tweens.add({
        targets: group,
        alpha: 0,
        duration: 260,
        onComplete: () => { if (b.caption === group) b.caption = undefined; group.destroy(); },
      });
    });
  }

  /* ── Polling place ──────────────────────────────────────────────────── */

  private setPollingOpen(open: boolean, animate: boolean) {
    if (open === this.pollingOpen) return;
    this.pollingOpen = open;
    if (!open) { this.clearPoll(); return; }
    const a = this.pollAnchor;
    if (!a) return;
    const depth = propDepth(a.y + 12);
    const place = (key: string | null, x: number, y: number, d = depth): Phaser.GameObjects.Image | null => {
      if (!key) return null;
      const img = this.scene.add.image(x, y, key).setOrigin(0.5, 1).setDepth(d);
      this.pollObjects.push(img);
      return img;
    };
    const items: Array<Phaser.GameObjects.Image | null> = [];
    // The ballot box just right of the door on the apron; the VOTE sign on
    // whichever side of the door the map left clear of lamp posts.
    items.push(place(ensureSingleTexture(this.scene, "ballot_box"), a.x + 16, a.y + 4, propDepth(a.y + 4)));
    items.push(place(ensureStampTexture(this.scene, "vote_sign"), a.x + this.signSide(a), a.y + 4, propDepth(a.y + 4)));
    // A short roped lane below the apron: post, rope, post. Voters queue
    // south of it and step up to the box one at a time.
    const stanchion = ensureSingleTexture(this.scene, "stanchion");
    const rope = ensureSingleTexture(this.scene, "rope_h");
    items.push(place(stanchion, a.x - 40, a.y + 30, propDepth(a.y + 30)));
    items.push(place(rope, a.x - 24, a.y + 30, propDepth(a.y + 30)));
    items.push(place(stanchion, a.x - 8, a.y + 30, propDepth(a.y + 30)));
    // Warm light over the door after dusk (lit from syncLights).
    this.pollGlow = this.scene.add.image(a.x, a.y - 14, ensurePollGlowTexture(this.scene))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(GLOW_DEPTH)
      .setAlpha(0);
    this.pollObjects.push(this.pollGlow);
    this.syncLights();
    if (!animate) return;
    items.forEach((img, i) => {
      if (!img) return;
      img.setScale(1, 0.1);
      this.scene.tweens.add({
        targets: img,
        scaleY: 1,
        duration: 220,
        delay: 70 * i,
        ease: "Stepped",
        easeParams: [3],
      });
    });
  }

  private clearPoll() {
    for (const o of this.pollObjects) o.destroy();
    this.pollObjects = [];
    this.pollGlow = undefined;
  }

  /* ── Results ────────────────────────────────────────────────────────── */

  private setResults(env: CivicEnv | null, animate: boolean) {
    if (!env) { this.clearResults(); return; }
    const winner = env.result?.winner ?? null;
    const color = winner ? hexToInt(this.host.optionColor(winner)) : CREAM;

    // Bunting along the civic wall.
    if (this.buntingAnchor && (this.bunting.length === 0 || this.buntingColor !== color)) {
      const a = this.buntingAnchor;
      const span = Math.max(2, Math.min(16, Number(a.props?.span) || 6));
      const key = ensureSingleTexture(this.scene, "bunting_h");
      if (this.bunting.length === 0 && key) {
        const x0 = a.x - (span * 16) / 2 + 8;
        for (let i = 0; i < span; i++) {
          const flag = this.scene.add.image(x0 + i * 16, a.y, key).setOrigin(0.5, 1).setDepth(propDepth(a.y)).setTint(color);
          this.bunting.push(flag);
          if (animate) {
            flag.setAlpha(0).setY(a.y - 6);
            this.scene.tweens.add({ targets: flag, alpha: 1, y: a.y, duration: 200, delay: 60 * i, ease: "Stepped", easeParams: [3] });
          }
        }
      } else {
        for (const flag of this.bunting) flag.setTint(color);
      }
      this.buntingColor = color;
    }

    // Tally posted at the kiosk.
    const rows = Object.entries(env.result?.tally ?? env.tally)
      .filter(([, n]) => n > 0)
      .sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))
      .slice(0, 4);
    const key = rows.map(([id, n]) => `${id}:${n}`).join(",");
    if (this.board && key !== this.tallyKey) {
      this.tally?.destroy();
      this.tally = rows.length ? this.buildTally(rows, env.labels) : undefined;
      this.tallyKey = key;
      if (this.tally && animate) {
        const y = this.tally.y;
        this.tally.setAlpha(0).setY(y + 6);
        this.scene.tweens.add({ targets: this.tally, alpha: 1, y, duration: 220, ease: "Stepped", easeParams: [3] });
      }
    }

    // Brazier: lit in the evening once results are in.
    this.brazierLit = Boolean(this.brazierAnchor);
    this.syncLights();
  }

  /**
   * A small results sheet leaning against the kiosk base: one row per
   * option — colour swatch, count, label — y-sorted with the residents so
   * the crowd reading it stands in front of it.
   */
  private buildTally(rows: Array<[string, number]>, labels: Record<string, string>): Phaser.GameObjects.Container {
    const a = this.board!.anchor;
    const rowH = 9;
    const labelLen = Math.max(...rows.map(([id]) => Math.min(9, (labels[id] ?? id).length)));
    const w = 6 + 6 + 4 + 12 + 4 + labelLen * 6 + 6;
    const h = 5 + rows.length * rowH + 3;
    const g = this.scene.add.graphics();
    drawPixelPlate(g, -w / 2, 0, w, h, { shadow: 0.12, ink: 0x7a6a50, fill: CREAM });
    const children: Phaser.GameObjects.GameObject[] = [g];
    const hasFont = this.scene.cache.bitmapFont.has(PIXEL_FONT);
    rows.forEach(([id, n], i) => {
      const y = 5 + i * rowH;
      const color = hexToInt(this.host.optionColor(id));
      g.fillStyle(color, 1);
      g.fillRect(-w / 2 + 6, y, 6, 6);
      const count = pixelText(String(n).padStart(2, " "));
      const label = pixelText((labels[id] ?? id).slice(0, 9));
      if (hasFont) {
        children.push(this.scene.add.bitmapText(-w / 2 + 16, y, PIXEL_FONT, count).setTint(INK));
        children.push(this.scene.add.bitmapText(-w / 2 + 32, y, PIXEL_FONT, label).setTint(INK));
      }
    });
    const c = this.scene.add.container(a.x, a.y - 2, children).setDepth(propDepth(a.y + h));
    c.setData("rows", rows.length);
    return c;
  }

  private clearResults() {
    for (const flag of this.bunting) flag.destroy();
    this.bunting = [];
    this.buntingColor = null;
    this.tally?.destroy();
    this.tally = undefined;
    this.tallyKey = "";
    this.brazierLit = false;
    this.syncLights();
  }

  /* ── Lights ─────────────────────────────────────────────────────────── */

  private syncLights() {
    const dark = GLOW_PARTS.has(this.part);
    if (this.pollGlow) this.pollGlow.setAlpha(this.pollingOpen && dark ? 0.32 : 0);
    const wantFire = this.brazierLit && dark && Boolean(this.brazierAnchor);
    if (wantFire && !this.fire) {
      const a = this.brazierAnchor!;
      if (this.scene.textures.exists("campfire")) {
        const total = this.scene.textures.get("campfire").frameTotal - 1;
        if (!this.scene.anims.exists("campfire-burn") && total > 1) {
          this.scene.anims.create({
            key: "campfire-burn",
            frames: this.scene.anims.generateFrameNumbers("campfire", { start: 0, end: total - 1 }),
            frameRate: 8,
            repeat: -1,
          });
        }
        this.fire = this.scene.add.sprite(a.x, a.y - 8, "campfire").setOrigin(0.5, 1).setScale(0.6).setDepth(propDepth(a.y) + 0.5);
        if (this.scene.anims.exists("campfire-burn") && !reducedMotion()) this.fire.play("campfire-burn");
        this.fireGlow = this.scene.add.image(a.x, a.y - 12, ensureFireGlowTexture(this.scene))
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(GLOW_DEPTH)
          .setAlpha(0.3);
      }
    } else if (!wantFire && this.fire) {
      this.fire.destroy();
      this.fireGlow?.destroy();
      this.fire = undefined;
      this.fireGlow = undefined;
    }
  }
}

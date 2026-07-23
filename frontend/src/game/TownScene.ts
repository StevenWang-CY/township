/**
 * TownScene — the living pixel town.
 *
 * ── Capture hooks (for the screenshot / GIF pipeline) ──────────────────
 * Open any town with `?capture=1` to get a fixed-seed capture scene:
 *   • `Math.random` is replaced with a seeded mulberry32 PRNG (fixed seed),
 *     which stabilizes Phaser.Math.Between wander/encounter choices.
 *   • The world clock starts at 16:30 (golden hour → dusk within a minute
 *     of real time at the default 60x speed).
 * The scene also exposes `window.__town` with scriptable controls:
 *   __town.setWorldTime(h, m?)                  — jump the clock (drives dusk pass)
 *   __town.setWeather("clear"|"rain"|...)      — force weather
 *   __town.panTo(x, y)                          — ease the camera to a point
 *   __town.triggerConversation(idA, idB)        — spotlight two agents talking
 *   __town.triggerOpinionShift(agentId, optionId) — ring morph + confetti + ballot
 *   __town.triggerNews(headline?)               — newspaper drop + convergence
 * (`window.__townshipScene` remains as the raw scene handle for debugging.)
 */
import Phaser from "phaser";
import { appUrl } from "../lib/assetUrl";
import { AgentSprite, type AgentActivity, type GestureKind } from "./AgentSprite";
import { PlayerSprite } from "./PlayerSprite";
import { townAccent, townBgColor, townMapKey } from "./config";
import type { AgentState, TownId, LandmarkData, TownData, WeatherKind } from "../types/messages";
import type { UserProfile } from "../context/UserProfileContext";
import {
  AGENT_CUSTOMIZATION,
  ALL_ACCESSORY_SHEETS,
  ALL_CHARACTER_KEYS,
  ALL_CUSTOM_SHEETS,
  resolveAgentSprite,
} from "./spriteCustomization";
import { composeTownAmbience, type AmbienceHandle, type MapAnchor } from "./SceneAmbience";
import { WorldClock } from "./WorldClock";
import { Routine, type RoutineEntry } from "./Routine";
import { pickExchange } from "./AmbientLines";
import { landmarksFor } from "../hooks/useTownData";
import { WeatherScene } from "./WeatherScene";
import {
  ensureNewspaperTexture,
  ensureSquareTexture,
  ensureVignetteTexture,
  ensureWindowGlowTexture,
  mulberry32,
  reducedMotion,
} from "./pixelTextures";
import windowGids from "./windowGids.json";
import { DEMO_MODE } from "../demo/demoMode";

/** Authored art is declared by scenario data, never inferred from a town id. */
export function hasAuthoredTownMap(mapPath?: string | null): boolean {
  return typeof mapPath === "string" && mapPath.startsWith("assets/maps/");
}

/* ── Helper: fetch town data (single source of truth) ───────── */

async function fetchTownData(townId: TownId): Promise<TownData | null> {
  // The static replay receives its authoritative town payload through
  // useTownData → setTownData; avoid a guaranteed /api 404 on GitHub Pages.
  if (DEMO_MODE) return null;
  try {
    const r = await fetch(`/api/towns/${townId}`);
    if (!r.ok) return null;
    return (await r.json()) as TownData;
  } catch {
    return null;
  }
}

// Generic fallback idle thoughts (used until per-agent banks are wired).
const IDLE_THOUGHTS = [
  "I should read the full proposal.",
  "There are real tradeoffs here.",
  "I wonder what my neighbors think.",
  "I'm still making up my mind…",
  "The household budget is tight.",
  "Services have to work for everyone.",
  "I want facts, not another slogan.",
  "This decision matters.",
  "That commute gets longer every year.",
  "The local economy feels uncertain.",
  "Think about the next generation.",
];

/* ── Internal agent record ─────────────────────────────────── */

interface AgentRecord {
  sprite: AgentSprite;
  routine?: Routine;
  topConcerns: string[];
  lastRoutineTime?: string;
  /** Per-agent idle-thought bank (from agent.idle_thoughts). */
  idleThoughts?: string[];
}

/* ── TownScene ──────────────────────────────────────────────── */

export class TownScene extends Phaser.Scene {
  private scenarioId = "";
  private townId: TownId = "";
  private mapPath: string | null = null;
  private agentSprites: Map<string, AgentSprite> = new Map();
  private agentRecords: Map<string, AgentRecord> = new Map();
  private agentOpinions: Map<string, string> = new Map();
  private playerSprite: PlayerSprite | null = null;
  private landmarks: LandmarkData[] = [];
  private landmarkPositions: Map<string, { x: number; y: number }> = new Map();
  private characterKeys: Set<string> = new Set();
  private wanderPoints: Array<{ x: number; y: number }> = [];
  private collisionGroup?: Phaser.Physics.Arcade.StaticGroup;
  /** Blocked rectangles from the tilemap's "collision" object layer (px). */
  private collisionRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Live-detail anchors from the tilemap's "anchors" object layer. */
  private mapAnchors: MapAnchor[] = [];
  /** Landmark-name → grid-snapped label position from the map's label anchors. */
  private mapLabels: Map<string, { x: number; y: number }> = new Map();
  /** In-canvas landmark name chips (tilemap towns; fallback towns draw their own). */
  private landmarkLabelTexts: Phaser.GameObjects.Text[] = [];
  private townDataResolved = false;
  private playerSpawnPending: UserProfile | null = null;

  // World clock + sky overlay
  private worldClock = new WorldClock({ startHour: 8, minutesPerSecond: 1 });
  private skyOverlay?: Phaser.GameObjects.Rectangle;
  private currentWeather: WeatherKind = "clear";

  // Night-time lamp glow + sky tint are owned by SceneAmbience + the sky overlay.
  private ambience?: AmbienceHandle;

  // Encounter scheduling
  private encounterTimer?: Phaser.Time.TimerEvent;

  // Night window glow quads (pane + halo per lit window stamp).
  private windowGlows: Array<{ obj: Phaser.GameObjects.GameObject & { setAlpha(a: number): unknown }; max: number }> = [];

  // Conversation spotlight state
  private convoVignette?: Phaser.GameObjects.Image;
  private convoZoomBase?: number;
  private convoFailsafe?: Phaser.Time.TimerEvent;
  /** True while the spotlight camera has borrowed framing from the
   *  player-follow camera (restored on spotlight clear or player movement). */
  private convoFollowPaused = false;

  // Fixed-seed capture mode (?capture=1) — see the doc block at the top.
  private captureMode = false;
  private randomBeforeCapture?: typeof Math.random;
  private reducedMotionRequested = false;

  // The built tilemap (kept for the window-glow scan).
  private builtMap?: Phaser.Tilemaps.Tilemap;
  // Scenario towns do not have to ship a Tiled map. This procedural layer is
  // rebuilt from their authoritative landmark rectangles when no map exists.
  private fallbackWorld?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "TownScene" });
  }

  init(data: { scenarioId: string; townId: TownId; mapPath?: string; reducedMotion?: boolean }) {
    this.scenarioId = data.scenarioId;
    this.townId = data.townId;
    this.mapPath = data.mapPath ?? null;
    this.reducedMotionRequested = Boolean(data.reducedMotion);
    // Inline fallback until the scenario town payload resolves.
    this.landmarks = landmarksFor(this.townId).slice();

    // Capture mode: seeded RNG + fixed golden-hour clock for stable choices
    // and composition. Browser/animation timing can still shift pixels.
    // Overriding Math.random is deliberate and confined to capture sessions.
    try {
      this.captureMode = new URLSearchParams(window.location.search).get("capture") === "1";
    } catch {
      this.captureMode = false;
    }
    if (this.captureMode) {
      this.randomBeforeCapture ??= Math.random;
      // Stable per-town seed: reloads match exactly, while the four capture
      // stills do not repeat the same passers-by and wander coordinates.
      let seed = 0x70a11ce;
      for (const ch of this.townId) {
        seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193) >>> 0;
      }
      Math.random = mulberry32(seed);
      this.worldClock = new WorldClock({ startHour: 16, startMinute: 30, minutesPerSecond: 1 });
    } else if (this.randomBeforeCapture) {
      Math.random = this.randomBeforeCapture;
      this.randomBeforeCapture = undefined;
    }
  }

  /* ── Preload ─────────────────────────────────────────────── */

  preload() {
    // Tileset images — shared by every generated town map. The rpg tileset
    // also feeds SceneAmbience's stamp textures (trees, lampposts, flowers).
    this.load.image("rpg-tileset", appUrl("assets/tilesets/rpg-tileset.png"));
    this.load.image("township-modern", appUrl("assets/tilesets/township-modern.png"));
    this.load.image("speech-bubble", appUrl("assets/speech_bubble/v2.png"));

    // Authored maps are an explicit scenario adapter. Town ids are only
    // unique inside a scenario package; an unrelated package reusing an id
    // must receive the procedural renderer instead of somebody else's town.
    if (hasAuthoredTownMap(this.mapPath)) {
      this.load.tilemapTiledJSON(townMapKey(this.townId), appUrl(this.mapPath!));
    }

    // Animated water-foam frames (bottom half of gentlewaterfall32.png is foam) — used as
    // lake surface shimmer. We treat the whole sheet as 32×32 cells; foam frames live in
    // the bottom rows.
    this.load.spritesheet("water-foam", appUrl("assets/spritesheets/gentlewaterfall32.png"), {
      frameWidth: 32, frameHeight: 32,
    });
    // Animated windmill (8 frames in a 3×3 grid, each 208×208).
    this.load.spritesheet("windmill", appUrl("assets/spritesheets/windmill.png"), {
      frameWidth: 208, frameHeight: 208,
    });

    // Character spritesheets — 32×32 frames
    for (const fullKey of ALL_CHARACTER_KEYS) {
      // ALL_CHARACTER_KEYS already prefixes "char-" — use rest as filename.
      const fileName = fullKey.startsWith("char-") ? fullKey.slice(5) : fullKey;
      this.load.spritesheet(fullKey, appUrl(`assets/characters/${fileName}.png`), {
        frameWidth: 32,
        frameHeight: 32,
      });
      this.characterKeys.add(fileName);
    }

    // Baked palette-swap outfit sheets (scripts/mapgen/outfits.py).
    for (const [key, path] of Object.entries(ALL_CUSTOM_SHEETS)) {
      this.load.spritesheet(key, appUrl(`assets/characters/${path}`), {
        frameWidth: 32,
        frameHeight: 32,
      });
    }

    // Pixel accessory overlays (scripts/mapgen/accessories.py).
    for (const [key, path] of Object.entries(ALL_ACCESSORY_SHEETS)) {
      this.load.spritesheet(key, appUrl(`assets/characters/${path}`), {
        frameWidth: 32,
        frameHeight: 32,
      });
    }

    // Folk spritesheet as additional fallback
    this.load.spritesheet("folk", appUrl("assets/characters/32x32folk.png"), { frameWidth: 32, frameHeight: 32 });

    // Player sprite variants — try 32×32 player-N first, fall back to legacy 16-px.
    for (let i = 1; i <= 6; i++) {
      const key = `char-player-${i}`;
      this.load.spritesheet(key, appUrl(`assets/characters/player-${i}.png`), { frameWidth: 32, frameHeight: 32 });
      this.load.once(`fileerror-spritesheet-${key}`, () => {/* silently skip */});
    }
    this.load.spritesheet("char-player", appUrl("assets/characters/player.png"), {
      frameWidth: 16, frameHeight: 16,
    });
  }

  /* ── Create ──────────────────────────────────────────────── */

  create() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    // Console/debug hook — e.g. `__townshipScene.setWorldTime(21, 0)` to
    // preview the night pass without waiting on the world clock.
    (window as unknown as { __townshipScene?: TownScene }).__townshipScene = this;

    // Scriptable capture API (see doc block at the top of this file).
    this.installCaptureApi();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.removeCaptureApi());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.removeCaptureApi());

    // Tilemap — the generated pixel world (layers, collision, anchors).
    this.buildTilemap(W, H);

    // Night window glow — warm additive quads over every window stamp
    // found in buildings-base; alpha driven from the world clock so they
    // ignite through dusk (the money shot).
    this.buildWindowGlows();

    // Sky overlay — ABOVE buildings-top (5000) so the night tint covers
    // rooftops too; lamp glows sit above it at 6001 and pierce the dark.
    this.skyOverlay = this.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0).setDepth(6000);
    this.refreshSkyOverlay();

    // Fit the camera to the map and keep it fitted on container resize.
    this.fitCamera();
    this.scale.on("resize", () => this.fitCamera());

    // Try to fetch authoritative town data; build landmarks immediately with
    // current (fallback) data and re-render if the API supplies different
    // landmark positions.
    this.layoutLandmarksAndDecor();

    fetchTownData(this.townId).then((d) => {
      if (d) this.setTownData(d);
    });

    // Character walk / idle animations
    this.createCharacterAnimations();
    this.createPlayerAnimations();

    // Ambient background passers-by
    this.spawnAmbientNPCs();

    // Ambient birds flying across sky
    this.scheduleBirds(W, H);

    // Town title banner
    this.buildTitleBanner(W);

    // Per-town flavor effects (papel-picado, ducks, dogs, etc.)
    this.addTownFlavor(this.townId);

    // ── Living details driven by the map's anchor layer (trees, lamps,
    // flowers, smoke, water shimmer, windmill, petal drift).
    // setHour() is called from the world-clock listener below.
    if (!this.anims.exists("windmill-spin") && this.textures.exists("windmill")) {
      this.anims.create({
        key: "windmill-spin",
        frames: this.anims.generateFrameNumbers("windmill", { start: 0, end: 7 }),
        frameRate: 7,
        repeat: -1,
      });
    }
    this.ambience = composeTownAmbience(
      this,
      this.scenarioId,
      this.townId,
      this.mapAnchors,
      W,
      H,
    );
    this.ambience.setHour(this.worldClock.hour);

    // Register + launch the Weather scene in parallel
    if (!this.scene.get("WeatherScene")) {
      this.scene.add("WeatherScene", WeatherScene, false);
    }
    this.scene.launch("WeatherScene", { townId: this.townId });

    // A live town gets local ambient encounters. A recorded replay is driven
    // exclusively by its event feed, otherwise autonomous dialogue can leak
    // across a backward seek and make the selected playhead nondeterministic.
    if (!DEMO_MODE) {
      this.encounterTimer = this.time.addEvent({
        delay: 16000,
        loop: true,
        callback: () => this.tryEncounterConversation(),
      });
    }

    // If a player spawn was queued before scene activation, run it now.
    if (this.playerSpawnPending) {
      const p = this.playerSpawnPending;
      this.playerSpawnPending = null;
      this.addPlayer(p);
    }

    // Tap-to-walk on mobile (FIX 15): pointer-down on the scene tweens the
    // player toward the tap point. Capped at 400 px.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, targets: any[]) => {
      // Skip if pointer was over an interactive target (agent click etc.)
      if (targets && targets.length > 0) return;
      const player = this.playerSprite;
      if (!player || !player.inputEnabled) return;
      // Skip while the touch joystick is active (PlayerSprite owns that).
      if ((player as any).joystick?.active) return;

      // Translate screen coords to world coords through the camera.
      const cam = this.cameras.main;
      const wx = p.worldX ?? cam.scrollX + p.x / cam.zoom;
      const wy = p.worldY ?? cam.scrollY + p.y / cam.zoom;
      const dx = wx - player.x;
      const dy = wy - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 20) return;
      const capped = Math.min(dist, 400);
      const tx = player.x + (dx / dist) * capped;
      const ty = player.y + (dy / dist) * capped;
      player.moveToPosition(tx, ty);
    });
  }

  /* ── Update (called every frame) ────────────────────────── */

  update(_time: number, delta: number) {
    // Tick world clock and update sky tint when minute changes
    const prevMin = this.worldClock.minute;
    const prevHour = this.worldClock.hour;
    // Replay time is authoritative event state. Live towns retain the ambient
    // ticking clock between backend updates.
    if (!DEMO_MODE) this.worldClock.tick(delta);
    if (this.worldClock.minute !== prevMin || this.worldClock.hour !== prevHour) {
      this.refreshSkyOverlay();
      this.tickRoutines();
      // SceneAmbience owns lamp glow + night tint; refresh at top of each hour.
      if (this.worldClock.hour !== prevHour) {
        this.ambience?.setHour(this.worldClock.hour);
      }
    }

    // Y-based depth sort – characters "behind" others appear further back.
    // A resident can walk out of the followed camera after speaking; retire
    // that transient callout before it becomes a clipped, detached panel.
    const view = this.cameras.main.worldView;
    this.agentSprites.forEach((s) => {
      s.syncDepth();
      if (
        s.getSpeechBubbleCount() > 0
        && (
          s.x < view.left + 22
          || s.x > view.right - 22
          || s.y < view.top + 16
          || s.y > view.bottom - 8
        )
      ) s.clearSpeechBubbles();
    });
    this.playerSprite?.updatePlayer(delta);

    // The player always wins the camera: if they start walking while the
    // conversation spotlight has it, hand framing straight back.
    if (this.convoFollowPaused && this.playerSprite?.isWalking()) {
      const cam = this.cameras.main;
      this.convoFollowPaused = false;
      cam.zoomTo(this.convoZoomBase ?? this.playerFollowZoom(), 320, "Sine.easeOut");
      this.convoZoomBase = undefined;
      cam.startFollow(this.playerSprite, true, 0.08, 0.08);
    }

    // Player ↔ landmark collision
    if (this.playerSprite && this.collisionGroup) {
      this.physics.collide(this.playerSprite, this.collisionGroup);
    }

    // Crowd hygiene, throttled to ~5 Hz: gently separate any bodies that
    // still ended up overlapping, then declutter name labels (pair lanes,
    // crowd badges, landmark-label occupancy).
    this.crowdTickAccum += delta;
    if (this.crowdTickAccum >= 200) {
      this.crowdTickAccum = 0;
      this.resolveBodyOverlaps();
      this.declutterLabels();
    }
  }

  /* ── Crowd hygiene: separation + label declutter ────────── */

  private crowdTickAccum = 0;
  private clusterBadges: Phaser.GameObjects.Text[] = [];

  /**
   * Gently push apart bodies that overlap on the ground plane. Walk targets
   * are already occupancy-resolved; this catches the residual cases (two
   * tweens crossing, replay snapshots, physics shoves) with a few px of
   * drift per tick instead of a visible teleport.
   */
  private resolveBodyOverlaps() {
    const MIN_DIST = 30;
    const bodies = this.allBodies().filter((b) => b.active);
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a === this.playerSprite || a.isWalking()) continue;
      for (let j = 0; j < bodies.length; j++) {
        if (i === j) continue;
        const b = bodies[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN_DIST) continue;
        // Deterministic tie-break for perfectly stacked sprites.
        const nx = d > 0.01 ? dx / d : Math.cos(i * 2.39996);
        const ny = d > 0.01 ? dy / d : Math.sin(i * 2.39996);
        const push = Math.min(3, (MIN_DIST - d) * 0.5 + 0.5);
        const tx = Phaser.Math.Clamp(a.x + nx * push, 40, 1160);
        const ty = Phaser.Math.Clamp(a.y + ny * push, 40, 760);
        // Accept the nudge unless it would push a free-standing body INTO
        // scenery; a body already inside a collision rect may always move
        // (that is its escape hatch).
        if (!this.isBlocked(tx, ty, 2) || this.isBlocked(a.x, a.y, 2)) a.nudgeTo(tx, ty);
      }
    }
  }

  /**
   * Keep name labels legible when residents gather — exactly the moment the
   * simulation is most interesting. Pairs get stacked lanes; crowds of 3+
   * collapse into a single "N residents" badge; landmark labels yield to
   * anyone standing on them.
   */
  private declutterLabels() {
    const residents = [...this.agentSprites.values()]
      .filter((s) => s !== this.playerSprite && s.active);

    // Greedy proximity clustering (n is small — a town has < 12 residents).
    const assigned = new Array(residents.length).fill(false);
    const clusters: number[][] = [];
    for (let i = 0; i < residents.length; i++) {
      if (assigned[i]) continue;
      const group = [i];
      assigned[i] = true;
      for (let j = i + 1; j < residents.length; j++) {
        if (assigned[j]) continue;
        const dx = Math.abs(residents[i].x - residents[j].x);
        const dy = Math.abs(residents[i].y - residents[j].y);
        if (dx < 52 && dy < 34) {
          group.push(j);
          assigned[j] = true;
        }
      }
      clusters.push(group);
    }

    let badgeIdx = 0;
    for (const group of clusters) {
      if (group.length === 1) {
        residents[group[0]].setLabelVisible(true);
        residents[group[0]].setLabelSlot(0);
      } else if (group.length === 2) {
        // Two lanes: the more southern sprite keeps the base lane (it draws
        // in front); the other's label drops to a second lane.
        const [p, q] = group;
        const south = residents[p].y >= residents[q].y ? p : q;
        const north = south === p ? q : p;
        residents[south].setLabelVisible(true);
        residents[south].setLabelSlot(0);
        residents[north].setLabelVisible(true);
        residents[north].setLabelSlot(11);
      } else {
        // Crowd: one badge instead of an unreadable stack of names.
        let cx = 0;
        let maxY = -Infinity;
        for (const idx of group) {
          residents[idx].setLabelVisible(false);
          cx += residents[idx].x;
          maxY = Math.max(maxY, residents[idx].y);
        }
        cx /= group.length;
        const badge = this.obtainClusterBadge(badgeIdx++);
        badge.setText(`${group.length} residents`);
        badge.setPosition(Math.round(cx), Math.round(maxY + 12));
        badge.setDepth(100 + Math.floor(maxY) + 1);
        badge.setVisible(true);
      }
    }
    for (let k = badgeIdx; k < this.clusterBadges.length; k++) {
      this.clusterBadges[k].setVisible(false);
    }

    // Landmark labels yield to residents standing inside their bounds.
    for (const label of this.landmarkLabelTexts) {
      const lm = label.getData("lm") as LandmarkData | undefined;
      if (!lm) continue;
      let occupied = false;
      for (const s of this.agentSprites.values()) {
        if (s.x >= lm.x && s.x <= lm.x + lm.width && s.y >= lm.y && s.y <= lm.y + lm.height) {
          occupied = true;
          break;
        }
      }
      label.setVisible(!occupied);
    }
  }

  private obtainClusterBadge(idx: number): Phaser.GameObjects.Text {
    while (this.clusterBadges.length <= idx) {
      const badge = this.add.text(0, 0, "", {
        fontFamily: "Inter, 'Helvetica Neue', sans-serif",
        fontSize: "9px",
        fontStyle: "bold",
        color: "#fff7e0",
        backgroundColor: "rgba(20,17,12,0.78)",
        padding: { x: 5, y: 2 },
        resolution: 3,
      }).setOrigin(0.5, 0).setVisible(false);
      this.clusterBadges.push(badge);
    }
    return this.clusterBadges[idx];
  }

  /* ── Agent Management (called from React / TownView) ──── */

  /** Push authoritative scenario town data into an already-running scene.
   *  Static demo builds use this because `/api/towns/:id` is unavailable;
   *  live builds call the same path after their API fetch resolves. */
  setTownData(data: TownData) {
    if (!data?.landmarks?.length) return;
    this.landmarks = data.landmarks.slice();
    this.townDataResolved = true;
    if (this.scene?.isActive?.()) this.rebuildLandmarks();
  }

  addAgent(agent: AgentState & { routine?: RoutineEntry[] }) {
    if (this.agentSprites.has(agent.id)) return;

    const base = this.landmarkPositions.get(agent.location) ??
      this.wanderPoints[0] ?? { x: 400, y: 400 };

    const spawn = this.findFreeNear(
      base.x + Phaser.Math.Between(-55, 55),
      base.y + Phaser.Math.Between(-35, 35),
      { clearOf: 36 },
    );
    const sx = spawn.x;
    const sy = spawn.y;

    const custom = resolveAgentSprite(agent.id, this.scenarioId);

    const sprite = new AgentSprite(this, sx, sy, {
      id: agent.id,
      name: agent.name,
      initials: agent.initials ?? this.initials(agent.name),
      color: agent.color ?? townAccent(this.townId),
      town: agent.town,
      opinionColor: this.opinionColor(agent.opinion?.candidate),
      spriteKey: custom.spriteKey,
      customKey: custom.customKey,
      accessoryKey: custom.accessoryKey,
      tint: custom.tint,
      // Couples render as a REAL second body (own spritesheet) that trails
      // the lead with a delayed follow — see AgentSprite.updateCompanion.
      partner: custom.partner,
    });

    this.agentSprites.set(agent.id, sprite);
    this.agentOpinions.set(agent.id, agent.opinion?.candidate ?? "");

    const record: AgentRecord = {
      sprite,
      routine: agent.routine ? new Routine(agent.routine) : undefined,
      topConcerns: agent.top_concerns ?? [],
      idleThoughts: agent.idle_thoughts ?? undefined,
    };
    this.agentRecords.set(agent.id, record);

    // If a routine is supplied, the clock tick drives motion. Otherwise we
    // fall back to randomized wandering.
    if (!record.routine && !DEMO_MODE) {
      const initDelay = Phaser.Math.Between(1500, 6000);
      this.time.delayedCall(initDelay, () => this.scheduleWander(agent.id));
    }
  }

  /** Reconcile the visible town to a reducer snapshot after a replay seek or
   *  a live-history gap. This updates durable state without replaying old
   *  speech, confetti, audio, or movement tweens. */
  syncReplayState(
    agents: AgentState[],
    positions: Record<string, { location: string; x?: number; y?: number }>,
    clock: { hour: number; minute: number },
    weather: WeatherKind,
  ) {
    const wanted = new Set(agents.map((agent) => agent.id));
    for (const [id, sprite] of this.agentSprites) {
      if (sprite === this.playerSprite || wanted.has(id)) continue;
      sprite.destroy();
      this.agentSprites.delete(id);
      this.agentRecords.delete(id);
      this.agentOpinions.delete(id);
    }

    this.clearConversationSpotlight(true);
    for (const agent of agents) {
      this.addAgent(agent);
      const sprite = this.agentSprites.get(agent.id);
      if (!sprite) continue;

      const recorded = positions[agent.id];
      const precise = Number.isFinite(recorded?.x) && Number.isFinite(recorded?.y);
      const landmark = this.landmarkPositions.get(recorded?.location ?? agent.location)
        ?? this.wanderPoints[0]
        ?? { x: 400, y: 400 };

      // When an older event has no pixel coordinates, give each resident a
      // stable offset around the landmark so repeated seeks never reshuffle or
      // stack the whole roster. FNV-1a keeps this scenario-agnostic.
      let hash = 2166136261;
      for (let i = 0; i < agent.id.length; i++) {
        hash ^= agent.id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const dx = ((hash & 0xff) / 255 - 0.5) * 54;
      const dy = (((hash >>> 8) & 0xff) / 255 - 0.5) * 36;
      // Even authoritative recorded coordinates get occupancy-resolved: old
      // event logs routinely stacked a whole meeting on one tile, which is
      // the single worst craft signal a replay can show.
      const slot = this.findFreeNear(
        precise ? recorded.x! : landmark.x + dx,
        precise ? recorded.y! : landmark.y + dy,
        { clearOf: 34, exclude: sprite },
      );
      const x = slot.x;
      const y = slot.y;
      const activity = agent.activity && agent.activity !== "walking"
        ? agent.activity
        : "idle";

      sprite.syncReplayState(x, y, this.opinionColor(agent.opinion?.candidate), activity);
      this.agentOpinions.set(agent.id, agent.opinion?.candidate ?? "");
    }

    this.setWorldTime(clock.hour, clock.minute, false);
    this.setWeather(weather);
  }

  moveAgent(agentId: string, toLocation: string, x?: number, y?: number) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    // Prefer precise pixel coords when both are finite; else resolve by landmark.
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const t = this.findFreeNear(x as number, y as number, { clearOf: 34, exclude: sprite });
      sprite.moveToPosition(t.x, t.y);
      return;
    }
    const base = this.landmarkPositions.get(toLocation) ?? this.wanderPoints[0] ?? { x: 400, y: 400 };
    const t = this.findFreeNear(
      base.x + Phaser.Math.Between(-50, 50),
      base.y + Phaser.Math.Between(-35, 35),
      { clearOf: 34, exclude: sprite },
    );
    sprite.moveToPosition(t.x, t.y);
  }

  showAgentSpeech(agentId: string, text: string, duration?: number) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    // Off-camera dialogue remains available in Recent Activity. Avoid drawing
    // a detached or clipped parchment callout when its resident is outside the
    // safe camera area (the bubble tail deliberately stays anchored to them).
    const view = this.cameras.main.worldView;
    if (
      sprite.x < view.left + 22
      || sprite.x > view.right - 22
      || sprite.y < view.top + 16
      || sprite.y > view.bottom - 8
    ) return;
    // The activity rail retains every line. Cap simultaneous canvas callouts
    // so fast replay remains legible instead of turning into a wall of paper.
    // A resident's new line replaces their stale line. Keeping both makes a
    // paced replay look like a stack of simultaneous dialogue even though the
    // lines arrived sequentially.
    if (sprite.getSpeechBubbleCount() > 0) sprite.clearSpeechBubbles();
    const visible = [...this.agentSprites.values()]
      .reduce((total, agent) => total + agent.getSpeechBubbleCount(), 0);
    if (visible >= 2) return;
    // Lines spoken inside an active conversation get the spotlight variant —
    // larger type on a wider measure so the dialogue reads as the scene's
    // focal point rather than a stray tooltip.
    const emphasis = sprite.getActivity() === "talking";
    sprite.showSpeechBubble(text, duration, "neutral", emphasis);
  }

  updateAgentOpinion(agentId: string, candidate: string) {
    // Opinion events can represent confidence/reasoning shifts without a
    // stance-color change; they still deserve the ballot/confetti beat.
    this.agentOpinions.set(agentId, candidate);
    this.agentSprites.get(agentId)?.setOpinionColor(this.opinionColor(candidate), true);
  }

  showAgentEmote(agentId: string, type: "reflecting" | "opinion_changed") {
    this.agentSprites.get(agentId)?.showEmote(type);
  }

  playGesture(agentId: string, gesture: GestureKind) {
    this.agentSprites.get(agentId)?.playGesture(gesture);
  }

  /** Backend conversation_started → pair sprites face each other + go
   *  "talking", plus the conversation spotlight (vignette dim + gentle
   *  camera ease + a spark between the talkers). */
  handleConversationStarted(conversation: { participants: string[] }) {
    if (!conversation || !Array.isArray(conversation.participants)) return;
    const sprites = conversation.participants
      .map((id) => this.agentSprites.get(id))
      .filter((s): s is AgentSprite => !!s);
    if (sprites.length < 2) return;
    for (let i = 0; i < sprites.length; i++) {
      const me = sprites[i];
      const other = sprites[(i + 1) % sprites.length];
      me.faceToward(other.x, other.y);
      me.setActivity("talking");
    }
    this.playConversationSpotlight(sprites[0], sprites[1]);
  }

  /** Backend conversation_ended → walk talkers back to idle. */
  handleConversationEnded(_conversationId: string) {
    this.agentSprites.forEach((s) => {
      if (s.getActivity() === "talking") s.setActivity("idle");
    });
    this.clearConversationSpotlight();
  }

  /** Dim the scene ~8% behind a soft vignette, ease the camera toward the
   *  pair, and pop a small square-spark between the talkers. */
  private playConversationSpotlight(a: AgentSprite, b: AgentSprite) {
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2 - 30;

    // Reduced-motion mode keeps the semantic talking state + bubbles, but
    // omits the decorative spark, vignette and camera movement entirely.
    if (reducedMotion()) {
      this.clearConversationSpotlight();
      return;
    }

    // A tiny square spark makes the conversational focal point legible.
    const squareKey = ensureSquareTexture(this);
    for (let i = 0; i < 4; i++) {
      const spark = this.add.image(midX, midY, squareKey)
        .setTint(0xffe6a8)
        .setDepth(520)
        .setAlpha(0);
      const dx = (i % 2 === 0 ? -1 : 1) * (3 + i * 2);
      this.tweens.add({
        targets: spark,
        alpha: { from: 0.95, to: 0 },
        x: midX + dx,
        y: midY - 8 - i * 3,
        duration: 480 + i * 90,
        delay: i * 60,
        ease: "Stepped",
        easeParams: [4],
        onComplete: () => spark.destroy(),
      });
    }

    // Vignette dim (~8% overall, heavier toward the edges).
    if (!this.convoVignette) {
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      this.convoVignette = this.add.image(W / 2, H / 2, ensureVignetteTexture(this))
        .setDisplaySize(W * 1.15, H * 1.15)
        .setDepth(6002)
        .setAlpha(0);
    }
    this.tweens.add({ targets: this.convoVignette, alpha: 0.5, duration: 420, ease: "Sine.easeOut" });
    // Failsafe: never leave the town dimmed if conversation_ended is lost.
    this.convoFailsafe?.remove(false);
    this.convoFailsafe = this.time.delayedCall(12000, () => {
      if (this.convoVignette) this.clearConversationSpotlight();
    });

    // Gentle camera ease to the pair. With no player the scene camera simply
    // pans. With a player present we briefly borrow the follow-camera —
    // unless the player is a participant, is actively walking (never hijack
    // movement), or has a chat panel open.
    const cam = this.cameras.main;
    if (!this.playerSprite) {
      if (this.convoZoomBase === undefined) this.convoZoomBase = cam.zoom;
      cam.pan(midX, midY, 520, "Sine.easeInOut");
      cam.zoomTo(this.convoZoomBase * 1.09, 520, "Sine.easeInOut");
    } else {
      const p = this.playerSprite;
      const participant = a === p || b === p;
      const chatOpen = !p.inputEnabled && !this.captureMode;
      if (!participant && !chatOpen && !p.isWalking()) {
        cam.stopFollow();
        this.convoFollowPaused = true;
        if (this.convoZoomBase === undefined) this.convoZoomBase = cam.zoom;
        cam.pan(midX, midY, 620, "Sine.easeInOut");
        cam.zoomTo(this.convoZoomBase * 1.12, 620, "Sine.easeInOut");
      }
    }
  }

  private clearConversationSpotlight(immediate = false) {
    this.convoFailsafe?.remove(false);
    this.convoFailsafe = undefined;
    if (this.convoVignette) {
      const v = this.convoVignette;
      this.convoVignette = undefined;
      if (immediate || reducedMotion()) {
        v.destroy();
      } else {
        this.tweens.add({
          targets: v,
          alpha: 0,
          duration: 380,
          ease: "Sine.easeIn",
          onComplete: () => v.destroy(),
        });
      }
    }
    if (this.convoFollowPaused && this.playerSprite) {
      // Hand framing back to the player-follow camera.
      this.convoFollowPaused = false;
      const cam = this.cameras.main;
      const p = this.playerSprite;
      const zoom = this.convoZoomBase ?? this.playerFollowZoom();
      this.convoZoomBase = undefined;
      if (immediate || reducedMotion()) {
        cam.setZoom(zoom);
        cam.startFollow(p, true, 0.08, 0.08);
      } else {
        cam.zoomTo(zoom, 480, "Sine.easeInOut");
        cam.pan(p.x, p.y, 480, "Sine.easeInOut");
        this.time.delayedCall(500, () => {
          if (this.playerSprite && !this.convoFollowPaused) {
            cam.startFollow(this.playerSprite, true, 0.08, 0.08);
          }
        });
      }
    } else if (!this.playerSprite && this.convoZoomBase !== undefined) {
      const cam = this.cameras.main;
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      if (immediate || reducedMotion()) {
        cam.setZoom(this.convoZoomBase);
        cam.centerOn(W / 2, H / 2);
      } else {
        cam.zoomTo(this.convoZoomBase, 520, "Sine.easeInOut");
        cam.pan(W / 2, H / 2, 520, "Sine.easeInOut");
      }
      this.convoZoomBase = undefined;
    }
  }

  /** Cross-town gossip pulse — flash a "!" emote on the from-agent if present. */
  handleCrossTownGossip(evt: { from_agent: string; to_agent: string; message: string }) {
    const sprite = this.agentSprites.get(evt.from_agent);
    if (!sprite) return;
    sprite.showEmote("reflecting");
    // Show the message briefly as a speech bubble
    sprite.showSpeechBubble(evt.message, 2400);
  }

  setAgentActivity(agentId: string, activity: AgentActivity) {
    this.agentSprites.get(agentId)?.setActivity(activity);
  }

  /** Force the clock; called from WS world_clock_tick. */
  setWorldTime(h: number, m = 0, applyRoutines = true) {
    this.worldClock.setTime(h, m);
    this.refreshSkyOverlay();
    if (applyRoutines && !DEMO_MODE) this.tickRoutines();
    this.ambience?.setHour(this.worldClock.hour);
  }

  /** Forward weather to the WeatherScene. */
  setWeather(w: WeatherKind) {
    this.currentWeather = w;
    const ws = this.scene.get("WeatherScene") as any;
    if (ws && typeof ws.setWeather === "function") ws.setWeather(w);
  }

  /** Small, read-only diagnostic surface for capture tooling and regression
   *  tests. It contains rendered state only; no scenario identities. */
  getReplaySnapshot() {
    return {
      clock: { hour: this.worldClock.hour, minute: this.worldClock.minute },
      weather: this.currentWeather,
      agents: Object.fromEntries(
        [...this.agentSprites.entries()]
          .filter(([, sprite]) => sprite !== this.playerSprite)
          .map(([id, sprite]) => [id, {
            x: Math.round(sprite.x),
            y: Math.round(sprite.y),
            activity: sprite.getActivity(),
            opinionColor: sprite.getOpinionColor(),
            opinion: this.agentOpinions.get(id) ?? "",
            speechBubbles: sprite.getSpeechBubbleCount(),
          }]),
      ),
      conversationSpotlight: Boolean(this.convoVignette),
    };
  }

  /** Install `window.__town` — the scriptable control surface used by the
   *  capture pipeline (scripts/capture). See the doc block at the top. */
  private installCaptureApi() {
    const api = {
      setWorldTime: (h: number, m = 0) => this.setWorldTime(h, m),
      setWeather: (kind: WeatherKind) => this.setWeather(kind),
      panTo: (x: number, y: number) => {
        const cam = this.cameras.main;
        if (!cam) return;
        if (reducedMotion()) cam.centerOn(x, y);
        else cam.pan(x, y, 600, "Sine.easeInOut");
      },
      triggerConversation: (agentA: string, agentB: string) => {
        this.handleConversationStarted({ participants: [agentA, agentB] });
        this.time.delayedCall(5200, () => this.handleConversationEnded("capture"));
      },
      triggerOpinionShift: (agentId: string, optionId: string) => {
        this.updateAgentOpinion(agentId, optionId);
        this.playOpinionShiftBeat(agentId);
      },
      triggerNews: (headline?: string) => this.playNewsBeat(headline),
      snapshot: () => this.getReplaySnapshot(),
      mapMode: () => this.builtMap ? "tilemap" as const : "procedural" as const,
      /** List agent ids present in this town (capture scripts pick pairs). */
      agents: () => [...this.agentSprites.entries()]
        .filter(([, sprite]) => sprite !== this.playerSprite)
        .map(([id]) => id),
    };
    (window as unknown as { __town?: typeof api }).__town = api;
  }

  /** Restore globals and remove stale window handles when the Phaser game is
   *  destroyed or a town scene is restarted. */
  private removeCaptureApi() {
    if (this.randomBeforeCapture) {
      Math.random = this.randomBeforeCapture;
      this.randomBeforeCapture = undefined;
    }
    const hooks = window as unknown as {
      __town?: unknown;
      __townshipScene?: TownScene;
    };
    if (hooks.__townshipScene === this) {
      delete hooks.__town;
      delete hooks.__townshipScene;
    }
  }

  /** News beat: a pixel newspaper drops at the plaza, nearby agents briefly
   *  converge with "!" emotes, plus the short camera emphasis. */
  playNewsBeat(_headline?: string) {
    const cam = this.cameras.main;
    if (!cam) return;
    const baseCenter = { x: cam.midPoint.x, y: cam.midPoint.y };

    // Where the paper lands: prefer a plaza-ish label anchor, then any
    // label anchor, then the town centre.
    let spot = { x: 600, y: 400 };
    let best: { x: number; y: number } | undefined;
    for (const [name, pos] of this.mapLabels) {
      if (/plaza|green|square|commons|park|hall/i.test(name)) { best = pos; break; }
      best = best ?? pos;
    }
    if (best) spot = { x: best.x, y: best.y + 24 };
    const land = this.findFreeNear(spot.x, spot.y);

    const motionOk = !reducedMotion();

    // The paper: falls from the sky with a stepped drop + landing squash.
    const paper = this.add.image(land.x, motionOk ? land.y - 130 : land.y, ensureNewspaperTexture(this))
      .setScale(2)
      .setDepth(100 + land.y)
      .setAlpha(motionOk ? 0.0 : 1);
    const settle = () => {
      // Landing squash + a puff of two dust squares.
      if (motionOk) {
        this.tweens.add({
          targets: paper, scaleX: 2.5, scaleY: 1.5, duration: 90, yoyo: true, ease: "Quad.easeOut",
        });
        const squareKey = ensureSquareTexture(this);
        for (const dx of [-8, 8]) {
          const dust = this.add.image(land.x + dx, land.y + 2, squareKey)
            .setTint(0xcfc7b0).setAlpha(0.8).setDepth(100 + land.y);
          this.tweens.add({
            targets: dust, x: land.x + dx * 2, alpha: 0, duration: 300,
            ease: "Quad.easeOut", onComplete: () => dust.destroy(),
          });
        }
      }
      // Nearby agents react; only motion-enabled scenes converge physically.
      let converged = 0;
      this.agentSprites.forEach((s) => {
        if (s === this.playerSprite || converged >= 4) return;
        const d = Phaser.Math.Distance.Between(s.x, s.y, land.x, land.y);
        if (d > 190 || d < 30) return;
        converged++;
        const t = this.findFreeNear(
          land.x + Phaser.Math.Between(-34, 34),
          land.y + Phaser.Math.Between(16, 40),
          { clearOf: 34, exclude: s },
        );
        s.showEmote("surprise");
        if (motionOk) {
          this.time.delayedCall(220 + converged * 160, () => s.moveToPosition(t.x, t.y));
        }
      });
    };
    if (motionOk) {
      this.tweens.add({
        targets: paper,
        y: land.y,
        alpha: 1,
        duration: 620,
        ease: "Stepped",
        easeParams: [7],
        onComplete: settle,
      });
    } else {
      settle();
    }
    // The paper lingers, then fades.
    this.time.delayedCall(7000, () => {
      if (motionOk) {
        this.tweens.add({ targets: paper, alpha: 0, duration: 700, onComplete: () => paper.destroy() });
      } else {
        paper.destroy();
      }
    });

    // Camera emphasis (existing beat).
    if (motionOk) {
      const baseZoom = cam.zoom;
      cam.pan(land.x, land.y, 350, "Sine.easeInOut");
      cam.zoomTo(baseZoom * 1.15, 300, "Sine.easeInOut");
      this.time.delayedCall(900, () => {
        if (this.playerSprite) {
          cam.pan(this.playerSprite.x, this.playerSprite.y, 400, "Sine.easeInOut");
        } else {
          cam.pan(baseCenter.x, baseCenter.y, 400, "Sine.easeInOut");
        }
        cam.zoomTo(baseZoom, 400, "Sine.easeInOut");
      });
    }
  }

  playOpinionShiftBeat(agentId: string) {
    const cam = this.cameras.main;
    const sprite = this.agentSprites.get(agentId);
    if (!cam || !sprite || reducedMotion()) return;
    const z = cam.zoom;
    const baseCenter = { x: cam.midPoint.x, y: cam.midPoint.y };
    cam.pan(sprite.x, sprite.y, 280, "Sine.easeInOut");
    cam.zoomTo(z * 1.2, 240, "Sine.easeInOut");
    this.time.delayedCall(600, () => {
      cam.zoomTo(z, 380, "Sine.easeInOut");
      if (this.playerSprite) cam.pan(this.playerSprite.x, this.playerSprite.y, 380, "Sine.easeInOut");
      else cam.pan(baseCenter.x, baseCenter.y, 380, "Sine.easeInOut");
    });
  }

  playSimEndBeat() {
    const cam = this.cameras.main;
    if (!cam || reducedMotion()) return;
    const z = cam.zoom;
    cam.zoomTo(z * 0.7, 800, "Sine.easeInOut");
    this.time.delayedCall(1000, () => cam.zoomTo(z, 700, "Sine.easeInOut"));
  }

  /**
   * Positions consumed by the DOM overlay. Name labels moved in-canvas
   * (they could detach from their sprites under the zoomed follow-camera and
   * collided when residents clustered), so agent entries are exported with
   * `visible: false`: the overlay still needs their world coordinates for
   * the proximity card, but must not draw duplicate DOM labels for them.
   */
  getOverlayData(): { id: string; name: string; x: number; y: number; visible: boolean; type: "agent" | "landmark" }[] {
    const data: { id: string; name: string; x: number; y: number; visible: boolean; type: "agent" | "landmark" }[] = [];
    this.agentSprites.forEach((sprite) => {
      const info = sprite.getOverlayInfo();
      data.push({ ...info, visible: false, type: "agent" });
    });
    return data;
  }

  /** Minimap data — small representation of the current town. */
  getMiniMapData(): {
    width: number; height: number;
    landmarks: { x: number; y: number; w: number; h: number; type: string; color?: string; name: string }[];
    agents: { id: string; x: number; y: number; color: string }[];
    player?: { x: number; y: number };
  } {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    return {
      width: W,
      height: H,
      landmarks: this.landmarks.map((lm) => ({
        x: lm.x, y: lm.y, w: lm.width, h: lm.height,
        type: lm.type, color: lm.color, name: lm.name,
      })),
      agents: [...this.agentSprites.entries()]
        .filter(([_, s]) => s !== this.playerSprite)
        .map(([id, s]) => ({ id, x: s.x, y: s.y, color: townAccent(this.townId) })),
      player: this.playerSprite ? { x: this.playerSprite.x, y: this.playerSprite.y } : undefined,
    };
  }

  clearAgents() {
    this.agentSprites.forEach((s) => s.destroy());
    this.agentSprites.clear();
    this.agentRecords.clear();
    this.agentOpinions.clear();
  }

  /* ── Player Management ──────────────────────────────────── */

  addPlayer(profile: UserProfile) {
    if (this.playerSprite) return; // already spawned
    if (!this.scene?.isActive?.()) {
      // Queue until create() runs.
      this.playerSpawnPending = profile;
      return;
    }

    // Spawn near the first landmark — but clear of the resident cluster that
    // congregates there, so the first thing a new player does is walk toward
    // the town rather than materialize inside a crowd.
    const firstLandmark = this.landmarks.find((l) => l.type !== "road") ?? this.landmarks[0];
    const base = firstLandmark
      ? { x: firstLandmark.x + firstLandmark.width / 2, y: firstLandmark.y + firstLandmark.height / 2 }
      : { x: 400, y: 400 };
    const spawn = this.findFreeNear(
      base.x + Phaser.Math.Between(-30, 30),
      base.y + Phaser.Math.Between(-20, 20),
      { clearOf: 80 },
    );
    const sx = spawn.x;
    const sy = spawn.y;

    // Honor profile.spriteKey if it points to a loaded texture — EXCEPT the
    // legacy 16-px "char-player" explorer, which belongs to a different art
    // family and rendered at half the height of the chibi residents. Old
    // profiles that stored it are remapped to a stable 32-px variant so the
    // player and residents share one sprite family at one scale.
    let spriteKey: string | undefined;
    const requested = profile.spriteKey;
    if (requested && requested !== "char-player" && this.textures.exists(requested)) {
      spriteKey = requested;
    } else {
      const variants = [1, 2, 3, 4, 5, 6]
        .map((n) => `char-player-${n}`)
        .filter((k) => this.textures.exists(k));
      if (variants.length > 0) {
        let h = 0;
        const seed = profile.agentId || profile.name || "you";
        for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        spriteKey = variants[h % variants.length];
      } else if (this.textures.exists("char-player")) {
        spriteKey = "char-player"; // last-resort legacy fallback
      }
    }

    this.playerSprite = new PlayerSprite(this, sx, sy, {
      id: profile.agentId,
      name: profile.name,
      initials: profile.initials,
      color: profile.color,
      town: profile.town,
      spriteKey,
    });
    // Automated product captures need stable composition; pausing player
    // input also prevents proximity dwell from opening a random chat panel.
    if (this.captureMode) this.playerSprite.inputEnabled = false;

    // Register in agentSprites so depth sorting includes the player
    this.agentSprites.set(profile.agentId, this.playerSprite);

    // Camera follow with smooth lerp + closer zoom while a player is present.
    this.cameras.main.startFollow(this.playerSprite, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, Number(this.game.config.width), Number(this.game.config.height));
    this.cameras.main.zoomTo(this.playerFollowZoom(), 600, "Sine.easeInOut");

    this.events.emit("player-spawned");
  }

  /**
   * Follow-camera zoom scaled to the canvas. The old fixed 1.5 framed ~260
   * world-px on a 390-px phone — a wall of grass with one giant sprite. Wider
   * canvases keep the intimate 1.5; phones pull back to show the town.
   */
  private playerFollowZoom(): number {
    return Phaser.Math.Clamp(this.scale.width / 520, 0.75, 1.5);
  }

  getPlayerSprite(): PlayerSprite | null {
    return this.playerSprite;
  }

  /** Find the closest non-player agent within radius of (px, py). */
  getNearbyAgent(
    px: number,
    py: number,
    radius: number,
  ): { agentId: string; sprite: AgentSprite } | null {
    let closestDist = Infinity;
    let closest: { agentId: string; sprite: AgentSprite } | null = null;

    for (const [id, sprite] of this.agentSprites) {
      if (sprite === this.playerSprite) continue;
      const dist = Phaser.Math.Distance.Between(px, py, sprite.x, sprite.y);
      if (dist < radius && dist < closestDist) {
        closestDist = dist;
        closest = { agentId: id, sprite };
      }
    }
    return closest;
  }

  /** Set player input enabled/disabled (e.g., when chat panel is open). */
  setPlayerInputEnabled(enabled: boolean) {
    if (this.playerSprite) {
      this.playerSprite.inputEnabled = enabled;
    }
  }

  /* ── Routines ─────────────────────────────────────────── */

  private tickRoutines() {
    if (this.agentRecords.size === 0) return;
    for (const [id, rec] of this.agentRecords) {
      if (!rec.routine) continue;
      const entry = rec.routine.currentEntryAt(this.worldClock.hour, this.worldClock.minute);
      if (!entry) continue;
      if (rec.lastRoutineTime === entry.time) continue;
      rec.lastRoutineTime = entry.time;

      // If the target location is recognized, move there.
      if (this.landmarkPositions.has(entry.location)) {
        this.moveAgent(id, entry.location);
      }
    }
  }

  /* ── Autonomous Wandering (fallback when no routine) ───── */

  private scheduleWander(agentId: string) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite || !this.scene?.isActive?.()) return;

    const idleDelay = Phaser.Math.Between(4000, 13000);
    this.time.delayedCall(idleDelay, () => {
      const sp = this.agentSprites.get(agentId);
      if (!sp) return;

      const target = this.pickWanderTarget(sp);
      sp.moveToPosition(target.x, target.y, () => {
        // Occasionally show an idle thought after arriving.
        // Prefer the agent's own bank (from agent.idle_thoughts) over generic.
        const visibleBubbles = [...this.agentSprites.values()]
          .reduce((total, agent) => total + agent.getSpeechBubbleCount(), 0);
        if (Math.random() < 0.28 && visibleBubbles < 2) {
          const rec = this.agentRecords.get(agentId);
          const bank = rec?.idleThoughts && rec.idleThoughts.length > 0
            ? rec.idleThoughts
            : IDLE_THOUGHTS;
          const thought = bank[Math.floor(Math.random() * bank.length)];
          this.time.delayedCall(600, () => sp.showSpeechBubble(thought, 3200));
        }
        // Re-schedule next wander
        this.scheduleWander(agentId);
      });
    });
  }

  private pickWanderTarget(exclude?: AgentSprite): { x: number; y: number } {
    if (this.wanderPoints.length === 0) return this.findFreeNear(400, 400, { clearOf: 34, exclude });
    // Rejection-sample so NPCs stop walking into (through) buildings — or
    // into each other (occupancy keeps wander targets a body-width apart).
    for (let attempt = 0; attempt < 10; attempt++) {
      const pt = this.wanderPoints[Math.floor(Math.random() * this.wanderPoints.length)];
      const x = Phaser.Math.Clamp(pt.x + Phaser.Math.Between(-70, 70), 40, 1160);
      const y = Phaser.Math.Clamp(pt.y + Phaser.Math.Between(-45, 45), 40, 760);
      if (!this.isBlocked(x, y) && !this.isOccupied(x, y, 34, exclude)) return { x, y };
    }
    const pt = this.wanderPoints[Math.floor(Math.random() * this.wanderPoints.length)];
    return this.findFreeNear(pt.x, pt.y, { clearOf: 34, exclude });
  }

  private addScatteredWaypoints(W: number, H: number) {
    const cols = 5, rows = 4;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = 120 + (c / (cols - 1)) * (W - 240);
        const y = 140 + (r / (rows - 1)) * (H - 280);
        // Skip grid points buried inside buildings — findFreeNear would pile
        // several waypoints onto the same door apron otherwise.
        if (this.isBlocked(x, y, 10)) continue;
        this.wanderPoints.push({ x, y });
      }
    }
  }

  /* ── Encounter conversations ───────────────────────────── */

  private tryEncounterConversation() {
    if (this.agentSprites.size < 2) return;
    const all = [...this.agentSprites.entries()].filter(([_, s]) => s !== this.playerSprite);
    if (all.length < 2) return;

    // Pick a random pair within 100px of each other.
    Phaser.Utils.Array.Shuffle(all);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i][1], b = all[j][1];
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        if (d <= 100) {
          this.runEncounter(a, b);
          return;
        }
      }
    }
  }

  private runEncounter(a: AgentSprite, b: AgentSprite) {
    // Face each other for ~3s, exchange two lines.
    a.faceToward(b.x, b.y);
    b.faceToward(a.x, a.y);
    a.setActivity("talking");
    b.setActivity("talking");

    const exchange = pickExchange(undefined, undefined);
    a.showSpeechBubble(exchange.a, 2400, "neutral", true);
    this.time.delayedCall(1500, () => b.showSpeechBubble(exchange.b, 2400, "neutral", true));
    this.time.delayedCall(4200, () => {
      a.setActivity("idle");
      b.setActivity("idle");
    });
  }

  /* ── Character Animations ────────────────────────────────── */

  private createCharacterAnimations() {
    const dirs: Array<{ name: string; start: number; end: number; idle: number }> = [
      { name: "down",  start: 0, end: 2,  idle: 1  },
      { name: "left",  start: 3, end: 5,  idle: 4  },
      { name: "right", start: 6, end: 8,  idle: 7  },
      { name: "up",    start: 9, end: 11, idle: 10 },
    ];

    // Base bodies + baked palette-swap sheets all need walk/idle anims
    // (accessory overlays are frame-synced, not independently animated).
    const bodyKeys = [
      ...[...this.characterKeys].map((n) => `char-${n}`),
      ...Object.keys(ALL_CUSTOM_SHEETS),
    ];
    for (const key of bodyKeys) {
      if (!this.textures.exists(key)) continue;

      for (const d of dirs) {
        const walkKey = `${key}-walk-${d.name}`;
        if (!this.anims.exists(walkKey)) {
          this.anims.create({
            key: walkKey,
            frames: this.anims.generateFrameNumbers(key, { start: d.start, end: d.end }),
            frameRate: 9,
            repeat: -1,
          });
        }
        const idleKey = `${key}-idle-${d.name}`;
        if (!this.anims.exists(idleKey)) {
          this.anims.create({
            key: idleKey,
            frames: [
              { key, frame: d.idle },
              { key, frame: d.start },
              { key, frame: d.idle },
              { key, frame: d.end },
            ],
            frameRate: 1.6,
            repeat: -1,
            repeatDelay: 1200,
          });
        }
      }
    }
  }

  /** Create walk/idle animations for the player sprite variants. */
  private createPlayerAnimations() {
    const playerKeys = ["char-player", "char-player-1", "char-player-2", "char-player-3", "char-player-4", "char-player-5", "char-player-6"];

    const dirs = [
      { name: "down", start: 0, end: 2, idle: 1 },
      { name: "left", start: 3, end: 5, idle: 4 },
      { name: "right", start: 6, end: 8, idle: 7 },
      { name: "up", start: 9, end: 11, idle: 10 },
    ];

    for (const key of playerKeys) {
      if (!this.textures.exists(key)) continue;
      for (const d of dirs) {
        const walkKey = `${key}-walk-${d.name}`;
        if (!this.anims.exists(walkKey)) {
          this.anims.create({
            key: walkKey,
            frames: this.anims.generateFrameNumbers(key, { start: d.start, end: d.end }),
            frameRate: 9,
            repeat: -1,
          });
        }
        const idleKey = `${key}-idle-${d.name}`;
        if (!this.anims.exists(idleKey)) {
          this.anims.create({
            key: idleKey,
            frames: [
              { key, frame: d.idle },
              { key, frame: d.start },
              { key, frame: d.idle },
              { key, frame: d.end },
            ],
            frameRate: 1.6,
            repeat: -1,
            repeatDelay: 1200,
          });
        }
      }
    }
  }

  /* ── Ambient Background NPCs (use AgentSprite for richness) ──── */

  private ambientNPCs: AgentSprite[] = [];

  private spawnAmbientNPCs() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    const count = 4;
    const names = [...this.characterKeys];
    if (names.length === 0) return;

    for (let i = 0; i < count; i++) {
      const charName = names[Math.floor(Math.random() * names.length)];
      const key = `char-${charName}`;
      if (!this.textures.exists(key)) continue;

      const spawn = this.findFreeNear(
        Phaser.Math.Between(80, W - 80),
        Phaser.Math.Between(120, H - 120),
      );
      const sx = spawn.x;
      const sy = spawn.y;

      const npc = new AgentSprite(this, sx, sy, {
        id: `ambient-${i}-${charName}`,
        name: "passerby",
        initials: "",
        color: "#aaa",
        town: this.townId,
        spriteKey: key,
        ambient: true,
      });
      this.ambientNPCs.push(npc);

      this.scheduleAmbientWander(npc, W, H);
    }
  }

  private scheduleAmbientWander(npc: AgentSprite, W: number, H: number) {
    const delay = Phaser.Math.Between(2000, 9000);
    this.time.delayedCall(delay, () => {
      if (!npc.active) return;
      // Prefer wandering between landmarks when available
      const target = this.wanderPoints.length > 0
        ? this.wanderPoints[Math.floor(Math.random() * this.wanderPoints.length)]
        : { x: Phaser.Math.Between(80, W - 80), y: Phaser.Math.Between(120, H - 120) };
      const t = this.findFreeNear(
        target.x + Phaser.Math.Between(-40, 40),
        target.y + Phaser.Math.Between(-30, 30),
        { clearOf: 34, exclude: npc },
      );
      npc.moveToPosition(t.x, t.y, () => this.scheduleAmbientWander(npc, W, H));
    });
  }

  /* ── Birds (ambient sky life) ───────────────────────────── */

  private scheduleBirds(W: number, H: number) {
    const launchBird = () => {
      const fromLeft = Math.random() < 0.5;
      const y = Phaser.Math.Between(40, H / 3);
      const x0 = fromLeft ? -20 : W + 20;
      const x1 = fromLeft ? W + 20 : -20;

      const bird = this.add.graphics();
      bird.lineStyle(2, 0x334455, 0.55);
      bird.lineBetween(-5, 0, 0, -3);
      bird.lineBetween(0, -3, 5, 0);
      bird.setPosition(x0, y);
      // Birds fly over the rooftops (buildings-top is 5000), under the sky tint.
      bird.setDepth(5450);

      const duration = Phaser.Math.Between(6000, 12000);

      this.tweens.add({
        targets: bird,
        scaleY: -1,
        duration: 280,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      this.tweens.add({
        targets: bird,
        x: x1,
        y: y + Phaser.Math.Between(-20, 20),
        duration,
        ease: "Sine.easeInOut",
        onComplete: () => bird.destroy(),
      });

      const nextDelay = Phaser.Math.Between(3000, 9000);
      this.time.delayedCall(nextDelay, launchBird);
    };

    for (let i = 0; i < 3; i++) {
      this.time.delayedCall(Phaser.Math.Between(1000, 5000), launchBird);
    }
  }

  /* ── Tilemap / Landmark layout ─────────────────────────── */

  /**
   * Build the generated per-town tilemap: five tile layers with the agreed
   * depth scheme, plus the "collision" and "anchors" object layers.
   *
   * Depth scheme: ground 0 / ground-detail 1 / deco-below 2 /
   * buildings-base 3 (below agents) / agents 100+y (syncDepth) /
   * buildings-top 5000 (agents walk BEHIND roofs & awnings) /
   * sky tint 6000 / lamp glow 6001.
   */
  private buildTilemap(W: number, H: number) {
    const mapKey = townMapKey(this.townId);
    if (!this.cache.tilemap.has(mapKey)) {
      console.warn(`[TownScene] tilemap missing for town "${this.townId}"`);
      this.buildFallbackTown(W, H);
      return;
    }

    const map = this.make.tilemap({ key: mapKey });
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const name of ["rpg-tileset", "township-modern"]) {
      const ts = map.addTilesetImage(name, name);
      if (ts) tilesets.push(ts);
    }
    if (tilesets.length === 0) {
      this.buildFallbackTown(W, H);
      return;
    }

    const layerDepths: Array<[string, number]> = [
      ["ground", 0],
      ["ground-detail", 1],
      ["deco-below", 2],
      ["buildings-base", 3],
      ["buildings-top", 5000],
    ];
    // Maps are authored at exactly 75x50 @ 16px = 1200x800, matching the
    // logical space. Guard with a scale factor anyway so a future map size
    // change degrades gracefully instead of misaligning agents.
    const scale = map.widthInPixels > 0 ? W / map.widthInPixels : 1;
    for (const [name, depth] of layerDepths) {
      const layer = map.createLayer(name, tilesets);
      layer?.setDepth(depth).setScale(scale).setVisible(true);
    }
    void H;

    // ── Collision: static physics rects from the "collision" object layer.
    this.collisionRects = [];
    this.collisionGroup = this.physics.add.staticGroup();
    const collision = map.getObjectLayer("collision");
    for (const o of collision?.objects ?? []) {
      const w = (o.width ?? 0) * scale;
      const h = (o.height ?? 0) * scale;
      if (w <= 0 || h <= 0) continue;
      const x = (o.x ?? 0) * scale;
      const y = (o.y ?? 0) * scale;
      this.collisionRects.push({ x, y, w, h });
      const zone = this.add.zone(x + w / 2, y + h / 2, w, h);
      this.physics.add.existing(zone, true);
      this.collisionGroup.add(zone);
    }

    // ── Anchors: live-detail points for SceneAmbience + label positions.
    this.mapAnchors = [];
    this.mapLabels.clear();
    const anchors = map.getObjectLayer("anchors");
    for (const o of anchors?.objects ?? []) {
      const props: Record<string, string> = {};
      for (const p of (o.properties as Array<{ name: string; value: string }> | undefined) ?? []) {
        props[p.name] = p.value;
      }
      const kind = props.kind;
      if (!kind) continue;
      const x = (o.x ?? 0) * scale;
      const y = (o.y ?? 0) * scale;
      if (kind === "label") {
        const name = o.name || props.text;
        if (name) this.mapLabels.set(name, { x, y });
        continue;
      }
      this.mapAnchors.push({ kind, x, y, stamp: props.stamp });
    }

    this.builtMap = map;
  }

  /**
   * Draw a small, legible pixel-town directly from scenario landmark data.
   * This is the first-run path for newly scaffolded scenarios: map art is an
   * optional enhancement, never a prerequisite for a usable simulation.
   */
  private buildFallbackTown(W: number, H: number) {
    this.fallbackWorld?.destroy(true);
    this.fallbackWorld = this.add.container(0, 0).setDepth(-5);
    this.builtMap = undefined;
    this.mapAnchors = [];
    this.mapLabels.clear();

    this.collisionGroup?.clear(true, true);
    this.collisionRects = [];
    this.collisionGroup = this.physics.add.staticGroup();

    const ink = 0x4b3b2b;
    const background = Phaser.Display.Color.HexStringToColor(townBgColor(this.townId)).color;
    const accent = Phaser.Display.Color.HexStringToColor(townAccent(this.townId)).color;
    const ground = this.add.graphics();
    ground.fillStyle(background, 1);
    ground.fillRect(0, 0, W, H);
    // A quiet checker texture keeps the generated world from reading as a
    // placeholder while remaining neutral across scenario subject matter.
    for (let y = 0; y < H; y += 32) {
      for (let x = (y / 32) % 2 === 0 ? 0 : 32; x < W; x += 64) {
        ground.fillStyle(0xffffff, 0.035);
        ground.fillRect(x, y, 32, 32);
      }
    }
    this.fallbackWorld.add(ground);

    const ordered = [...this.landmarks].sort((a, b) => {
      const priority = (item: LandmarkData) => {
        const type = item.type.toLowerCase();
        if (type.includes("road") || type.includes("street") || type.includes("path")) return 0;
        if (type.includes("water") || type.includes("river") || type.includes("lake")) return 1;
        if (type.includes("park") || type.includes("green")) return 2;
        return 3;
      };
      return priority(a) - priority(b);
    });

    for (const landmark of ordered) {
      const type = landmark.type.toLowerCase();
      const x = Phaser.Math.Clamp(landmark.x, 12, W - 12);
      const y = Phaser.Math.Clamp(landmark.y, 12, H - 12);
      const width = Phaser.Math.Clamp(landmark.width, 18, W - x - 8);
      const height = Phaser.Math.Clamp(landmark.height, 16, H - y - 8);
      const authored = landmark.color
        ? Phaser.Display.Color.HexStringToColor(landmark.color).color
        : accent;
      const shape = this.add.graphics();

      if (type.includes("road") || type.includes("street") || type.includes("path")) {
        shape.fillStyle(0x9d8467, 0.92);
        shape.fillRoundedRect(x, y, width, height, Math.min(8, height / 3));
        shape.lineStyle(2, 0xf1d39b, 0.62);
        if (width >= height) {
          for (let dx = x + 20; dx < x + width - 8; dx += 42) {
            shape.lineBetween(dx, y + height / 2, Math.min(dx + 20, x + width), y + height / 2);
          }
        } else {
          for (let dy = y + 20; dy < y + height - 8; dy += 42) {
            shape.lineBetween(x + width / 2, dy, x + width / 2, Math.min(dy + 20, y + height));
          }
        }
      } else if (type.includes("water") || type.includes("river") || type.includes("lake")) {
        shape.fillStyle(0x79aeb2, 0.92);
        shape.fillRoundedRect(x, y, width, height, 12);
        shape.lineStyle(2, 0xc5e7df, 0.68);
        for (let dy = y + 12; dy < y + height; dy += 18) {
          shape.lineBetween(x + 12, dy, x + Math.max(14, width - 12), dy);
        }
      } else if (type.includes("park") || type.includes("green") || type.includes("garden")) {
        shape.fillStyle(authored, 0.62);
        shape.fillRoundedRect(x, y, width, height, 10);
        shape.lineStyle(2, 0xeff1c7, 0.55);
        shape.strokeRoundedRect(x + 4, y + 4, Math.max(8, width - 8), Math.max(8, height - 8), 8);
        // Pixel-tree clusters at opposite corners.
        for (const [tx, ty] of [[x + 18, y + 18], [x + width - 18, y + height - 18]]) {
          shape.fillStyle(0x765238, 1);
          shape.fillRect(tx - 2, ty + 3, 4, 10);
          shape.fillStyle(0x4f855b, 1);
          shape.fillCircle(tx, ty, 10);
          shape.fillStyle(0x78a96f, 1);
          shape.fillCircle(tx - 4, ty - 4, 6);
        }
      } else {
        const roofHeight = Math.min(30, Math.max(12, height * 0.28));
        const wallY = y + roofHeight * 0.65;
        const wallHeight = Math.max(12, height - roofHeight * 0.65);
        shape.fillStyle(0x3a2d22, 0.2);
        shape.fillRoundedRect(x + 5, wallY + 7, width, wallHeight, 4);
        shape.fillStyle(authored, 0.82);
        shape.fillRoundedRect(x, wallY, width, wallHeight, 4);
        shape.fillStyle(Phaser.Display.Color.IntegerToColor(authored).darken(22).color, 1);
        shape.fillTriangle(x - 5, wallY + 3, x + width / 2, y, x + width + 5, wallY + 3);
        // A door and paired warm windows make every landmark readable at a
        // glance, even when its scenario only supplies a type and rectangle.
        const doorWidth = Math.min(16, width * 0.18);
        shape.fillStyle(ink, 0.86);
        shape.fillRect(x + width / 2 - doorWidth / 2, y + height - 24, doorWidth, 24);
        shape.fillStyle(0xffe0a0, 0.88);
        if (width > 48) {
          shape.fillRect(x + 11, wallY + 14, 13, 11);
          shape.fillRect(x + width - 24, wallY + 14, 13, 11);
        }

        const rect = { x, y: wallY, w: width, h: wallHeight };
        this.collisionRects.push(rect);
        const zone = this.add.zone(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h);
        this.physics.add.existing(zone, true);
        this.collisionGroup.add(zone);
      }
      this.fallbackWorld.add(shape);

      if (!(type.includes("road") || type.includes("street") || type.includes("path"))) {
        const label = this.add.text(x + width / 2, y + height + 5, landmark.name, {
          fontFamily: "Arial, sans-serif",
          fontSize: "11px",
          color: "#3f3226",
          backgroundColor: "rgba(255,250,238,0.88)",
          padding: { x: 5, y: 2 },
          resolution: 2,
        }).setOrigin(0.5, 0).setDepth(4);
        this.fallbackWorld.add(label);
        this.mapLabels.set(landmark.name, { x: x + width / 2, y: y + height + 5 });
      }
    }

    // A simple civic-square seal gives sparse packages a deliberate center.
    const seal = this.add.graphics();
    seal.lineStyle(3, accent, 0.4);
    seal.strokeCircle(W / 2, H / 2, 44);
    seal.lineStyle(1, accent, 0.24);
    seal.strokeCircle(W / 2, H / 2, 36);
    this.fallbackWorld.add(seal);
  }

  /**
   * Scan buildings-base for window tiles (GID list generated from the
   * mapgen registry — scripts/mapgen/export_window_gids.py) and cover each
   * with a warm additive pane + soft halo. Their alpha is driven from
   * refreshSkyOverlay() so they ignite through dusk and die at dawn.
   * Depth 6001 puts them above the sky tint (6000) — like the lamp glows,
   * they pierce the dark.
   */
  private buildWindowGlows() {
    this.windowGlows = [];
    const layer = this.builtMap?.getLayer("buildings-base")?.tilemapLayer;
    if (!layer) return;
    const tileSize: number = windowGids.tileSize;
    const glowKey = ensureWindowGlowTexture(this);
    type WindowSpec = {
      topLeftGid: number;
      w: number;
      h: number;
      panes: Array<{ x: number; y: number; w: number; h: number }>;
    };
    const place = (quads: WindowSpec[], paneMax: number, haloMax: number) => {
      for (const q of quads) {
        layer.forEachTile((tile) => {
          if (tile.index !== q.topLeftGid) return;
          const wpx = q.w * tileSize;
          const hpx = q.h * tileSize;
          const x = tile.pixelX;
          const y = tile.pixelY;
          // The generated metadata traces the actual glass silhouette. This
          // matters because the modern sash has tall panes while the teal
          // facade stamp has two tiny clerestory panes above a dark opening.
          for (const p of q.panes) {
            const pane = this.add.rectangle(
              x + p.x,
              y + p.y,
              p.w,
              p.h,
              0xffc873,
            )
              .setOrigin(0, 0)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(6001)
              .setAlpha(0);
            this.windowGlows.push({ obj: pane, max: paneMax });
          }
          // Soft spill halo around it.
          const halo = this.add.image(x + wpx / 2, y + hpx / 2, glowKey)
            .setDisplaySize(wpx * 3.4, hpx * 3.4)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(6001)
            .setAlpha(0);
          this.windowGlows.push({ obj: halo, max: haloMax });
        });
      }
    };
    place(windowGids.windows, 0.38, 0.34);
    this.refreshSkyOverlay();
  }

  /**
   * Keep the camera covering the 1200x800 map. When no player is spawned we
   * zoom so the viewport is filled (no dead space outside the map); once the
   * player exists the follow-camera (zoom 1.5) owns framing, bounds clamp it.
   */
  private fitCamera() {
    const cam = this.cameras.main;
    if (!cam) return;
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    cam.setBounds(0, 0, W, H);
    if (this.playerSprite) {
      // Keep the follow zoom proportional to the canvas across resizes /
      // orientation changes (phones get a wider frame than desktops).
      if (!this.convoFollowPaused) cam.setZoom(this.playerFollowZoom());
      return;
    }
    const zoom = Math.max(this.scale.width / W, this.scale.height / H);
    cam.setZoom(zoom);
    cam.centerOn(W / 2, H / 2);
  }

  /** Recompute landmark positions + wander waypoints from this.landmarks. */
  private rebuildLandmarks() {
    this.landmarkPositions.clear();
    this.wanderPoints = [];
    if (!this.builtMap) {
      this.buildFallbackTown(Number(this.game.config.width), Number(this.game.config.height));
    }
    this.layoutLandmarksAndDecor();
  }

  private layoutLandmarksAndDecor() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;
      // Landmark centers often sit inside a building's collision rect; nudge
      // the walk-target out to open ground (the door apron faces the road).
      const pos = this.findFreeNear(cx, cy);
      this.landmarkPositions.set(lm.name, pos);
      if (lm.type !== "road") this.wanderPoints.push(pos);
    }

    // Add a grid of "street corner" waypoints for richer wandering.
    this.addScatteredWaypoints(W, H);

    this.buildLandmarkLabels();
  }

  /**
   * In-canvas landmark name chips. World-space text can never detach from
   * its building the way screen-space DOM labels did under the zoomed
   * follow-camera, and it crops naturally at the camera edge instead of
   * clipping mid-word against the canvas border.
   */
  private buildLandmarkLabels() {
    for (const t of this.landmarkLabelTexts) t.destroy();
    this.landmarkLabelTexts = [];
    // Fallback towns already draw their labels into fallbackWorld.
    if (!this.builtMap) return;
    for (const lm of this.landmarks) {
      if (lm.type === "road") continue;
      const anchor = this.mapLabels.get(lm.name);
      const x = anchor ? anchor.x : lm.x + lm.width / 2;
      const y = anchor ? anchor.y : lm.y - 8;
      const label = this.add.text(x, y, lm.name, {
        fontFamily: "Inter, 'Helvetica Neue', sans-serif",
        fontSize: "9px",
        fontStyle: "bold",
        color: "#f5ead2",
        backgroundColor: "rgba(28,24,16,0.72)",
        padding: { x: 5, y: 2 },
        resolution: 3,
      }).setOrigin(0.5, 0.5).setDepth(5500).setAlpha(0.94);
      label.setData("lm", lm);
      this.landmarkLabelTexts.push(label);
    }
  }

  /* ── Collision-aware point picking ───────────────────────── */

  /** True when (x, y) falls inside any collision rect (with padding). */
  private isBlocked(x: number, y: number, pad = 6): boolean {
    for (const r of this.collisionRects) {
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) {
        return true;
      }
    }
    return false;
  }

  /** Every character body that occupies ground: residents, the player, and
   *  ambient passers-by. Used for spawn/walk-target occupancy so sprites
   *  never fuse into a single-tile pile. */
  private allBodies(): AgentSprite[] {
    return [...this.agentSprites.values(), ...this.ambientNPCs];
  }

  /** True when (x, y) is within `clearance` px of another body's position or
   *  its in-flight walk target. */
  private isOccupied(x: number, y: number, clearance: number, exclude?: AgentSprite): boolean {
    for (const body of this.allBodies()) {
      if (body === exclude || !body.active) continue;
      if (Phaser.Math.Distance.Between(x, y, body.x, body.y) < clearance) return true;
      const target = body.getReservedTarget();
      if (target && Phaser.Math.Distance.Between(x, y, target.x, target.y) < clearance) return true;
    }
    return false;
  }

  /**
   * Nearest open point to (x, y) — ring-samples outward until unblocked.
   * With `opts.clearOf`, points near another body (or a body's in-flight walk
   * target) count as blocked too: characters land on per-spot slots instead
   * of interpenetrating on one tile.
   */
  private findFreeNear(
    x: number,
    y: number,
    opts?: { clearOf?: number; exclude?: AgentSprite },
  ): { x: number; y: number } {
    const clearOf = opts?.clearOf ?? 0;
    const open = (px: number, py: number) =>
      !this.isBlocked(px, py) && (clearOf <= 0 || !this.isOccupied(px, py, clearOf, opts?.exclude));

    const cx = Phaser.Math.Clamp(x, 40, 1160);
    const cy = Phaser.Math.Clamp(y, 40, 760);
    if (open(cx, cy)) return { x: cx, y: cy };
    // Sub-tile slots first (18 px) so a crowd fans out around its meeting
    // point, then widening rings until open ground is found.
    for (const radius of [18, 32, 48, 72, 96, 120, 144, 168]) {
      // Try straight down first (doors face roads below buildings), then ring.
      const candidates: Array<{ x: number; y: number }> = [{ x: cx, y: cy + radius }];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        candidates.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
      }
      for (const c of candidates) {
        const px = Phaser.Math.Clamp(c.x, 40, 1160);
        const py = Phaser.Math.Clamp(c.y, 40, 760);
        if (open(px, py)) return { x: px, y: py };
      }
    }
    return { x: cx, y: cy };
  }

  /* ── Sky tint refresh ───────────────────────────────────── */

  private refreshSkyOverlay() {
    if (!this.skyOverlay) return;
    const h = this.worldClock.fractionalHour();
    const tint = WorldClock.computeDayNightTint(h);
    this.skyOverlay.setFillStyle(tint.color, tint.alpha);

    // Window ignition curve: dark → lit across dusk (17:00-19:30), lit all
    // night, fading out across dawn (5:00-7:00). Minute-level clock steps
    // make the ramp read as a continuous fade.
    let g = 0;
    if (h >= 17 && h < 19.5) g = (h - 17) / 2.5;
    else if (h >= 19.5 || h < 5) g = 1;
    else if (h >= 5 && h < 7) g = 1 - (h - 5) / 2;
    for (const w of this.windowGlows) w.obj.setAlpha(w.max * g);
  }

  /* ── Per-town flavor — papel-picado, ducks, dogs, leaves ── */

  private addTownFlavor(town: TownId) {
    if (this.scenarioId !== "nj11-2026") return;
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    switch (town) {
      case "dover": return this.addDoverFlavor(W, H);
      case "montclair": return this.addMontclairFlavor(W, H);
      case "parsippany": return this.addParsippanyFlavor(W, H);
      case "randolph": return this.addRandolphFlavor(W, H);
    }
  }

  private addDoverFlavor(W: number, H: number) {
    // NOTE: the papel-picado bunting (strung between two random landmark
    // roofs) was dropped with the move to real tilemaps — over baked pixel
    // buildings the unstrung triangles read as floating confetti.

    // Reduced motion keeps the map, residents, and authored tile details but
    // omits all continuously scheduled decorative motion.
    if (this.reducedMotionRequested || reducedMotion()) return;

    // Salsa music notes ♪ near "Bodega Row"
    const bodega = this.landmarkPositions.get("Bodega Row") ?? this.landmarkPositions.get("La Finca Restaurant");
    if (bodega) {
      this.time.addEvent({
        delay: 4500, loop: true,
        callback: () => {
          const note = this.add.text(bodega.x + Phaser.Math.Between(-20, 20), bodega.y - 8, "♪", {
            fontFamily: "serif", fontSize: "14px", color: "#d97706", resolution: 2,
          });
          note.setOrigin(0.5, 1).setDepth(120);
          this.tweens.add({
            targets: note, y: note.y - 40, alpha: 0,
            duration: 2200, ease: "Sine.easeOut", onComplete: () => note.destroy(),
          });
        },
      });
    }

    // Terracotta leaves stream from upper-left
    this.time.addEvent({
      delay: 1700, loop: true,
      callback: () => this.spawnLeaf(W, H, [0xc0792a, 0xd9794b, 0xe0a86b]),
    });
  }

  private addMontclairFlavor(W: number, H: number) {
    // Falling sugar maple leaves — saturated reds & oranges
    if (!(this.reducedMotionRequested || reducedMotion())) {
      this.time.addEvent({
        delay: 1100, loop: true,
        callback: () => this.spawnLeaf(W, H, [0xb9302a, 0xe25e3b, 0xd8a14a, 0xa84c6c]),
      });
    }

    // Pride / HHNHHF lawn signs near Town Hall
    const hall = this.landmarkPositions.get("Town Hall");
    if (hall) {
      for (let i = 0; i < 2; i++) {
        const sign = this.add.graphics();
        const off = i === 0 ? -22 : 22;
        sign.fillStyle(0xffffff, 0.95);
        sign.fillRoundedRect(-8, -10, 16, 12, 2);
        sign.fillStyle(0x4a3aaf, 1); sign.fillRect(-7, -9, 14, 3);
        sign.fillStyle(0xc23b8b, 1); sign.fillRect(-7, -6, 14, 3);
        sign.fillStyle(0x2da8a8, 1); sign.fillRect(-7, -3, 14, 3);
        sign.fillStyle(0x2c2416, 1); sign.fillRect(-1, 1, 2, 6);
        sign.setPosition(hall.x + off, hall.y + 32).setDepth(60);
      }
    }
  }

  private addParsippanyFlavor(W: number, H: number) {
    if (this.reducedMotionRequested || reducedMotion()) return;

    // Duck flies across Lake Parsippany every 30s
    const lake = this.landmarkPositions.get("Lake Parsippany");
    if (lake) {
      const fly = () => {
        const duck = this.add.graphics();
        duck.fillStyle(0x2f2417, 1);
        duck.fillEllipse(0, 0, 12, 6);
        duck.fillEllipse(6, -3, 5, 4);
        duck.lineStyle(2, 0xb88a52, 1);
        // Airborne — above the rooftops.
        duck.setDepth(5450).setPosition(-20, lake.y);
        this.tweens.add({
          targets: duck, x: W + 20,
          duration: 8000, ease: "Sine.easeInOut",
          onUpdate: () => duck.setY(lake.y + Math.sin(duck.x / 60) * 18),
          onComplete: () => duck.destroy(),
        });
      };
      this.time.addEvent({ delay: 30000, loop: true, callback: fly });
      this.time.delayedCall(4000, fly);
    }

    // Lawnmower NPC pacing in front of a residential landmark
    const res = this.landmarks.find((l) => l.type === "housing");
    if (res) {
      const mower = this.add.graphics();
      mower.fillStyle(0xb14c2a, 1); mower.fillRect(-8, -4, 16, 8);
      mower.fillStyle(0x222222, 1); mower.fillCircle(-6, 4, 3); mower.fillCircle(6, 4, 3);
      mower.setDepth(55).setPosition(res.x + 10, res.y + res.height + 8);
      this.tweens.add({
        targets: mower, x: res.x + res.width - 10,
        duration: 6000, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        onUpdate: () => mower.setDepth(55 + mower.y),
      });
    }
  }

  private addRandolphFlavor(W: number, H: number) {
    if (this.reducedMotionRequested || reducedMotion()) return;

    // Two golden retrievers chasing each other in Hedden Park
    const park = this.landmarkPositions.get("Hedden Park") ?? this.landmarks.find((l) => l.type === "park");
    if (park) {
      const cx = (park as any).x ?? (park as { x: number }).x;
      const cy = (park as any).y ?? (park as { y: number }).y;
      for (let i = 0; i < 2; i++) {
        const dog = this.add.graphics();
        dog.fillStyle(0xe0b87c, 1);
        dog.fillEllipse(0, 0, 12, 7);
        dog.fillEllipse(6, -2, 5, 5);
        dog.fillStyle(0x7a5836, 1);
        dog.fillCircle(8, -3, 1.5);
        dog.lineStyle(2, 0xe0b87c, 1);
        dog.lineBetween(-6, 0, -10, -2);
        dog.setDepth(60).setPosition(cx + i * 30, cy);
        const orbit = () => {
          const tx = cx + Phaser.Math.Between(-40, 40);
          const ty = cy + Phaser.Math.Between(-30, 30);
          this.tweens.add({
            targets: dog, x: tx, y: ty,
            duration: Phaser.Math.Between(1100, 2200),
            ease: "Sine.easeInOut",
            onUpdate: () => dog.setDepth(60 + dog.y),
            onComplete: orbit,
          });
        };
        orbit();
      }
    }

    // Kid soccer-ball bouncing near "Sports Fields"
    const sports = this.landmarkPositions.get("Sports Fields");
    if (sports) {
      const ball = this.add.graphics();
      ball.fillStyle(0xffffff, 1); ball.fillCircle(0, 0, 4);
      ball.lineStyle(1, 0x222222, 0.6); ball.strokeCircle(0, 0, 4);
      ball.setPosition(sports.x, sports.y).setDepth(60);
      this.tweens.add({
        targets: ball, y: ball.y - 18,
        duration: 380, yoyo: true, repeat: -1, ease: "Sine.easeOut",
      });
      this.tweens.add({
        targets: ball, x: sports.x + 40,
        duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    }
  }

  private spawnLeaf(W: number, H: number, palette: number[]) {
    const leaf = this.add.graphics();
    const color = palette[Math.floor(Math.random() * palette.length)];
    leaf.fillStyle(color, 0.85);
    leaf.fillEllipse(0, 0, 6, 3);
    leaf.lineStyle(0.6, 0x000000, 0.18);
    leaf.strokeEllipse(0, 0, 6, 3);
    const startX = Phaser.Math.Between(-30, W * 0.3);
    // Falling from the sky — drifts over rooftops.
    leaf.setPosition(startX, -10).setDepth(5440);
    const endX = startX + Phaser.Math.Between(120, 240);
    this.tweens.add({
      targets: leaf, x: endX, y: H + 12,
      duration: Phaser.Math.Between(8000, 13000),
      ease: "Linear",
      onUpdate: () => {
        leaf.setRotation(leaf.rotation + 0.02);
      },
      onComplete: () => leaf.destroy(),
    });
  }

  private buildTitleBanner(_W: number) {
    // Title banner now rendered as DOM element in TownView.tsx
  }

  /* ── Utility ─────────────────────────────────────────────── */

  private initials(name: string) {
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  }

  /** Scenario option colors injected from React. */
  private optionColors: Record<string, string> = {};

  /** Inject the active scenario's option→color map (see TownView). */
  setOptionColors(colors: Record<string, string>) {
    this.optionColors = colors || {};
  }

  private opinionColor(candidate?: string): string {
    if (candidate && this.optionColors[candidate]) return this.optionColors[candidate];
    return "#FFFFFF";
  }
}

// Reference unused customization to keep tree-shaking honest.
void AGENT_CUSTOMIZATION;

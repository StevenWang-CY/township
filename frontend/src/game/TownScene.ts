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
import {
  type Direction,
  AgentSprite,
  type AgentActivity,
  type BubbleSentiment,
  type EmotionalResponse,
  type GestureKind,
  type VoteImpact,
} from "./AgentSprite";
import { stanceChangeKind, stanceTier, type StanceChange, type StanceState } from "../lib/stance";
import { PlayerSprite } from "./PlayerSprite";
import { RENDER_DPR, townAccent, townBgColor, townMapKey } from "./config";
import type { AgentState, TownId, LandmarkData, TownData, WeatherKind } from "../types/messages";
import type { UserProfile } from "../context/UserProfileContext";
import {
  AGENT_CUSTOMIZATION,
  ALL_ACCESSORY_SHEETS,
  ALL_CHARACTER_KEYS,
  ALL_CUSTOM_SHEETS,
  resolveAgentSprite, passerbyPool,
} from "./spriteCustomization";
import { composeTownAmbience, type AmbienceHandle, type MapAnchor } from "./SceneAmbience";
import { CivicLayer, type CivicEnv, type CivicResident } from "./CivicLayer";
import { WorldClock } from "./WorldClock";
import { Routine, type RoutineEntry } from "./Routine";
import { pickExchange, relationshipKind, sharedConcernKey } from "./AmbientLines";
import { ConversationChoreographer } from "./Conversations";
import { arrivalFacing, deriveActivity, dwellRoles, isRestingHour, shouldBeIndoors } from "./DayPart";
import { SpotRegistry, spotsFromAnchors, type Placement } from "./Spots";
import { fnv1a } from "../lib/hash";
import { landmarksFor } from "../hooks/useTownData";
import { WeatherScene } from "./WeatherScene";
import {
  PIXEL_FONT_OUTLINED,
  ensureNewspaperTexture,
  ensurePixelFont,
  ensureSquareTexture,
  ensureVignetteTexture,
  ensureWindowGlowTexture,
  mulberry32,
  pixelText,
  reducedMotion,
} from "./pixelTextures";
import windowGids from "./windowGids.json";
import { DEMO_MODE } from "../demo/demoMode";
import { NavGrid, WORLD_H, WORLD_MARGIN, WORLD_W, truncatePath, type GroundKind, type Pt } from "./NavGrid";
import roadGids from "./roadGids.json";

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
/** Minimum open ground between a wander/spawn target and any other body —
 *  ~3 tiles, so idle residents hold conversational distance instead of
 *  stacking into one label pile. */

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
  /** Persona relationships: other agent id → type (friend, neighbor…). */
  relationships?: Record<string, string>;
  /** Scene time of this resident's last ambient encounter (cooldown). */
  lastEncounterAt?: number;
  /** Landmark the resident last arrived at (drives day-part activities). */
  location?: string;
  /** Idle life: the next look-around / step / thought beat. */
  idleTimer?: Phaser.Time.TimerEvent;
  /** Sim minute the resident settled at the current stop (errands). */
  arrivedAtMin?: number;
  /** An errand is in flight (window-shopping, a bench) until this scene time. */
  errandUntil?: number;
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
  /** Stroll targets for passers-by (landmark aprons). */
  private wanderPoints: Array<{ x: number; y: number }> = [];
  /** Authored standing spots per landmark + who holds which (Spots.ts). */
  private spots?: SpotRegistry;
  /** Buildings with someone inside right now (day glow, chip pips). */
  private occupiedLandmarks = new Set<string>();
  private collisionGroup?: Phaser.Physics.Arcade.StaticGroup;
  /** Blocked rectangles from the tilemap's "collision" object layer (px). */
  private collisionRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Live-detail anchors from the tilemap's "anchors" object layer. */
  private mapAnchors: MapAnchor[] = [];
  /** Landmark-name → grid-snapped label position from the map's label anchors. */
  private mapLabels: Map<string, { x: number; y: number }> = new Map();
  /** In-canvas landmark name chips (tilemap towns; fallback towns draw their own). */
  private landmarkLabelTexts: Phaser.GameObjects.Container[] = [];
  /** World scale applied to every in-world label so each font texel covers
   *  a whole number of screen pixels at the current camera zoom. */
  private labelScale = 1;
  private labelZoom = 0;
  /** Town population from the scenario (busier sky, more passers-by). */
  private population = 0;
  private townDataResolved = false;
  private playerSpawnPending: UserProfile | null = null;
  /** Round-robin cursor for landmark-fallback spawns (see addAgent). */
  private spawnCursor = 0;

  // World clock + sky overlay
  private worldClock = new WorldClock({ startHour: 8, minutesPerSecond: 1 });
  private skyOverlay?: Phaser.GameObjects.Rectangle;
  private currentWeather: WeatherKind = "clear";

  // Night-time lamp glow + sky tint are owned by SceneAmbience + the sky overlay.
  private ambience?: AmbienceHandle;
  /** The election as the town shows it (signs, banners, board, polls). */
  private civic?: CivicLayer;
  private lastCivic?: { env: CivicEnv; residents: CivicResident[] };
  /** Ballot procession: residents waiting at the rope, one at the box. */
  private pollQueue: AgentSprite[] = [];
  private boxBusy = false;
  /** Voters on their way to the rope or the box: they finish their ballot
   *  even when the feed marks them decided meanwhile. */
  private processionIds = new Set<string>();
  /** Results arrived mid-procession: celebrate once the last ballot drops. */
  private pendingCelebration: string | null = null;
  /** Where passers-by pause during the news phase (the notice board). */
  private commuterFocus: { x: number; y: number } | null = null;
  /** Sidewalk points at the map edge where passers-by enter and leave. */
  private portals: Array<{ x: number; y: number }> = [];
  private commuterSerial = 0;
  /** Resident selected in the UI (their name always shows). */
  private selectedAgentId: string | null = null;
  /** "all" shows every nameplate (captures); "quiet" is the label policy. */
  private labelPolicy: "quiet" | "all" = "quiet";
  /** Scene time of the last ambient encounter anywhere in town. */
  private lastEncounterTownAt = -Infinity;
  /** One idle thought bubble at a time, town-wide. */
  private idleBubbleUntil = 0;
  /** At most one errand in flight per town. */
  private errandInFlight = 0;

  // Encounter scheduling
  private encounterTimer?: Phaser.Time.TimerEvent;
  /** Formation, turn-taking and dispersal for every on-screen exchange. */
  private choreo!: ConversationChoreographer;
  /** Resident currently in the player's talk radius (set by the player). */
  private proximityAgentId: string | null = null;

  // Night window glow quads (pane + halo per lit window stamp).
  private windowGlows: Array<{
    obj: Phaser.GameObjects.GameObject & { setAlpha(a: number): unknown };
    max: number;
    /** Building this pane belongs to (occupied buildings glow by day). */
    landmark?: string;
    pane?: boolean;
  }> = [];

  // Conversation spotlight state
  private convoVignette?: Phaser.GameObjects.Image;
  private convoZoomBase?: number;
  private convoFailsafe?: Phaser.Time.TimerEvent;
  /** True while the spotlight camera has borrowed framing from the
   *  player-follow camera (restored on spotlight clear or player movement). */
  private convoFollowPaused = false;
  /** Focal point of the active NPC conversation, offered to the player as
   *  an edge chip ("Watch") instead of stealing the follow camera. */
  private pendingSpotlight: { x: number; y: number } | null = null;

  // Fixed-seed capture mode (?capture=1) — see the doc block at the top.
  private captureMode = false;
  private randomBeforeCapture?: typeof Math.random;
  private reducedMotionRequested = false;

  // ── Overview camera (no-player default: replay / demo / pre-onboarding) ──
  /** True while the composed town-overview camera owns framing. */
  private overviewMode = false;
  /** Init flag: whether to auto-enter overview when no player exists. */
  private overviewRequested = true;
  private overviewDriftTimer?: Phaser.Time.TimerEvent;
  private overviewResumeTimer?: Phaser.Time.TimerEvent;
  private overviewWaypoints: Array<{ x: number; y: number }> = [];
  private overviewLeg = 0;
  private overviewStep = 0;
  /** Wheel/pinch/double-click zoom override (0.25 snaps, 0.75-2.0). */
  private userZoom: number | null = null;
  /** Two-finger pinch bookkeeping. */
  private pinchStartDist: number | null = null;
  private pinchStartZoom = 1;

  // The built tilemap (kept for the window-glow scan).
  private builtMap?: Phaser.Tilemaps.Tilemap;
  /** Walkability grid + A* over the collision layer (rebuilt with the map). */
  private navGrid?: NavGrid;
  /** Installed on every body so walks route around buildings and water. */
  private readonly pathResolver = (
    from: Pt,
    to: Pt,
    opts?: { avoid?: Array<{ x: number; y: number; r: number }> },
  ): Pt[] | null => {
    const grid = this.navGrid;
    if (!grid) return null;
    const direct = grid.findPath(from, to, opts);
    if (direct) return this.recordPath(from, direct);
    // Walled off (or the goal sits in scenery): go as near as the grid
    // allows instead of sliding through the wall.
    const near = grid.nearestReachable(from, to);
    if (!near || Math.hypot(near.x - from.x, near.y - from.y) < 6) return null;
    const partial = grid.findPath(from, near, opts);
    return partial ? this.recordPath(from, partial) : null;
  };
  /** The last 50 routes handed to walkers (probes assert their shape). */
  private recentPaths: Array<{ from: Pt; path: Pt[] }> = [];
  private recordPath(from: Pt, path: Pt[]): Pt[] {
    this.recentPaths.push({ from: { x: from.x, y: from.y }, path: path.map((p) => ({ x: p.x, y: p.y })) });
    if (this.recentPaths.length > 50) this.recentPaths.shift();
    return path;
  }
  // Scenario towns do not have to ship a Tiled map. This procedural layer is
  // rebuilt from their authoritative landmark rectangles when no map exists.
  private fallbackWorld?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "TownScene" });
  }

  init(data: {
    scenarioId: string;
    townId: TownId;
    mapPath?: string;
    reducedMotion?: boolean;
    /** Start in the composed town-overview camera (default when no player). */
    overview?: boolean;
    /** Town population (scenario data) — scales ambient life. */
    population?: number;
    /** The scenario's first round clock (live towns open on it). */
    startClock?: { hour: number; minute: number };
  }) {
    this.scenarioId = data.scenarioId;
    this.townId = data.townId;
    this.mapPath = data.mapPath ?? null;
    this.population = Number.isFinite(data.population) ? Number(data.population) : 0;
    this.reducedMotionRequested = Boolean(data.reducedMotion);
    this.overviewRequested = data.overview ?? true;
    if (data.startClock) {
      this.worldClock = new WorldClock({
        startHour: data.startClock.hour,
        startMinute: data.startClock.minute,
        minutesPerSecond: 1,
      });
    }
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
    // Results night: the park brazier burns with the licensed campfire sheet.
    this.load.spritesheet("campfire", appUrl("assets/spritesheets/campfire.png"), { frameWidth: 32, frameHeight: 32 });

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

    // Pixel type for every in-world label (names, landmark chips, captions).
    ensurePixelFont(this);

    // Conversation choreography — closures give it the private helpers it
    // needs without widening the scene's public surface.
    this.choreo = new ConversationChoreographer({
      scene: this,
      getSprite: (id) => {
        const sp = this.agentSprites.get(id);
        return sp && sp !== this.playerSprite ? sp : undefined;
      },
      landmarkEntrance: (name) => this.landmarkPositions.get(this.resolveLandmarkName(name) ?? name),
      nearestWalkable: (pt) => this.navGrid?.nearestWalkable(pt.x, pt.y, 96, { avoidRoad: true }) ?? pt,
      findFreeNear: (x, y, opts) => this.findFreeNear(x, y, opts),
      gatherSlotFor: (key, cx, cy, sprite, opts) => this.formationSlot(key, cx, cy, sprite, opts),
      releaseGatherSlot: (id) => this.spots?.release(id, "chat"),
      returnToDwell: (id) => this.returnToDwell(id),
      chatPair: (ids, near, location) => {
        const landmark = this.meetingLandmark(ids, near, location);
        if (!landmark || !this.spots) return null;
        const [a, b] = this.spots.reserveChatPair(landmark, ids, near);
        return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      },
      chatCluster: (ids, near, location) => {
        const landmark = this.meetingLandmark(ids, near, location);
        if (!landmark || !this.spots) return null;
        return this.spots.reserveCluster(landmark, ids, near).map((p) => ({ x: p.x, y: p.y }));
      },
      stanceOf: (id) => this.agentOpinions.get(id) ?? "",
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.choreo.destroy());
    this.events.on("player-visit", (name: string) => this.playVisitSparks(name));

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

    // Wheel / pinch / double-click camera controls.
    this.installCameraControls();

    // No player at scene start (replay, demo, live before onboarding) →
    // open on the composed town overview with its slow set-piece drift.
    if (!this.playerSpawnPending && this.overviewRequested) {
      this.setOverviewMode(true);
    }

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
    // Passers-by dress against the roster, so they spawn once the residents
    // are in (syncReplayState) — or after a beat if no roster ever arrives.
    this.time.delayedCall(3000, () => this.ensureAmbientNPCs());

    // Town title banner
    this.buildTitleBanner(W);

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
      { population: this.population },
    );
    this.ambience.setHour(this.worldClock.hour);
    this.ambience.setPartOfDay(this.worldClock.partOfDay());

    // Civic dressing reads the same anchors; a late env (React applied it
    // before the map finished) is replayed silently.
    this.civic?.destroy();
    this.civic = new CivicLayer({
      scene: this,
      optionColor: (id) => this.opinionColor(id),
      landmarkEntrance: (name) => this.landmarkPositions.get(this.resolveLandmarkName(name) ?? name),
      nearestWalkable: (pt) => this.navGrid?.nearestWalkable(pt.x, pt.y, 96, { avoidRoad: true }) ?? pt,
    }, this.mapAnchors);
    this.civic.setPartOfDay(this.worldClock.partOfDay());
    if (this.lastCivic) this.civic.apply(this.lastCivic.env, this.lastCivic.residents, { animate: false });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.civic?.destroy(); this.civic = undefined; });

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
        delay: 20000,
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

    // Tap-to-walk on mobile (FIX 15): pointer-down on the scene walks the
    // player toward the tap point along the nav grid. Capped at 480 px.
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
      // Tapping a building walks to its door; open ground walks to the
      // nearest walkable spot. Either way the route respects walls, unlike
      // the old straight tween that let a tap pass through them.
      const hit = this.landmarks.find((l) =>
        l.type !== "road" && wx >= l.x && wx <= l.x + l.width && wy >= l.y && wy <= l.y + l.height);
      const dest = (hit ? this.landmarkPositions.get(hit.name) : undefined)
        ?? this.navGrid?.nearestWalkable(wx, wy, 64)
        ?? { x: wx, y: wy };
      if (Phaser.Math.Distance.Between(player.x, player.y, dest.x, dest.y) < 20) return;
      const from = { x: player.x, y: player.y };
      const path = this.navGrid?.findPath(from, dest) ?? [dest];
      player.walkPath(truncatePath(from, path, 480));
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
      this.maybeRunErrand(this.worldClock.hour * 60 + this.worldClock.minute);
      // SceneAmbience owns lamp glow + night tint; refresh at top of each hour.
      if (this.worldClock.hour !== prevHour) {
        this.ambience?.setHour(this.worldClock.hour);
        this.ambience?.setPartOfDay(this.worldClock.partOfDay());
        this.civic?.setPartOfDay(this.worldClock.partOfDay());
        this.refreshDayParts();
        this.refreshCommuterCount();
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
    this.choreo.update();
    this.syncLabelScale();

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
    this.walkTickAccum += delta;
    this.occupancyAccum += delta;
    if (this.walkTickAccum >= 100) {
      this.walkTickAccum = 0;
      this.crowdWalkersTick();
    }
    if (this.crowdTickAccum >= 200) {
      this.crowdTickAccum = 0;
      this.resolveBodyOverlaps();
      this.updateLabels();
    }
    if (this.occupancyAccum >= 1000) {
      this.occupancyAccum = 0;
      this.refreshOccupancy();
    }
  }

  /* ── Crowd hygiene: yielding, separation, label declutter ── */

  private crowdTickAccum = 0;
  private walkTickAccum = 0;
  private occupancyAccum = 0;

  /**
   * Walkers yield to each other (10 Hz): a body standing on the route is
   * detoured around; two walkers meeting head-on settle it by id hash —
   * the lower one pauses for a beat while the other passes. The player
   * never yields and only counts as an obstacle.
   */
  private crowdWalkersTick() {
    const now = this.time.now;
    const bodies = this.allBodies().filter((b) => b.active && !b.isIndoors());
    for (const w of bodies) {
      if (!w.isWalking() || w.isHeld()) continue;
      const v = w.getWalkVector();
      if (!v) continue;
      const avoid: Array<{ x: number; y: number; r: number }> = [];
      for (const o of bodies) {
        if (o === w) continue;
        const rx = o.x - w.x;
        const ry = o.y - w.y;
        const along = rx * v.x + ry * v.y;
        if (along < 4 || along > 40) continue;
        const across = Math.abs(rx * v.y - ry * v.x);
        if (across > 22) continue;
        const ov = o.isWalking() ? o.getWalkVector() : null;
        if (ov) {
          // Same way or crossing: nothing to do. Head-on: someone yields.
          if (ov.x * v.x + ov.y * v.y >= -0.5) continue;
          const yielder = w === this.playerSprite ? o
            : o === this.playerSprite ? w
              : fnv1a(w.agentId) < fnv1a(o.agentId) ? w : o;
          if (yielder !== this.playerSprite && !yielder.isHeld()) {
            yielder.holdWalk(300 + (fnv1a(yielder.agentId) % 300));
          }
          continue;
        }
        avoid.push({ x: o.x, y: o.y, r: 14 });
      }
      if (avoid.length > 0 && w !== this.playerSprite) w.detour(avoid, now);
    }
  }

  /**
   * Gently push apart bodies that overlap on the ground plane. Walk targets
   * are already occupancy-resolved; this catches the residual cases (two
   * tweens crossing, replay snapshots, physics shoves) with a few px of
   * drift per tick instead of a visible teleport.
   */
  private resolveBodyOverlaps() {
    const MIN_DIST = 30;
    const bodies = this.allBodies().filter((b) => b.active && !b.isIndoors());
    // Walkers land on reserved spots, the player owns their own ground, a
    // facing chat pair is deliberately close, and a body standing on an
    // authored spot (porch, bench, stool — 32 px apart by design) is where
    // it belongs — none of them get pushed.
    const onSpot = (s: AgentSprite) => Boolean(this.spots?.placementOf(s.agentId)?.spot);
    const pushable = (s: AgentSprite) =>
      s !== this.playerSprite && !s.isWalking() && s.getActivity() !== "talking" && !onSpot(s);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const pa = pushable(a);
        const pb = pushable(b);
        if (!pa && !pb) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        // Elliptical metric: y-sorted tall sprites tolerate more vertical
        // than horizontal closeness (the south body cleanly draws in front),
        // and it keeps the resolver from slowly dismantling gathering rings
        // whose north/south slots sit at dy≈24.
        const d = Math.hypot(dx, dy * 1.45);
        if (d >= MIN_DIST) continue;
        // Deterministic tie-break for perfectly stacked sprites.
        const nx = d > 0.01 ? dx / d : Math.cos(i * 2.39996);
        const ny = d > 0.01 ? dy / d : Math.sin(i * 2.39996);
        const push = Math.min(3, (MIN_DIST - d) * 0.5 + 0.5) * (pa && pb ? 0.5 : 1);
        if (pa) this.nudgeBody(a, nx * push, ny * push);
        if (pb) this.nudgeBody(b, -nx * push, -ny * push);
      }
    }
  }

  /** Apply a resolver nudge unless it would push a free-standing body INTO
   *  scenery; a body already inside a collision rect may always move (that
   *  is its escape hatch). */
  private nudgeBody(s: AgentSprite, dx: number, dy: number) {
    const tx = Phaser.Math.Clamp(s.x + dx, WORLD_MARGIN, WORLD_W - WORLD_MARGIN);
    const ty = Phaser.Math.Clamp(s.y + dy, WORLD_MARGIN, WORLD_H - WORLD_MARGIN);
    if (!this.isBlocked(tx, ty, 2) || this.isBlocked(s.x, s.y, 2)) s.nudgeTo(tx, ty);
  }

  /**
   * Label policy. A name shows for the speaker (a bubble up, or a line in
   * the last 4 s), the hovered or selected resident, and anyone within 80 px
   * of the player; then a greedy pass in that priority hides the loser
   * whenever two 56×26 label footprints would overlap, so a crowd never
   * becomes a wall of type. Landmark chips yield to residents standing on
   * them. `setLabelPolicy("all")` shows everyone (captures, debugging).
   */
  private updateLabels() {
    const now = this.time.now;
    const player = this.playerSprite;
    const residents = [...this.agentSprites.values()]
      .filter((s) => s !== this.playerSprite && s.active && !s.isIndoors());
    type Cand = { s: AgentSprite; pri: number };
    const wanted: Cand[] = [];
    for (const s of residents) {
      let pri = -1;
      if (this.labelPolicy === "all") pri = 0;
      if (player && Phaser.Math.Distance.Between(player.x, player.y, s.x, s.y) < 80) pri = Math.max(pri, 0);
      if (s.isHovered()) pri = Math.max(pri, 1);
      if (s.getSpeechBubbleCount() > 0 || now - s.getLastSpeechAt() < 4000) pri = Math.max(pri, 2);
      if (s.agentId === this.selectedAgentId) pri = 3;
      if (pri >= 0) wanted.push({ s, pri });
    }
    // Higher priority first; ties to the southern body (it draws in front).
    wanted.sort((a, b) => b.pri - a.pri || b.s.y - a.s.y);
    const kept: AgentSprite[] = [];
    const w = 56 * this.labelScale;
    const h = 26 * this.labelScale;
    const shown = new Set<string>();
    for (const { s } of wanted) {
      const clash = kept.some((k) => Math.abs(k.x - s.x) < w && Math.abs(k.y - s.y) < h);
      if (clash) continue;
      kept.push(s);
      shown.add(s.agentId);
    }
    for (const s of residents) s.setLabelVisible(shown.has(s.agentId));

    // Landmark labels yield to residents standing inside their bounds.
    for (const label of this.landmarkLabelTexts) {
      const lm = label.getData("lm") as LandmarkData | undefined;
      if (!lm) continue;
      let occupied = false;
      for (const s of residents) {
        if (s.x >= lm.x && s.x <= lm.x + lm.width && s.y >= lm.y && s.y <= lm.y + lm.height) {
          occupied = true;
          break;
        }
      }
      label.setVisible(!occupied);
    }
  }

  /** The UI's selected resident keeps their nameplate. */
  setSelectedAgent(agentId: string | null) {
    this.selectedAgentId = agentId;
  }

  /** "all" shows every nameplate (capture stills); "quiet" is the default. */
  setLabelPolicy(policy: "quiet" | "all") {
    this.labelPolicy = policy;
  }

  /* ── Placement: spots, formations, indoors ────────────────
   *
   * Residents stand on authored spots (Spots.ts) — the door apron, porch
   * steps, benches, patio stools, the platform edge, park lawn — chosen
   * deterministically per (resident, landmark) so a seek re-derives the
   * same town. A full landmark overflows into blue-noise points around its
   * apron; nobody ever shares a tile. Work, meals, prayer and rest happen
   * indoors: the body steps in at the door and the window carries the life.
   */

  /** Replay seats stay inside the recorded coordinate's neighbourhood
   *  (e2e asserts ±174/140 px of the recorded landmark corner). */
  private static readonly SEAT_ENVELOPE = { dx: 170, dy: 136 };

  /** Slot for a conversation formation (the choreographer's key is the
   *  conversation id): a reserved overflow point ≥30 px from every body. */
  private formationSlot(
    key: string,
    cx: number,
    cy: number,
    sprite: AgentSprite,
    _opts?: { skipCenter?: boolean },
  ): { x: number; y: number } {
    const reg = this.spots;
    if (!reg) return this.findFreeNear(cx, cy, { clearOf: 30, exclude: sprite });
    const existing = reg.placementOf(sprite.agentId, "chat");
    if (existing && existing.landmark === key) return { x: existing.x, y: existing.y };
    const pt = reg.sampleApron(key, sprite.agentId, { x: cx, y: cy }, { minDist: 30, box: 80 });
    reg.reserveAt(key, sprite.agentId, pt, "chat");
    return pt;
  }

  /** The routine stop a resident should be at for the scene clock, else
   *  their stated location, else their first routine stop. */
  private initialLocationFor(location: string, routine?: Routine): string | undefined {
    const resolved = (name?: string) => (name ? this.resolveLandmarkName(name) : undefined);
    const stop = resolved(routine?.currentEntryAt(this.worldClock.hour, this.worldClock.minute)?.location);
    const stated = resolved(location);
    const statedLm = stated ? this.landmarks.find((l) => l.name === stated) : undefined;
    // A road-type "location" (the wire's default street) is not a place to
    // stand; the routine knows better.
    if (stated && statedLm && statedLm.type !== "road" && !stop) return stated;
    return stop ?? stated ?? resolved(routine?.entries[0]?.location);
  }

  /**
   * Decide where a resident stands at `location` and what they do there:
   * the derived activity (work, a meal, prayer, rest — or idle), whether
   * that happens indoors, and the reserved spot. Recorded coordinates
   * (replay) only constrain which spot is chosen.
   */
  private seatResident(
    agentId: string,
    location: string | undefined,
    recorded: { x: number; y: number } | undefined,
    requested?: AgentActivity,
  ): { x: number; y: number; facing?: Direction; activity: AgentActivity; indoors: boolean; landmark: string } {
    const rec = this.agentRecords.get(agentId);
    const name = location ? (this.resolveLandmarkName(location) ?? location) : "";
    const landmark = this.landmarks.find((l) => l.name === name);
    const entry = rec?.routine?.currentEntryAt(this.worldClock.hour, this.worldClock.minute);
    const derived = deriveActivity(
      entry && entry.location === name ? entry : undefined,
      landmark,
      this.worldClock.partOfDay(),
      this.worldClock.fractionalHour(),
    );
    const activity: AgentActivity = requested && requested !== "idle" && requested !== "walking" && requested !== "talking"
      ? requested
      : derived;
    const wantsIndoors = shouldBeIndoors(
      landmark,
      activity,
      this.worldClock.fractionalHour(),
      entry && entry.location === name ? entry.activity : undefined,
    );
    if (rec) rec.location = name || undefined;
    const p = this.reserveDwell(agentId, name, landmark, activity, wantsIndoors, recorded);
    const indoors = wantsIndoors && p.spot?.role === "door";
    const facing = p.facing ?? arrivalFacing(landmark);
    return { x: p.x, y: p.y, facing, activity, indoors, landmark: name };
  }

  private reserveDwell(
    agentId: string,
    name: string,
    landmark: LandmarkData | undefined,
    activity: AgentActivity,
    indoors: boolean,
    recorded: { x: number; y: number } | undefined,
  ): Placement {
    const reg = this.spots;
    const grid = this.navGrid;
    const apron = this.landmarkPositions.get(name)
      ?? (recorded ? (grid?.nearestWalkable(recorded.x, recorded.y, 100, { avoidRoad: true }) ?? recorded) : undefined)
      ?? { x: 600, y: 400 };
    const envelope = recorded ? { near: recorded, envelope: TownScene.SEAT_ENVELOPE } : {};
    if (!reg) {
      const pt = this.findFreeNear(apron.x, apron.y, { clearOf: 30 });
      return { agentId, kind: "dwell", landmark: name, x: pt.x, y: pt.y, facing: undefined, spot: null, overflow: true };
    }
    if (indoors && reg.doorOf(name)) {
      const door = reg.reserve(name, agentId, ["door"], { shared: true, apron, ...envelope });
      if (door.spot) return door;
      reg.release(agentId, "dwell");
    }
    return reg.reserve(name, agentId, dwellRoles(landmark, activity), { apron, ...envelope });
  }

  /** Two warm pixel quads at a door as someone steps in or out. */
  private doorFlash(pt: { x: number; y: number }) {
    if (reducedMotion()) return;
    const quads = [-4, 4].map((dx) => this.add.image(pt.x + dx, pt.y - 14, "__WHITE")
      .setTint(0xffc873)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(6, 10)
      .setDepth(100 + pt.y + 1)
      .setAlpha(0.7));
    this.tweens.add({
      targets: quads,
      alpha: 0,
      duration: 240,
      ease: "Stepped",
      easeParams: [3],
      onComplete: () => quads.forEach((q) => q.destroy()),
    });
  }

  /**
   * Once a second: which buildings have someone inside — their window
   * panes stay warm by day and the landmark chip shows a pip per resident.
   */
  private refreshOccupancy() {
    const next = new Set<string>();
    const counts = new Map<string, number>();
    for (const rec of this.agentRecords.values()) {
      if (!rec.sprite.active || !rec.sprite.isIndoors() || !rec.location) continue;
      next.add(rec.location);
      counts.set(rec.location, (counts.get(rec.location) ?? 0) + 1);
    }
    let changed = next.size !== this.occupiedLandmarks.size;
    if (!changed) {
      for (const n of next) {
        if (!this.occupiedLandmarks.has(n)) { changed = true; break; }
      }
    }
    this.occupiedLandmarks = next;
    if (changed) this.refreshSkyOverlay();
    for (const chip of this.landmarkLabelTexts) {
      const lm = chip.getData("lm") as LandmarkData | undefined;
      if (lm) this.setChipPips(chip, counts.get(lm.name) ?? 0);
    }
  }

  /** Up to six 3×3 parchment pips under a chip — one per resident inside. */
  private setChipPips(chip: Phaser.GameObjects.Container, n: number) {
    const shown = Math.min(6, n);
    let pips = chip.getData("pips") as Phaser.GameObjects.Container | undefined;
    if (!pips) {
      if (shown === 0) return;
      pips = this.add.container(0, 0);
      chip.add(pips);
      chip.setData("pips", pips);
    }
    if ((chip.getData("pipCount") as number | undefined) === shown) return;
    chip.setData("pipCount", shown);
    pips.removeAll(true);
    // 5×5 parchment squares in a 1 px ink frame, 4 px apart, centred under
    // the plate — the same materials as the chip, readable at label scale 1.
    const h = chip.getData("h") as number;
    const pitch = 9;
    const total = shown * 7 + Math.max(0, shown - 1) * 2;
    const y = Math.round(h / 2 + 5);
    for (let i = 0; i < shown; i++) {
      const x = Math.round(-total / 2 + i * pitch + 3.5);
      pips.add(this.add.image(x, y, "__WHITE").setTint(0x1c1810).setAlpha(0.92).setDisplaySize(7, 7));
      pips.add(this.add.image(x, y, "__WHITE").setTint(0xf5ead2).setAlpha(0.96).setDisplaySize(5, 5));
    }
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

    const routine = agent.routine ? new Routine(agent.routine) : undefined;

    // Residents are seated by seatResident once their record exists (the
    // bootstrap, a replay sync, a move); the sprite is born on the apron of
    // the place they belong at so nothing flashes elsewhere first.
    const location = this.initialLocationFor(agent.location, routine);
    const base = (location ? this.landmarkPositions.get(location) : undefined)
      ?? [...this.landmarkPositions.values()][this.spawnCursor++ % Math.max(1, this.landmarkPositions.size)]
      ?? { x: 600, y: 400 };
    const sx = base.x;
    const sy = base.y;

    const custom = resolveAgentSprite(agent.id, this.scenarioId);

    const sprite = new AgentSprite(this, sx, sy, {
      id: agent.id,
      name: agent.name,
      initials: agent.initials ?? this.initials(agent.name),
      color: agent.color ?? townAccent(this.townId),
      town: agent.town,
      stance: this.stanceFor(agent.opinion?.candidate, agent.opinion?.confidence),
      occupation: agent.occupation,
      spriteKey: custom.spriteKey,
      customKey: custom.customKey,
      accessoryKey: custom.accessoryKey,
      tint: custom.tint,
      // Couples render as a REAL second body (own spritesheet) that trails
      // the lead with a delayed follow — see AgentSprite.updateCompanion.
      partner: custom.partner,
    });

    sprite.setPathResolver(this.pathResolver);
    this.agentSprites.set(agent.id, sprite);
    this.agentOpinions.set(agent.id, agent.opinion?.candidate ?? "");

    const record: AgentRecord = {
      sprite,
      routine,
      topConcerns: agent.top_concerns ?? [],
      idleThoughts: agent.idle_thoughts ?? undefined,
      relationships: agent.relationships ?? undefined,
    };
    record.location = location;
    this.agentRecords.set(agent.id, record);
    this.scheduleIdleBeat(agent.id);
  }

  /**
   * Live bootstrap (no replay events yet): add any resident missing from
   * the scene and seat them at their routine stop for the scene clock —
   * never re-posing residents already placed, never touching the clock.
   */
  bootstrapResidents(agents: Array<AgentState & { routine?: RoutineEntry[] }>) {
    let added = false;
    for (const agent of agents) {
      if (this.agentSprites.has(agent.id)) continue;
      this.addAgent(agent);
      const rec = this.agentRecords.get(agent.id);
      if (!rec) continue;
      const seat = this.seatResident(agent.id, rec.location, undefined);
      rec.sprite.syncReplayState(seat.x, seat.y, rec.sprite.getStance(), seat.activity, {
        decided: Boolean(agent.decided),
        indoors: seat.indoors,
      });
      if (seat.facing) rec.sprite.face(seat.facing);
      added = true;
    }
    if (added) this.ensureAmbientNPCs();
  }

  /** Reconcile the visible town to a reducer snapshot after a replay seek or
   *  a live-history gap. This updates durable state without replaying old
   *  speech, confetti, audio, or movement tweens. */
  syncReplayState(
    agents: AgentState[],
    positions: Record<string, { location: string; x?: number; y?: number }>,
    clock: { hour: number; minute: number } | null,
    weather: WeatherKind,
  ) {
    const wanted = new Set(agents.map((agent) => agent.id));
    this.resetProcession();
    for (const [id, sprite] of this.agentSprites) {
      if (sprite === this.playerSprite || wanted.has(id)) continue;
      sprite.destroy();
      this.agentSprites.delete(id);
      this.agentRecords.delete(id);
      this.agentOpinions.delete(id);
      this.spots?.release(id);
    }

    this.clearConversationSpotlight(true);
    this.choreo.clearAll();
    // The clock first: what people do where depends on the hour. A null
    // clock (live bootstrap) leaves the free-running clock alone.
    if (clock) this.setWorldTime(clock.hour, clock.minute, false);
    this.setWeather(weather);
    // Re-seat everyone from scratch in reducer order — the same feed always
    // yields the same spots (Spots.ts), so repeated seeks never reshuffle.
    this.spots?.clear();
    for (const agent of agents) {
      this.addAgent(agent);
      const sprite = this.agentSprites.get(agent.id);
      if (!sprite) continue;
      const recorded = positions[agent.id];
      const precise = Number.isFinite(recorded?.x) && Number.isFinite(recorded?.y);
      const location = recorded?.location ?? agent.location;
      const requested = agent.activity && agent.activity !== "walking" ? agent.activity : "idle";
      const seat = this.seatResident(
        agent.id,
        location,
        precise ? { x: recorded.x as number, y: recorded.y as number } : undefined,
        requested,
      );
      sprite.syncReplayState(
        seat.x,
        seat.y,
        this.stanceFor(agent.opinion?.candidate, agent.opinion?.confidence),
        seat.activity,
        { decided: Boolean(agent.decided), indoors: seat.indoors },
      );
      if (seat.facing) sprite.face(seat.facing);
      this.agentOpinions.set(agent.id, agent.opinion?.candidate ?? "");
    }
    if (agents.length > 0) this.ensureAmbientNPCs();
    this.refreshOccupancy();
  }

  moveAgent(agentId: string, toLocation: string, x?: number, y?: number) {
    const sprite = this.agentSprites.get(agentId);
    const rec = this.agentRecords.get(agentId);
    if (!sprite || !rec) return;
    const recorded = Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : undefined;
    // Leaving frees the old spot before the new one is chosen.
    this.spots?.release(agentId, "dwell");
    const seat = this.seatResident(agentId, toLocation, recorded);
    sprite.moveToPosition(seat.x, seat.y, () => {
      if (!sprite.active) return;
      if (this.choreo.inConversation(agentId) || sprite.getActivity() === "talking") return;
      if (seat.indoors) {
        if (seat.activity !== "idle") sprite.setActivity(seat.activity);
        this.doorFlash({ x: seat.x, y: seat.y });
        sprite.setIndoors(true);
        return;
      }
      this.applyDayPart(agentId, seat.landmark);
    }, { arriveFacing: seat.facing });
  }

  /** Activities the place + hour derive (as opposed to talking/walking). */
  private static readonly DERIVED_ACTIVITIES: ReadonlySet<AgentActivity> =
    new Set<AgentActivity>(["home", "sleeping", "eating", "working", "praying"]);

  /**
   * The clock moved (a round tick, a replay seek, the free-running hour):
   * residents in a derived pose re-read the place and the hour — nobody
   * keeps sleeping at the door at 12:30, and the diner fills at lunch.
   */
  private refreshDayParts() {
    for (const [id, rec] of this.agentRecords) {
      const sprite = rec.sprite;
      if (!sprite.active || sprite.isWalking() || !rec.location) continue;
      const current = sprite.getActivity();
      if (current !== "idle" && !TownScene.DERIVED_ACTIVITIES.has(current)) continue;
      if (this.choreo.inConversation(id)) continue;
      const landmark = this.landmarks.find((l) => l.name === rec.location);
      const entry = rec.routine?.currentEntryAt(this.worldClock.hour, this.worldClock.minute);
      const act = deriveActivity(
        entry && entry.location === rec.location ? entry : undefined,
        landmark,
        this.worldClock.partOfDay(),
        this.worldClock.fractionalHour(),
      );
      const indoors = shouldBeIndoors(
        landmark,
        act,
        this.worldClock.fractionalHour(),
        entry && entry.location === rec.location ? entry.activity : undefined,
      ) && Boolean(this.spots?.doorOf(rec.location));
      if (indoors !== sprite.isIndoors()) {
        // Step in for the night, or out for the day: through the door.
        this.moveAgent(id, rec.location);
        continue;
      }
      if (act !== current) sprite.setActivity(act);
    }
  }

  /**
   * Once a resident arrives somewhere, the place and the hour decide what
   * they do there — eat at the diner, work the shift, pray, rest at home —
   * unless they are mid-conversation.
   */
  private applyDayPart(agentId: string, location: string) {
    const rec = this.agentRecords.get(agentId);
    const sprite = rec?.sprite;
    if (!rec || !sprite || !sprite.active) return;
    if (sprite.getActivity() === "talking" || this.choreo.inConversation(agentId)) return;
    const landmark = this.landmarks.find((l) => l.name === location);
    const entry = rec.routine?.currentEntryAt(this.worldClock.hour, this.worldClock.minute);
    const act = deriveActivity(
      entry && entry.location === location ? entry : undefined,
      landmark,
      this.worldClock.partOfDay(),
      this.worldClock.fractionalHour(),
    );
    if (act !== "idle") sprite.setActivity(act);
  }

  showAgentSpeech(agentId: string, text: string, duration?: number, sentiment: BubbleSentiment = "neutral") {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    // Someone inside speaks from the doorway: the bubble hangs at the door
    // (the container stays there) and nobody steps onto a shared apron.
    // Choreography (speaker lean, listener nods) runs even when the bubble
    // itself is suppressed off-camera.
    this.choreo.onSpeech(agentId, sentiment);
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
    if (visible >= 2) {
      // Dialogue takes priority over stray remarks: evict a bubble from
      // someone outside any conversation instead of dropping the line.
      if (!this.choreo.inConversation(agentId)) return;
      const victim = [...this.agentSprites.values()].find((other) =>
        other !== sprite && other.getSpeechBubbleCount() > 0 && !this.choreo.inConversation(other.agentId));
      if (!victim) return;
      victim.clearSpeechBubbles();
    }
    // Lines spoken inside an active conversation get the spotlight variant —
    // larger type on a wider measure so the dialogue reads as the scene's
    // focal point rather than a stray tooltip.
    const emphasis = sprite.getActivity() === "talking";
    sprite.showSpeechBubble(text, duration, sentiment, emphasis);
  }

  /**
   * Apply an opinion event and return what it meant visually. A bare option
   * id (scripted captures) is a full flip; otherwise the previous opinion
   * decides between a silent update, a confidence tick, a first-stance
   * settle, or a flip with confetti.
   */
  updateAgentOpinion(
    agentId: string,
    next: string | { candidate: string; confidence?: number },
    prev?: { candidate: string; confidence?: number } | null,
  ): StanceChange {
    const nextOp = typeof next === "string" ? { candidate: next, confidence: 80 } : next;
    const nextStance = this.stanceFor(nextOp.candidate, nextOp.confidence);
    const prevStance = typeof next === "string"
      ? null
      : prev
        ? this.stanceFor(prev.candidate, prev.confidence)
        : (this.agentSprites.get(agentId)?.getStance() ?? null);
    const kind: StanceChange = typeof next === "string" ? "flip" : stanceChangeKind(prevStance, nextStance);
    this.agentOpinions.set(agentId, nextOp.candidate);
    this.agentSprites.get(agentId)?.setStance(nextStance, kind);
    return kind;
  }

  /** A resident's recorded reaction to a headline (town-filtered by the caller). */
  reactAgent(agentId: string, kind: EmotionalResponse, impact?: VoteImpact) {
    this.agentSprites.get(agentId)?.react(kind, impact);
  }

  /** Ballots cast: sticker + ballot drop, staggered so a crowd reads as a
   *  sequence of decisions rather than one flash. Residents already stamped
   *  (the polling-place procession) are left alone. */
  markDecided(agentIds: string[], mode: "silent" | "stamp" = "silent") {
    let i = 0;
    for (const id of agentIds) {
      const sprite = this.agentSprites.get(id);
      if (!sprite || sprite === this.playerSprite || sprite.isDecided()) continue;
      // A voter already on the way to the box stamps there, in order.
      if (mode === "stamp" && this.processionIds.has(id)) continue;
      const stance = sprite.getStance();
      if (mode === "silent" || reducedMotion()) {
        sprite.setDecided(stance.optionId, "silent");
        continue;
      }
      this.time.delayedCall(90 * i++, () => {
        if (sprite.active && !sprite.isDecided()) sprite.setDecided(sprite.getStance().optionId, "stamp");
      });
    }
  }

  /** Results are in: the winner's supporters celebrate, everyone else
   *  reflects; all settle back to idle after a few seconds. */
  celebrateResults(winnerId: string) {
    // The last ballots drop first; the results crowd forms right after.
    if (this.processionIds.size > 0 || this.boxBusy || this.pollQueue.length > 0) {
      this.pendingCelebration = winnerId;
      return;
    }
    this.pendingCelebration = null;
    // Supporters gather on the park lawn nearest the polls (the results
    // crowd), everyone else takes the news where they stand.
    const poll = this.civic?.getPollingPlace();
    const parks = this.landmarks.filter((l) => /park|green|commons|square|plaza/i.test(l.type));
    let lawn: string | undefined;
    if (poll && parks.length > 0) {
      lawn = parks
        .map((l) => ({ name: l.name, d: Math.hypot(l.x + l.width / 2 - poll.x, l.y + l.height / 2 - poll.y) }))
        .sort((a, b) => a.d - b.d)[0]?.name;
    }
    const gather = Boolean(lawn && this.spots && !reducedMotion());
    let i = 0;
    for (const sprite of this.agentSprites.values()) {
      if (sprite === this.playerSprite || !sprite.active) continue;
      const stance = sprite.getStance();
      if (this.choreo.inConversation(sprite.agentId)) continue;
      // Walkers (voters heading home from the box) are redirected, not skipped.
      if (sprite.isWalking() && !gather) continue;
      const supporter = !stance.undecided && stance.optionId === winnerId;
      const k = i++;
      this.time.delayedCall(80 * k, () => {
        if (!sprite.active) return;
        if (!supporter) {
          sprite.showEmote("reflecting");
          return;
        }
        if (!gather || !lawn) {
          sprite.setActivity("celebrating", true);
          return;
        }
        const seat = this.spots!.reserve(lawn, sprite.agentId, ["lawn", "bench", "table"], { kind: "chat" });
        sprite.moveToPosition(seat.x, seat.y, () => {
          if (!sprite.active) return;
          sprite.setActivity("celebrating", true);
          this.time.delayedCall(3200, () => {
            if (!sprite.active) return;
            if (sprite.getActivity() === "celebrating") sprite.setActivity("idle");
            this.spots?.release(sprite.agentId, "chat");
            this.returnToDwell(sprite.agentId);
          });
        }, { arriveFacing: "down" });
      });
    }
    if (!gather) {
      this.time.delayedCall(3200 + 80 * i, () => {
        for (const sprite of this.agentSprites.values()) {
          if (sprite.getActivity() === "celebrating") sprite.setActivity("idle");
        }
      });
    }
  }

  /* ── The election in the world ────────────────────────────────────── */

  /**
   * Dress the town for the current civic environment. Idempotent: a replay
   * seek passes `animate: false` and lands on the same state silently.
   */
  applyEnvironmentState(env: CivicEnv, agents: AgentState[], opts: { animate: boolean }) {
    const residents: CivicResident[] = agents
      .filter((a) => a.town === this.townId)
      .map((a) => {
        const stance = this.stanceFor(a.opinion?.candidate, a.opinion?.confidence);
        return {
          id: a.id,
          home: a.routine?.[0]?.location ?? a.location ?? "",
          optionId: stance.optionId,
          color: stance.color,
          undecided: stance.undecided,
        };
      });
    this.lastCivic = { env, residents };
    this.civic?.apply(env, residents, opts);
    // Passers-by pause at the notice board while the news is fresh.
    if (env.phase === "news") {
      const kiosk = this.mapAnchors.find((a) => a.kind === "noticeboard");
      this.commuterFocus = kiosk ? { x: kiosk.x, y: kiosk.y + 24 } : null;
    } else {
      this.commuterFocus = null;
    }
  }

  getCivicState() {
    return this.civic?.snapshot() ?? null;
  }


  /**
   * Decision day: residents walk to the polling place in `order`, wait at
   * the rope, step up to the ballot box one at a time, cast (voting pulse,
   * sticker, ballot), and step aside. Residents already stamped and anyone
   * mid-conversation are left where they are; a resident still undecided
   * casts too and wears a plain sticker.
   */
  startBallotProcession(order: string[]) {
    if (!this.civic?.isPollingOpen() || reducedMotion()) return;
    const box = this.civic.getBallotBoxPoint();
    const place = this.civic.getPollingPlace();
    if (!box) return;
    const voters = order
      .map((id) => this.agentSprites.get(id))
      .filter((sp): sp is AgentSprite => Boolean(sp) && sp !== this.playerSprite && sp!.active)
      .filter((sp) => !sp.isDecided() && !this.choreo.inConversation(sp.agentId));
    // Authored queue spots (head of the line first); the civic layer's rope
    // slots are the fallback for maps without them.
    const pollName = place?.name ? (this.resolveLandmarkName(place.name) ?? place.name) : "";
    const hasQueue = Boolean(pollName && this.spots && this.spots.spotsOf(pollName, "queue").length > 0);
    const fallback = hasQueue ? [] : this.civic.getBallotQueueSlots(voters.length);
    for (const sprite of voters) this.processionIds.add(sprite.agentId);
    voters.forEach((sprite, i) => {
      const slot = hasQueue
        ? this.spots!.reserve(pollName, sprite.agentId, ["queue"], { kind: "queue", apron: box })
        : (fallback[i] ?? box);
      this.time.delayedCall(450 * i, () => {
        if (!sprite.active) { this.leaveProcession(sprite.agentId); return; }
        sprite.moveToPosition(slot.x, slot.y, () => {
          if (!sprite.active) { this.leaveProcession(sprite.agentId); return; }
          this.pollQueue.push(sprite);
          this.pumpBallotBox(box);
        }, { arriveFacing: "up" });
      });
    });
  }

  /** A voter is done (or gone): once the last one is, the deferred results
   *  crowd forms. */
  private leaveProcession(agentId: string) {
    this.processionIds.delete(agentId);
    this.spots?.release(agentId, "queue");
    if (this.processionIds.size === 0 && !this.boxBusy && this.pollQueue.length === 0 && this.pendingCelebration) {
      const winner = this.pendingCelebration;
      this.pendingCelebration = null;
      this.time.delayedCall(600, () => this.celebrateResults(winner));
    }
  }

  private pumpBallotBox(box: { x: number; y: number }) {
    if (this.boxBusy) return;
    const sprite = this.pollQueue.shift();
    if (!sprite) return;
    if (!sprite.active) { this.leaveProcession(sprite.agentId); this.pumpBallotBox(box); return; }
    this.boxBusy = true;
    const done = () => {
      this.boxBusy = false;
      this.pumpBallotBox(box);
    };
    sprite.moveToPosition(box.x, box.y, () => {
      if (!sprite.active) { done(); return; }
      sprite.setActivity("voting");
      this.time.delayedCall(700, () => {
        if (!sprite.active) { done(); return; }
        sprite.setDecided(sprite.getStance().optionId, "stamp");
        this.time.delayedCall(260, () => {
          if (!sprite.active) { done(); return; }
          sprite.setActivity("idle");
          // The box frees as soon as the voter turns away; they go back to
          // wherever their day had them (their own porch, bench or job),
          // so the polling place never piles up.
          done();
          this.returnToDwell(sprite.agentId);
          this.leaveProcession(sprite.agentId);
        });
      });
    }, { arriveFacing: "up" });
  }

  /** Walk a resident back to the seat their day gives them right now. */
  private returnToDwell(agentId: string) {
    const rec = this.agentRecords.get(agentId);
    const sprite = rec?.sprite;
    if (!rec || !sprite || !sprite.active) return;
    const location = rec.location ?? this.initialLocationFor("", rec.routine);
    if (!location) return;
    this.moveAgent(agentId, location);
  }

  private resetProcession() {
    this.pollQueue = [];
    this.boxBusy = false;
    this.processionIds.clear();
    this.pendingCelebration = null;
  }

  showAgentEmote(agentId: string, type: "reflecting" | "opinion_changed") {
    this.agentSprites.get(agentId)?.showEmote(type);
  }

  playGesture(agentId: string, gesture: GestureKind) {
    this.agentSprites.get(agentId)?.playGesture(gesture);
  }

  /**
   * Backend conversation_started → the choreographer walks participants
   * into formation (a pair flanks the meeting point face-to-face, larger
   * groups ring it), names the topic on a parchment strip, and the scene
   * adds the spotlight (vignette + camera ease / edge chip).
   */
  handleConversationStarted(conversation: {
    id?: string;
    participants: string[];
    location?: string;
    topic?: string;
  }) {
    if (!conversation || !Array.isArray(conversation.participants)) return;
    const id = this.choreo.start({
      id: conversation.id,
      participants: conversation.participants,
      location: conversation.location,
      topic: conversation.topic,
    }, "backend");
    if (!id) return;
    const sprites = conversation.participants
      .map((pid) => this.agentSprites.get(pid))
      .filter((sp): sp is AgentSprite => !!sp && sp !== this.playerSprite);
    if (sprites.length >= 2) this.playConversationSpotlight(sprites[0], sprites[1]);
  }

  /** Backend conversation_ended → that conversation (only) disperses; the
   *  key takeaway lingers on a card between the participants for a beat. */
  handleConversationEnded(conversationId: string, summary?: string) {
    this.choreo.end(conversationId, { summary });
    if (!this.choreo.hasActive("backend")) this.clearConversationSpotlight();
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
      this.pauseOverviewDrift(15000);
      if (this.convoZoomBase === undefined) this.convoZoomBase = cam.zoom;
      cam.pan(midX, midY, 520, "Sine.easeInOut");
      cam.zoomTo(this.convoZoomBase * 1.09, 520, "Sine.easeInOut");
    } else {
      const p = this.playerSprite;
      const participant = a === p || b === p;
      if (!participant) {
        // Camera contract: with a player present the camera never leaves
        // them without an explicit ask. Offer the spotlight to React as an
        // edge chip ("… are talking · Watch") instead of stealing framing.
        this.pendingSpotlight = { x: midX, y: midY };
        this.events.emit("spotlight-offer", {
          aId: a.agentId,
          bId: b.agentId,
        });
      }
    }
  }

  /** Explicit user ask (edge-chip click): borrow the follow camera for the
   *  active NPC conversation. Any player movement hands it straight back
   *  (see update()); spotlight clear restores follow as before. */
  borrowConversationSpotlight() {
    const cam = this.cameras.main;
    const p = this.playerSprite;
    const target = this.pendingSpotlight;
    if (!cam || !p || !target) return;
    cam.stopFollow();
    this.convoFollowPaused = true;
    if (this.convoZoomBase === undefined) this.convoZoomBase = cam.zoom;
    if (reducedMotion()) {
      cam.centerOn(target.x, target.y);
    } else {
      cam.pan(target.x, target.y, 620, "Sine.easeInOut");
      cam.zoomTo(this.convoZoomBase * 1.12, 620, "Sine.easeInOut");
    }
  }

  private clearConversationSpotlight(immediate = false) {
    this.convoFailsafe?.remove(false);
    this.convoFailsafe = undefined;
    if (this.pendingSpotlight) {
      this.pendingSpotlight = null;
      this.events.emit("spotlight-clear");
    }
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
    this.ambience?.setPartOfDay(this.worldClock.partOfDay());
    this.civic?.setPartOfDay(this.worldClock.partOfDay());
    this.refreshDayParts();
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
            stanceTier: sprite.getStanceTier(),
            confidence: sprite.getStance().confidence,
            decided: sprite.isDecided(),
            mood: sprite.getMood(),
            indoors: sprite.isIndoors(),
            spot: this.spots?.placementOf(id)?.spot?.id ?? null,
          }]),
      ),
      conversationSpotlight: Boolean(this.convoVignette),
      civic: this.civic?.snapshot() ?? null,
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
      setOverviewMode: (on: boolean) => this.setOverviewMode(on),
      snapshot: () => this.getReplaySnapshot(),
      mapMode: () => this.builtMap ? "tilemap" as const : "procedural" as const,
      /** List agent ids present in this town (capture scripts pick pairs). */
      agents: () => [...this.agentSprites.entries()]
        .filter(([, sprite]) => sprite !== this.playerSprite)
        .map(([id]) => id),
      setLabelPolicy: (policy: "quiet" | "all") => this.setLabelPolicy(policy),
      /** Recent walker routes (probes assert axis-aligned legs, crossings). */
      lastPaths: () => this.recentPaths.map((r) => ({ from: r.from, path: r.path })),
      /** Crowd metrics for probes: walkers, indoor count, closest pair. */
      crowdStats: () => {
        const bodies = [...this.agentSprites.values()]
          .filter((s) => s !== this.playerSprite && s.active);
        const outdoors = bodies.filter((s) => !s.isIndoors());
        // Spacing is judged between standing bodies; walkers may cross.
        const standing = outdoors.filter((s) => !s.isWalking());
        let minPair = Infinity;
        let closest: [string, string] | null = null;
        for (let i = 0; i < standing.length; i++) {
          for (let j = i + 1; j < standing.length; j++) {
            const d = Math.hypot(standing[i].x - standing[j].x, standing[i].y - standing[j].y);
            if (d < minPair) { minPair = d; closest = [standing[i].agentId, standing[j].agentId]; }
          }
        }
        return {
          residents: bodies.length,
          walking: bodies.filter((s) => s.isWalking()).length,
          indoors: bodies.length - outdoors.length,
          held: bodies.filter((s) => s.isHeld()).length,
          minPairDistance: Number.isFinite(minPair) ? Math.round(minPair) : null,
          closestPair: closest,
          /** Residents standing on asphalt (crosswalks excluded). */
          onRoad: outdoors.filter((s) => !s.isWalking() && this.navGrid?.kindAt(s.x, s.y) === "road").map((s) => s.agentId),
          /** Walkers currently over asphalt that is not a crossing. */
          jaywalking: outdoors.filter((s) => s.isWalking() && this.navGrid?.kindAt(s.x, s.y) === "road").map((s) => s.agentId),
          positions: Object.fromEntries(bodies.map((s) => [s.agentId, { x: Math.round(s.x), y: Math.round(s.y), indoors: s.isIndoors() }])),
        };
      },
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
      // Convergers ring the dropped paper (centre slot stays free — the
      // paper occupies it) and face it when they arrive.
      const newsKey = `news:${Math.round(land.x)}:${Math.round(land.y)}`;
      let converged = 0;
      this.agentSprites.forEach((s) => {
        if (s === this.playerSprite || converged >= 4) return;
        const d = Phaser.Math.Distance.Between(s.x, s.y, land.x, land.y);
        if (d > 190 || d < 30) return;
        converged++;
        const t = this.formationSlot(newsKey, land.x, land.y + 4, s, { skipCenter: true });
        s.showEmote("surprise");
        if (motionOk) {
          this.time.delayedCall(220 + converged * 160, () =>
            s.moveToPosition(t.x, t.y, () => s.faceToward(land.x, land.y)));
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

    // Camera emphasis (existing beat) — spectator/replay only. With a
    // player present the camera never leaves them without an explicit ask
    // (camera contract); the paper drop + convergence still play on-map.
    if (motionOk && !this.playerSprite) {
      this.pauseOverviewDrift(8000);
      const baseZoom = cam.zoom;
      cam.pan(land.x, land.y, 350, "Sine.easeInOut");
      cam.zoomTo(baseZoom * 1.15, 300, "Sine.easeInOut");
      this.time.delayedCall(900, () => {
        cam.pan(baseCenter.x, baseCenter.y, 400, "Sine.easeInOut");
        cam.zoomTo(baseZoom, 400, "Sine.easeInOut");
      });
    }
  }

  playOpinionShiftBeat(agentId: string) {
    const cam = this.cameras.main;
    const sprite = this.agentSprites.get(agentId);
    // Camera contract: never abandon a present player for a beat pan. The
    // ring morph + emote still mark the shift on the resident themselves.
    if (!cam || !sprite || reducedMotion() || this.playerSprite) return;
    this.pauseOverviewDrift(8000);
    const z = cam.zoom;
    const baseCenter = { x: cam.midPoint.x, y: cam.midPoint.y };
    cam.pan(sprite.x, sprite.y, 280, "Sine.easeInOut");
    cam.zoomTo(z * 1.2, 240, "Sine.easeInOut");
    this.time.delayedCall(600, () => {
      cam.zoomTo(z, 380, "Sine.easeInOut");
      cam.pan(baseCenter.x, baseCenter.y, 380, "Sine.easeInOut");
    });
  }

  playSimEndBeat() {
    const cam = this.cameras.main;
    // Zoom-out flourish is a spectator/replay beat; a player keeps framing.
    if (!cam || reducedMotion() || this.playerSprite) return;
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

  /**
   * Project a world point to CSS pixels inside the canvas box, for DOM
   * overlays. Phaser draws in device pixels (the backing store is the canvas
   * CSS size × RENDER_DPR — see config.ts), so the camera projection is
   * divided back down; Phaser's own pointer input needs no such step.
   */
  screenFromWorld(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    if (!cam) return { x, y };
    // Scroll + zoom about the viewport centre — what preRender folds into
    // the camera matrix — rather than `worldView`, which only refreshes on
    // the next frame and would lag a setZoom/centerOn made this tick.
    const z = cam.zoom;
    return {
      x: ((x - cam.scrollX) * z + (cam.width / 2) * (1 - z)) / RENDER_DPR,
      y: ((y - cam.scrollY) * z + (cam.height / 2) * (1 - z)) / RENDER_DPR,
    };
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
    this.choreo.clearAll();
    this.agentSprites.forEach((s) => s.destroy());
    this.agentSprites.clear();
    this.agentRecords.clear();
    this.agentOpinions.clear();
    this.spots?.clear();
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
    this.playerSprite.setPathResolver(this.pathResolver);
    // Automated product captures need stable composition; pausing player
    // input also prevents proximity dwell from opening a random chat panel.
    if (this.captureMode) this.playerSprite.inputEnabled = false;

    // Register in agentSprites so depth sorting includes the player
    this.agentSprites.set(profile.agentId, this.playerSprite);

    // The player always wins the camera: leave the overview drift and hand
    // framing to the follow camera.
    this.setOverviewMode(false);

    // Camera follow with smooth lerp + closer zoom while a player is present.
    this.cameras.main.startFollow(this.playerSprite, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, Number(this.game.config.width), Number(this.game.config.height));
    this.cameras.main.zoomTo(this.playerFollowZoom(), 600, "Sine.easeInOut");

    this.events.emit("player-spawned");
  }

  /**
   * Follow-camera zoom scaled to the canvas, in device space (`scale.width`
   * is backing-store pixels, so width/520 already carries RENDER_DPR). The
   * old fixed 1.5 framed ~260 world-px on a 390-px phone — a wall of grass
   * with one giant sprite. Wider canvases keep the intimate 1.5 (CSS);
   * phones pull back to show the town. Snapped crisp so sprites never
   * shimmer under the follow camera.
   */
  private playerFollowZoom(): number {
    // A wheel/pinch override wins; otherwise scale with the canvas.
    return this.userZoom ?? this.snapZoomCrisp(
      Phaser.Math.Clamp(this.scale.width / 520, 0.75 * RENDER_DPR, 1.5 * RENDER_DPR));
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

  /** Nearest non-road landmark whose door is within `radius` px. */
  getNearbyLandmark(
    px: number,
    py: number,
    radius = 56,
  ): { name: string; type: string; x: number; y: number } | null {
    let best: { name: string; type: string; x: number; y: number } | null = null;
    let bestD = radius;
    for (const lm of this.landmarks) {
      if (lm.type === "road") continue;
      const door = this.landmarkPositions.get(lm.name);
      if (!door) continue;
      const d = Phaser.Math.Distance.Between(px, py, door.x, door.y);
      if (d < bestD) {
        bestD = d;
        best = { name: lm.name, type: lm.type, x: door.x, y: door.y };
      }
    }
    return best;
  }

  /** The player's proximity check publishes its target here so the DOM talk
   *  card and the E key always agree on who is "nearby". */
  setProximityAgent(agentId: string | null) {
    this.proximityAgentId = agentId;
  }

  getProximityAgentId(): string | null {
    return this.proximityAgentId;
  }

  /** Residents inside a landmark's rectangle or within 72 px of its door. */
  getResidentsAtLandmark(name: string): string[] {
    const lm = this.landmarks.find((l) => l.name === name);
    const door = this.landmarkPositions.get(name);
    const seated = new Set(this.spots?.agentsAt(name) ?? []);
    const out: string[] = [];
    for (const [id, sp] of this.agentSprites) {
      if (sp === this.playerSprite || !sp.active) continue;
      const inside = !!lm && sp.x >= lm.x && sp.x <= lm.x + lm.width && sp.y >= lm.y && sp.y <= lm.y + lm.height;
      const near = !!door && Phaser.Math.Distance.Between(sp.x, sp.y, door.x, door.y) <= 72;
      if (inside || near || seated.has(id)) out.push(id);
    }
    return out;
  }

  /** Two pixel sparks at the door when the player visits a place. */
  private playVisitSparks(name: string) {
    const door = this.landmarkPositions.get(name);
    if (!door || reducedMotion()) return;
    const key = ensureSquareTexture(this);
    for (const dx of [-6, 6]) {
      const spark = this.add.image(door.x + dx, door.y - 22, key).setTint(0xffe6a8).setDepth(520);
      this.tweens.add({
        targets: spark,
        y: door.y - 36,
        alpha: 0,
        duration: 340,
        ease: "Stepped",
        easeParams: [4],
        onComplete: () => spark.destroy(),
      });
    }
  }

  /** Set player input enabled/disabled (e.g., when chat panel is open). */
  setPlayerInputEnabled(enabled: boolean) {
    if (this.playerSprite) {
      this.playerSprite.inputEnabled = enabled;
    }
  }

  /**
   * requestChat's spatial half — the ONE sanctioned camera move besides
   * player-follow. A remote talk request (sidebar card, canvas click from
   * afar, activity row) walks the player up to the resident (follow camera
   * carries the view) or, with no player, pans the spectator camera to
   * them. `onReady` fires when the approach lands so the chat panel opens
   * on arrival instead of teleporting open across the map.
   * Returns false when the resident has no sprite in this town.
   */
  approachAgent(agentId: string, onReady?: () => void): boolean {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite || sprite === this.playerSprite) return false;

    // Visible destination: the same glow ring the walk-up proximity uses.
    sprite.setProximityHighlight(true);
    this.time.delayedCall(2600, () => {
      if (sprite.active) sprite.setProximityHighlight(false);
    });

    const cam = this.cameras.main;
    const p = this.playerSprite;
    if (p) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, sprite.x, sprite.y);
      if (d <= 64) {
        p.faceToward(sprite.x, sprite.y);
        sprite.respondToInteractRequest(p.x, p.y);
        onReady?.();
        return true;
      }
      const side = p.x < sprite.x ? -34 : 34;
      const spot = this.findFreeNear(sprite.x + side, sprite.y + 8, {
        clearOf: 20,
        exclude: p,
      });
      p.moveToPosition(spot.x, spot.y, () => {
        p.faceToward(sprite.x, sprite.y);
        sprite.respondToInteractRequest(p.x, p.y);
        onReady?.();
      });
      return true;
    }

    // Spectator: reuse the mini-map pin pan.
    this.pauseOverviewDrift(12000);
    if (cam) {
      if (reducedMotion()) {
        cam.centerOn(sprite.x, sprite.y);
        onReady?.();
        return true;
      }
      cam.pan(sprite.x, sprite.y, 650, "Sine.easeInOut");
    }
    this.time.delayedCall(660, () => onReady?.());
    return true;
  }

  /* ── Routines ─────────────────────────────────────────── */

  private tickRoutines() {
    if (this.agentRecords.size === 0) return;
    const nowMin = this.worldClock.hour * 60 + this.worldClock.minute;
    for (const [id, rec] of this.agentRecords) {
      if (!rec.routine) continue;
      const entry = rec.routine.currentEntryAt(this.worldClock.hour, this.worldClock.minute);
      if (!entry) continue;
      if (rec.lastRoutineTime === entry.time) continue;
      // Mid-conversation residents finish talking first; the slot fires on
      // the next minute tick once they are free.
      if (this.choreo.inConversation(id)) continue;
      // Departure jitter: a stop fires 0–8 sim minutes after its hour, per
      // resident, so a 07:00 exodus spreads out instead of marching.
      const entryMin = Routine.timeToMinutes(entry.time);
      const jitter = fnv1a(`${id}|${entry.time}`) % 9;
      if (entryMin <= nowMin && nowMin < entryMin + jitter) continue;
      // Consume the slot only once the location resolves: a persona whose
      // routine named a landmark the map spells differently used to lose
      // that stop forever.
      const location = this.resolveLandmarkName(entry.location);
      if (!location) continue;
      rec.lastRoutineTime = entry.time;
      rec.arrivedAtMin = nowMin;
      this.moveAgent(id, location);
    }
  }

  /* ── Idle life ────────────────────────────────────────────
   *
   * Between stops a resident is not a statue: every 6–14 s they look
   * around, take a small step, or (live towns only) think out loud from
   * their persona's idle thoughts; now and then someone runs an errand to
   * a window or a bench nearby and comes back. All of it is quiet and
   * local — never a walk across town, never a pile.
   */

  private scheduleIdleBeat(agentId: string) {
    const rec = this.agentRecords.get(agentId);
    if (!rec) return;
    rec.idleTimer?.remove(false);
    const delay = 6000 + Math.floor(Math.random() * 8000);
    rec.idleTimer = this.time.delayedCall(delay, () => this.idleBeat(agentId));
  }

  private idleBeat(agentId: string) {
    const rec = this.agentRecords.get(agentId);
    const sprite = rec?.sprite;
    if (!rec || !sprite || !sprite.active) return;
    this.scheduleIdleBeat(agentId);
    if (sprite.isWalking() || sprite.isIndoors() || this.choreo.inConversation(agentId)) return;
    const act = sprite.getActivity();
    if (act !== "idle" && act !== "eating" && act !== "working") return;
    if (reducedMotion()) return;
    const roll = Math.random();
    const placement = this.spots?.placementOf(agentId);
    if (roll < 0.6) {
      // Look around, then settle back to the spot's facing.
      const dirs: Direction[] = ["up", "right", "down", "left"];
      const cur = dirs.indexOf(sprite.currentDirection);
      const turn = (cur + (Math.random() < 0.5 ? 1 : 3)) % 4;
      sprite.face(dirs[turn]);
      this.time.delayedCall(1200, () => {
        if (!sprite.active || sprite.isWalking() || this.choreo.inConversation(agentId)) return;
        sprite.face(placement?.facing ?? dirs[cur]);
      });
      return;
    }
    if (roll < 0.75 && !DEMO_MODE && placement) {
      // A small step along the free axis, and back on the next beat.
      const dirs: Array<[number, number]> = [[16, 0], [-16, 0], [0, 14], [0, -14]];
      const step = dirs[Math.floor(Math.random() * dirs.length)];
      const tx = sprite.x + step[0];
      const ty = sprite.y + step[1];
      if (this.isBlocked(tx, ty, 4) || (this.navGrid?.isRoad(tx, ty) ?? false) || this.isOccupied(tx, ty, 24, sprite)) return;
      sprite.moveToPosition(tx, ty, () => {
        this.time.delayedCall(3000 + Math.random() * 3000, () => {
          if (!sprite.active || sprite.isWalking() || this.choreo.inConversation(agentId)) return;
          sprite.moveToPosition(placement.x, placement.y, undefined, { arriveFacing: placement.facing });
        });
      });
      return;
    }
    if (roll < 0.9 && !DEMO_MODE) {
      // An idle thought — one at a time in town, on camera, never late.
      const now = this.time.now;
      const hour = this.worldClock.fractionalHour();
      if (now < this.idleBubbleUntil || hour >= 22 || hour < 6.5) return;
      const view = this.cameras.main.worldView;
      if (!view.contains(sprite.x, sprite.y)) return;
      const bank = rec.idleThoughts && rec.idleThoughts.length > 0 ? rec.idleThoughts : IDLE_THOUGHTS;
      const thought = bank[Math.floor(Math.random() * bank.length)];
      this.idleBubbleUntil = now + 3200 + 4000;
      sprite.showSpeechBubble(thought, 3200);
    }
  }

  /** Errands: a resident parked at one stop for 90+ sim minutes may walk
   *  to a window, bench or stall within 260 px and come back (one per town). */
  private maybeRunErrand(nowMin: number) {
    if (DEMO_MODE || this.errandInFlight > 0 || !this.spots) return;
    for (const [id, rec] of this.agentRecords) {
      const sprite = rec.sprite;
      if (!sprite.active || sprite.isWalking() || sprite.isIndoors() || sprite.getActivity() !== "idle") continue;
      if (this.choreo.inConversation(id) || rec.arrivedAtMin === undefined || nowMin - rec.arrivedAtMin < 90) continue;
      if (Math.random() > 1 / 120) continue;
      const near = this.landmarks
        .filter((l) => l.name !== rec.location && l.type !== "road")
        .map((l) => ({ name: l.name, pos: this.landmarkPositions.get(l.name) }))
        .filter((l): l is { name: string; pos: { x: number; y: number } } => Boolean(l.pos))
        .filter((l) => Math.hypot(l.pos.x - sprite.x, l.pos.y - sprite.y) <= 260)
        .filter((l) => this.spots!.spotsOf(l.name).some((sp) => sp.role === "window" || sp.role === "bench" || sp.role === "stall"));
      if (near.length === 0) continue;
      const pick = near[Math.floor(Math.random() * near.length)];
      const seat = this.spots.reserve(pick.name, id, ["window", "bench", "stall"], { kind: "chat" });
      this.errandInFlight++;
      rec.errandUntil = this.time.now + 8000 + Math.random() * 12000;
      sprite.moveToPosition(seat.x, seat.y, () => {
        this.time.delayedCall(Math.max(0, (rec.errandUntil ?? 0) - this.time.now), () => {
          this.errandInFlight = Math.max(0, this.errandInFlight - 1);
          rec.errandUntil = undefined;
          this.spots?.release(id, "chat");
          if (!sprite.active || this.choreo.inConversation(id)) return;
          this.returnToDwell(id);
        });
      }, { arriveFacing: seat.facing });
      return;
    }
  }


  /* ── Encounter conversations ───────────────────────────── */

  /**
   * Live towns only: every 16 s two residents standing near each other may
   * strike up a short exchange. Backend conversations always win — an
   * encounter never starts while one is active and is cut off cleanly if
   * one begins. Pairs sharing a concern (or a persona relationship) are
   * preferred so the banter comes from who they are.
   */
  private tryEncounterConversation() {
    if (this.choreo.hasActive("backend")) return;
    const now = this.time.now;
    if (now - this.lastEncounterTownAt < 30000) return;
    // Only neighbours sharing a place strike up a chat: outdoors, idle or
    // eating, and not fresh from another exchange.
    const free = [...this.agentSprites.entries()].filter(([id, sp]) => {
      if (sp === this.playerSprite || !sp.active || sp.isWalking() || sp.isIndoors()) return false;
      if (this.choreo.inConversation(id)) return false;
      const act = sp.getActivity();
      if (act !== "idle" && act !== "eating") return false;
      const rec = this.agentRecords.get(id);
      return Boolean(rec?.location) && (!rec?.lastEncounterAt || now - rec.lastEncounterAt > 60000);
    });
    if (free.length < 2) return;
    Phaser.Utils.Array.Shuffle(free);
    let pick: { a: AgentSprite; b: AgentSprite; concern?: string; relationship?: string } | null = null;
    for (let i = 0; i < free.length && !(pick?.concern || pick?.relationship); i++) {
      for (let j = i + 1; j < free.length; j++) {
        const [aId, a] = free[i];
        const [bId, b] = free[j];
        const recA = this.agentRecords.get(aId);
        const recB = this.agentRecords.get(bId);
        if (!recA?.location || recA.location !== recB?.location) continue;
        const concern = sharedConcernKey(recA.topConcerns, recB.topConcerns);
        const relationship = relationshipKind(recA.relationships?.[bId] ?? recB.relationships?.[aId]);
        const candidate = { a, b, concern, relationship };
        if (concern || relationship) { pick = candidate; break; }
        pick ??= candidate;
      }
    }
    if (pick) {
      this.lastEncounterTownAt = now;
      this.runEncounter(pick);
    }
  }

  private runEncounter(e: { a: AgentSprite; b: AgentSprite; concern?: string; relationship?: string }) {
    const { a, b } = e;
    const id = this.choreo.start({ participants: [a.agentId, b.agentId] }, "encounter");
    if (!id) return;
    const now = this.time.now;
    for (const sp of [a, b]) {
      const rec = this.agentRecords.get(sp.agentId);
      if (rec) rec.lastEncounterAt = now;
    }
    const exchange = pickExchange(e.concern, e.relationship);
    const say = (sp: AgentSprite, line: string) => {
      if (this.choreo.conversationOf(sp.agentId) !== id) return;
      const visible = [...this.agentSprites.values()]
        .reduce((total, other) => total + other.getSpeechBubbleCount(), 0);
      if (visible < 2) sp.showSpeechBubble(line, 2600, "neutral", true);
      this.choreo.onSpeech(sp.agentId, "neutral");
    };
    this.time.delayedCall(700, () => say(a, exchange.a));
    this.time.delayedCall(2300, () => say(b, exchange.b));
    this.time.delayedCall(5200, () => {
      if (this.choreo.conversationOf(a.agentId) === id) this.choreo.end(id);
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

  private ambientSpawned = false;

  /* ── Commuters (passers-by) ───────────────────────────────
   *
   * Strangers cross the town the way strangers do: in at a sidewalk edge,
   * along the pavement to the platform (or the notice board while the
   * news is fresh), a short wait, and out at another edge. A few by day,
   * hardly anyone late at night — and never loitering at someone's door.
   */

  private ensureAmbientNPCs() {
    if (!this.scene.isActive()) return;
    this.ambientSpawned = true;
    this.refreshCommuterCount();
  }

  /** How many passers-by the hour and the population call for. */
  private commuterTarget(): number {
    const hour = this.worldClock.fractionalHour();
    if (isRestingHour(hour)) return this.population > 20000 ? 1 : 0;
    return Phaser.Math.Clamp(1 + Math.floor(this.population / 12000), 1, 5);
  }

  private refreshCommuterCount() {
    if (!this.ambientSpawned || !this.scene.isActive()) return;
    const want = this.commuterTarget();
    const live = this.ambientNPCs.filter((n) => n.active && !n.getData("retire"));
    for (let i = live.length; i < want; i++) this.spawnCommuter();
    for (let i = want; i < live.length; i++) live[i].setData("retire", true);
  }

  /** Sidewalk points on the map edge (clustered), else any open edge ground. */
  private portalPoints(): Array<{ x: number; y: number }> {
    if (this.portals.length > 0) return this.portals;
    const grid = this.navGrid;
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    const found: Array<{ x: number; y: number }> = [];
    const consider = (x: number, y: number, kind: "sidewalk" | "any") => {
      if (!grid?.isWalkable(x, y)) return;
      const k = grid.kindAt(x, y);
      if (kind === "sidewalk" ? k !== "sidewalk" : k === "road" || k === "crosswalk") return;
      if (found.some((p) => Math.hypot(p.x - x, p.y - y) < 24)) return;
      found.push({ x, y });
    };
    for (const kind of ["sidewalk", "any"] as const) {
      for (let x = WORLD_MARGIN + 4; x <= W - WORLD_MARGIN - 4; x += 8) {
        consider(x, WORLD_MARGIN + 4, kind);
        consider(x, H - WORLD_MARGIN - 4, kind);
      }
      for (let y = WORLD_MARGIN + 4; y <= H - WORLD_MARGIN - 4; y += 8) {
        consider(WORLD_MARGIN + 4, y, kind);
        consider(W - WORLD_MARGIN - 4, y, kind);
      }
      if (found.length >= 2) break;
    }
    this.portals = found;
    return found;
  }

  private spawnCommuter() {
    const portals = this.portalPoints();
    if (portals.length === 0) return;
    const residents = [...this.agentSprites.keys()].filter((id) => id !== this.playerSprite?.agentId);
    const pool = passerbyPool(this.scenarioId, residents).filter((k) => this.textures.exists(k));
    if (pool.length === 0) return;
    const rng = mulberry32(0x5eed ^ [...this.townId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) ^ this.commuterSerial);
    const key = pool[Math.floor(rng() * pool.length)];
    const i = this.commuterSerial++;
    const start = portals[Math.floor(Math.random() * portals.length)];
    const npc = new AgentSprite(this, start.x, start.y, {
      id: `ambient-${i}-${key.slice(5)}`,
      name: "passerby",
      initials: "",
      color: "#aaa",
      town: this.townId,
      spriteKey: key,
      ambient: true,
    });
    npc.setPathResolver(this.pathResolver);
    this.ambientNPCs.push(npc);
    this.commuterLeg(npc, start);
  }

  /** Fade in at a portal, cross to the platform (via the notice board in
   *  the news phase), pause, leave by another portal, fade out, repeat. */
  private commuterLeg(npc: AgentSprite, from: { x: number; y: number }) {
    if (!npc.active) return;
    const portals = this.portalPoints();
    const others = portals.filter((p) => Math.hypot(p.x - from.x, p.y - from.y) > 120);
    const exit = others[Math.floor(Math.random() * others.length)] ?? portals[0] ?? from;
    const fadeIn = () => {
      npc.setPosition(from.x, from.y);
      npc.setVisible(true);
      if (reducedMotion()) { npc.setAlpha(1); return; }
      npc.setAlpha(0);
      this.tweens.add({ targets: npc, alpha: 1, duration: 200, ease: "Stepped", easeParams: [3] });
    };
    const leave = () => {
      npc.moveToPosition(exit.x, exit.y, () => {
        const finish = () => {
          npc.setVisible(false);
          npc.setAlpha(1);
          if (npc.getData("retire")) {
            npc.destroy();
            this.ambientNPCs = this.ambientNPCs.filter((n) => n !== npc);
            return;
          }
          const again = portals[Math.floor(Math.random() * portals.length)] ?? exit;
          this.time.delayedCall(6000 + Math.random() * 14000, () => this.commuterLeg(npc, again));
        };
        if (reducedMotion()) { finish(); return; }
        this.tweens.add({ targets: npc, alpha: 0, duration: 200, ease: "Stepped", easeParams: [3], onComplete: finish });
      });
    };
    const pause = (at: { x: number; y: number; facing?: Direction }, ms: number, then: () => void) => {
      npc.moveToPosition(at.x, at.y, () => {
        this.time.delayedCall(ms, then);
      }, { arriveFacing: at.facing });
    };
    fadeIn();
    // The platform is the natural pause; the notice board during the news.
    const platform = this.spots
      ? this.landmarks
        .filter((l) => this.spots!.spotsOf(l.name, "platform").length > 0)
        .map((l) => this.spots!.reserve(l.name, npc.agentId, ["platform"], { kind: "dwell", apron: this.landmarkPositions.get(l.name) }))[0]
      : undefined;
    const done = () => {
      this.spots?.release(npc.agentId);
      leave();
    };
    const toPlatform = () => {
      if (platform && !platform.overflow) {
        pause(platform, 2000 + Math.random() * 3000, done);
      } else {
        this.spots?.release(npc.agentId);
        leave();
      }
    };
    if (this.commuterFocus) pause(this.commuterFocus, 4000, toPlatform);
    else toPlatform();
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
      this.mapAnchors.push({ kind, x, y, stamp: props.stamp, name: o.name || undefined, props });
    }

    this.builtMap = map;
    this.buildNavGrid();
    this.buildSpotRegistry();
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
          resolution: RENDER_DPR,
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
    this.buildNavGrid();
    this.buildSpotRegistry();
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
          const owner = this.landmarks.find((l) =>
            x >= l.x && x < l.x + l.width && y >= l.y && y < l.y + l.height)?.name;
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
            this.windowGlows.push({ obj: pane, max: paneMax, landmark: owner, pane: true });
          }
          // Soft spill halo around it.
          const halo = this.add.image(x + wpx / 2, y + hpx / 2, glowKey)
            .setDisplaySize(wpx * 3.4, hpx * 3.4)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(6001)
            .setAlpha(0);
          this.windowGlows.push({ obj: halo, max: haloMax, landmark: owner, pane: false });
        });
      }
    };
    place(windowGids.windows, 0.38, 0.34);
    this.refreshSkyOverlay();
  }

  /**
   * Keep the camera covering the 1200x800 map. With a player, the follow
   * camera owns framing (bounds clamp it). With no player, the composed
   * overview owns framing (see setOverviewMode); if overview was explicitly
   * disabled we fall back to the old fill-the-viewport zoom.
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
    if (this.overviewMode) {
      this.applyOverviewBase(true);
      return;
    }
    // scale.width/height are backing-store pixels, so this fill zoom is in
    // device space already; snap it crisp without uncovering parchment.
    const fill = Math.max(this.scale.width / W, this.scale.height / H);
    const zoom = this.userZoom ?? this.snapZoomCrisp(fill, "ceil");
    cam.setZoom(zoom);
    cam.centerOn(W / 2, H / 2);
  }

  /* ── Overview camera — the no-player default framing ────── */

  /**
   * Composed base zoom for the overview, in device space (`scale.width` and
   * `scale.height` are backing-store pixels — see RENDER_DPR), snapped
   * crisp. Wide canvases fit the full map with a parchment margin;
   * tall/narrow canvases (phones) would render the town as a thumbnail
   * strip at true fit, so they use the fill zoom instead and rely on the
   * drift to tour the map.
   */
  private overviewBaseZoom(): number {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    const fit = Math.min(this.scale.width / W, this.scale.height / H);
    const fill = Math.max(this.scale.width / W, this.scale.height / H);
    if (fit * 0.98 >= fill * 0.62) {
      // The full-town shot must not crop the map: the largest crisp zoom at
      // or under true fit (a ~1% overshoot only trims the map's own border
      // tiles); the margin comes for free. This framing is only ever held
      // still (the drift glides at the anchor zoom and eases out here), so
      // when the half-step grid would shrink the town past 80% of fit — a
      // 1x display whose canvas is smaller than the map — a quarter step
      // keeps the composition instead: no motion, so nothing shimmers.
      const half = this.snapZoomCrisp(fit * 1.012, "floor");
      if (half >= fit * 0.8) return half;
      return Math.max(0.5, Math.floor(fit * 1.012 / 0.25 + 1e-6) * 0.25);
    }
    // Phones: cover the viewport. The nearest crisp step when it leaves at
    // most a 5% parchment band, else the next step up.
    const near = this.snapZoomCrisp(fill);
    return near >= fill * 0.95 ? near : this.snapZoomCrisp(fill, "ceil");
  }

  /** Snap (or ease) the overview camera to its wide base framing. */
  private applyOverviewBase(immediate: boolean) {
    const cam = this.cameras.main;
    if (!cam) return;
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    const zoom = this.userZoom ?? this.overviewBaseZoom();
    // Bounds clamp pins a wider-than-map view to the top-left corner
    // (Phaser clamps, it does not center). The wide beat drops the bounds so
    // the town floats centered in its parchment margin; anchor legs restore
    // them (see overviewDriftTick).
    cam.removeBounds();
    if (immediate || reducedMotion()) {
      cam.setZoom(zoom);
      cam.centerOn(W / 2, H / 2);
    } else {
      // Forced: the base framing must win over any drift move still easing.
      cam.zoomTo(zoom, 900, "Sine.easeInOut", true);
      cam.pan(W / 2, H / 2, 900, "Sine.easeInOut", true);
    }
  }

  /**
   * Enter/leave the composed town overview. Public contract for TownView and
   * the demo/replay shells (also reachable as `__townshipScene.setOverviewMode`
   * and `__town.setOverviewMode`). Spawning a player always exits overview.
   */
  setOverviewMode(on: boolean) {
    if (on === this.overviewMode) return;
    this.overviewMode = on;
    if (on) {
      const cam = this.cameras.main;
      cam?.stopFollow();
      this.applyOverviewBase(true);
      // Capture sessions script their own framing; a drifting camera would
      // make every still nondeterministic. Reduced motion keeps the static
      // wide shot for the same reason it skips other decorative motion.
      if (!this.captureMode && !reducedMotion() && !this.reducedMotionRequested) {
        this.overviewStep = 0;
        this.overviewDriftTimer?.remove(false);
        this.overviewDriftTimer = this.time.delayedCall(4200, () => this.overviewDriftTick());
      }
    } else {
      this.stopOverviewDrift();
      if (!this.playerSprite) this.fitCamera();
    }
  }

  /** Cancel the drift timers (mode flag untouched by pause). */
  private stopOverviewDrift() {
    this.overviewDriftTimer?.remove(false);
    this.overviewDriftTimer = undefined;
    this.overviewResumeTimer?.remove(false);
    this.overviewResumeTimer = undefined;
  }

  /**
   * Pause the drift (user took the camera, or a scene beat borrowed it) and
   * resume from the wide base framing after `ms` of quiet.
   */
  private pauseOverviewDrift(ms: number) {
    if (!this.overviewMode) return;
    this.overviewDriftTimer?.remove(false);
    this.overviewDriftTimer = undefined;
    this.overviewResumeTimer?.remove(false);
    this.overviewResumeTimer = this.time.delayedCall(ms, () => {
      if (!this.overviewMode || this.playerSprite) return;
      if (this.captureMode || reducedMotion() || this.reducedMotionRequested) return;
      this.userZoom = null;
      this.applyOverviewBase(false);
      this.overviewDriftTimer = this.time.delayedCall(1400, () => this.overviewDriftTick());
    });
  }

  /** Set-piece waypoints for the drift: label anchors, else landmarks. */
  private buildOverviewWaypoints(): Array<{ x: number; y: number }> {
    const raw = this.mapLabels.size > 0
      ? [...this.mapLabels.values()]
      : [...this.landmarkPositions.values()];
    if (raw.length === 0) return [{ x: 600, y: 400 }];
    // Nearest-neighbour chain from the point closest to the town centre —
    // an unhurried walking tour rather than criss-cross whip-pans.
    const remaining = raw.slice();
    remaining.sort((a, b) =>
      Phaser.Math.Distance.Between(a.x, a.y, 600, 400)
      - Phaser.Math.Distance.Between(b.x, b.y, 600, 400));
    const tour: Array<{ x: number; y: number }> = [remaining.shift()!];
    while (remaining.length > 0 && tour.length < 9) {
      const last = tour[tour.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = Phaser.Math.Distance.Between(last.x, last.y, remaining[i].x, remaining[i].y);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      // Skip waypoints so close the "drift" would be a shiver.
      if (bestDist >= 140) tour.push(next);
    }
    return tour;
  }

  /**
   * One leg of the extremely slow overview drift: three set-piece anchors at
   * a crisp close-in zoom, then a long wide beat back at the base framing.
   * Zoom and pan never run together: a leg eases to its crisp zoom (~2.4 s)
   * and only then glides (~12 s) at constant zoom — the wide beat glides
   * home first, then eases out — so tiles sit on whole device pixels for
   * the whole glide and the labels never step mid-drift.
   */
  private overviewDriftTick() {
    if (!this.overviewMode || this.playerSprite) return;
    const cam = this.cameras.main;
    if (!cam) return;
    if (this.overviewWaypoints.length === 0) {
      this.overviewWaypoints = this.buildOverviewWaypoints();
    }
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    const base = this.overviewBaseZoom();
    const fill = Math.max(this.scale.width / W, this.scale.height / H);
    // Anchor legs glide, so they need a crisp zoom (an integer when one is
    // near): closer than base, and never under fill, so the bounds below
    // keep edge waypoints from panning into parchment.
    let driftZoom = this.snapZoomCrisp(Math.max(base * 1.22, fill * 1.06));
    if (driftZoom < fill) driftZoom = this.snapZoomCrisp(fill, "ceil");
    if (driftZoom <= base) driftZoom = this.snapZoomCrisp(base + 0.5, "ceil");
    const ZOOM_MS = 2400;
    const PAN_MS = 12000;
    // A chained move must not outlive a pause: the hold timer is cleared the
    // moment the user (or a scene beat) takes the camera.
    const driftLive = () => this.overviewMode && !this.playerSprite && this.overviewDriftTimer !== undefined;

    const CYCLE = 4; // 3 anchor legs, then one wide beat
    const phase = this.overviewStep % CYCLE;
    this.overviewStep += 1;
    let holdMs: number;
    if (phase === CYCLE - 1) {
      // Wide beat: glide home at the anchor zoom, then ease out to the
      // composed full-town shot (unbounded so the map centers in its margin
      // — see applyOverviewBase).
      cam.removeBounds();
      cam.pan(W / 2, H / 2, PAN_MS, "Sine.easeInOut", false, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress === 1 && driftLive()) cam.zoomTo(base, ZOOM_MS, "Sine.easeInOut");
      });
      holdMs = PAN_MS + ZOOM_MS + 2600;
    } else {
      // Anchor legs glide zoomed past fill, where the bounds keep the pan
      // from drifting into off-map parchment near edge waypoints. The bounds
      // go on only once the zoom is there: while the view is still wider
      // than the map, Phaser's clamp would snap it to the top-left corner.
      const wp = this.overviewWaypoints[this.overviewLeg % this.overviewWaypoints.length];
      this.overviewLeg += 1;
      cam.zoomTo(driftZoom, ZOOM_MS, "Sine.easeInOut", false, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress < 1 || !driftLive()) return;
        cam.setBounds(0, 0, W, H);
        cam.pan(wp.x, wp.y, PAN_MS, "Sine.easeInOut");
      });
      holdMs = ZOOM_MS + PAN_MS + 1600;
    }
    this.overviewDriftTimer = this.time.delayedCall(holdMs, () => this.overviewDriftTick());
  }

  /* ── User camera controls: wheel zoom, pinch, double-click ── */

  /**
   * Nearest crisp zoom in device space: a multiple of 0.5, so every 16-px
   * tile lands on whole device pixels (1:1 texels at integers, a clean
   * 1-2-1-2 cadence at halves) — preferring an integer when `z` is within
   * 12% of one. "floor"/"ceil" pick the crisp value at or below/above `z`
   * for the fit/fill framings that must not crop or uncover parchment.
   */
  private snapZoomCrisp(z: number, mode: "nearest" | "floor" | "ceil" = "nearest"): number {
    const STEP = 0.5;
    if (mode === "floor") return Math.max(STEP, Math.floor(z / STEP + 1e-6) * STEP);
    if (mode === "ceil") return Math.max(STEP, Math.ceil(z / STEP - 1e-6) * STEP);
    const whole = Math.round(z);
    if (whole >= 1 && Math.abs(z - whole) <= Math.min(z * 0.12, 0.24)) return whole;
    return Math.max(STEP, Math.round(z / STEP) * STEP);
  }

  /** Snap a user zoom crisp inside the 0.75-2.0 (CSS) clamp, in device space. */
  private snapZoom(z: number): number {
    return this.snapZoomCrisp(Phaser.Math.Clamp(z, 0.75 * RENDER_DPR, 2.0 * RENDER_DPR));
  }

  /**
   * Overview bounds follow the user's zoom: on when the view fits inside
   * the map (pans clamp at its edges), off when the view is wider (Phaser's
   * clamp would pin a wider-than-map view to the top-left corner — a pop).
   */
  private syncOverviewBounds(cam: Phaser.Cameras.Scene2D.Camera, zoom: number) {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    if (zoom >= Math.max(this.scale.width / W, this.scale.height / H)) cam.setBounds(0, 0, W, H);
    else cam.removeBounds();
  }

  private installCameraControls() {
    // Mouse-wheel zoom — crisp half-steps in device space (a quarter of a
    // CSS step on 2x displays: the old feel), clamped. Works over the
    // overview AND over the follow camera (the follow zoom keeps the
    // override). Forced, so a wheel always wins over an easing drift zoom.
    const wheelStep = Math.max(0.5, 0.25 * RENDER_DPR);
    this.input.on(
      "wheel",
      (_p: Phaser.Input.Pointer, _objs: unknown[], _dx: number, dy: number) => {
        const cam = this.cameras.main;
        if (!cam || dy === 0) return;
        const current = this.userZoom ?? cam.zoom;
        const next = this.snapZoom(current + (dy > 0 ? -wheelStep : wheelStep));
        if (next === this.userZoom) return;
        this.userZoom = next;
        cam.panEffect.reset();
        if (!this.playerSprite) this.syncOverviewBounds(cam, next);
        cam.zoomTo(next, 200, "Sine.easeOut", true);
        this.pauseOverviewDrift(11000);
      },
    );

    // Double-click: zoom toward the clicked point (no-player camera only —
    // with a player, taps are movement).
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.playerSprite) return;
      const detail = (p.event as MouseEvent | undefined)?.detail ?? 0;
      if (detail < 2) return;
      const cam = this.cameras.main;
      if (!cam) return;
      const next = this.snapZoom((this.userZoom ?? cam.zoom) + 0.5 * RENDER_DPR);
      this.userZoom = next;
      this.syncOverviewBounds(cam, next);
      cam.pan(p.worldX, p.worldY, 450, "Sine.easeInOut", true);
      cam.zoomTo(next, 450, "Sine.easeInOut", true);
      this.pauseOverviewDrift(11000);
    });

    // Two-finger pinch (no-player camera only; the player owns touch for
    // the joystick + tap-to-walk). Continuous while pinching, snapped on
    // release.
    this.input.addPointer(2);
    this.input.on("pointermove", () => {
      if (this.playerSprite) return;
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      const cam = this.cameras.main;
      if (!cam || !p1?.isDown || !p2?.isDown) return;
      const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      if (this.pinchStartDist === null) {
        this.pinchStartDist = dist;
        this.pinchStartZoom = cam.zoom;
        // Take the camera from any drift move still easing.
        cam.panEffect.reset();
        cam.zoomEffect.reset();
        this.pauseOverviewDrift(11000);
        return;
      }
      if (this.pinchStartDist > 0) {
        const z = Phaser.Math.Clamp(
          this.pinchStartZoom * (dist / this.pinchStartDist), 0.75 * RENDER_DPR, 2.0 * RENDER_DPR);
        cam.setZoom(z);
      }
    });
    const endPinch = () => {
      if (this.pinchStartDist === null) return;
      this.pinchStartDist = null;
      const cam = this.cameras.main;
      if (!cam || this.playerSprite) return;
      this.userZoom = this.snapZoom(cam.zoom);
      this.syncOverviewBounds(cam, this.userZoom);
      cam.zoomTo(this.userZoom, 160, "Sine.easeOut", true);
      this.pauseOverviewDrift(11000);
    };
    this.input.on("pointerup", endPinch);
    this.input.on("pointerupoutside", endPinch);
  }

  /** Recompute landmark positions + wander waypoints from this.landmarks. */
  private rebuildLandmarks() {
    this.landmarkPositions.clear();
    this.wanderPoints = [];
    if (!this.builtMap) {
      this.buildFallbackTown(Number(this.game.config.width), Number(this.game.config.height));
    }
    this.layoutLandmarksAndDecor();
    // Seats were derived from the old landmark set: re-seat silently.
    if (this.spots && this.agentRecords.size > 0) {
      this.spots.clear();
      for (const [id, rec] of this.agentRecords) {
        const sprite = rec.sprite;
        if (sprite === this.playerSprite || !sprite.active) continue;
        const seat = this.seatResident(id, rec.location ?? this.initialLocationFor("", rec.routine), undefined);
        sprite.syncReplayState(seat.x, seat.y, sprite.getStance(), seat.activity, {
          decided: sprite.isDecided(),
          indoors: seat.indoors,
        });
        if (seat.facing) sprite.face(seat.facing);
      }
    }
  }

  private layoutLandmarksAndDecor() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    for (const lm of this.landmarks) {
      // The authored door apron when the map has one; otherwise buildings
      // resolve to the first walkable row below their footprint and open
      // landmarks to walkable interior ground — never a centre in a wall.
      const pos = this.spots?.doorOf(lm.name) ?? this.deriveEntrance(lm);
      this.landmarkPositions.set(lm.name, pos);
      if (lm.type !== "road") this.wanderPoints.push(pos);
    }
    void W;
    void H;

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
    const pixelFont = this.cache.bitmapFont.has(PIXEL_FONT_OUTLINED);
    for (const lm of this.landmarks) {
      if (lm.type === "road") continue;
      const anchor = this.mapLabels.get(lm.name);
      const x = Math.round(anchor ? anchor.x : lm.x + lm.width / 2);
      const y = Math.round(anchor ? anchor.y : lm.y - 8);
      // A dark parchment-ink plate behind pixel caps — the same material as
      // the resident nameplates, so the town reads as one sign-painter.
      const txt = pixelFont
        ? this.add.bitmapText(0, 0, PIXEL_FONT_OUTLINED, pixelText(lm.name)).setOrigin(0.5, 0.5)
        : this.add.text(0, 0, lm.name, {
          fontFamily: "Inter, 'Helvetica Neue', sans-serif",
          fontSize: "9px",
          fontStyle: "bold",
          color: "#f5ead2",
          resolution: RENDER_DPR,
        }).setOrigin(0.5, 0.5);
      const plate = this.add.image(0, 0, "__WHITE")
        .setTint(0x1c1810)
        .setAlpha(0.72)
        .setDisplaySize(Math.ceil(txt.width) + 6, Math.ceil(txt.height) + 2);
      const chip = this.add.container(x, y, [plate, txt]).setDepth(5500).setAlpha(0.94);
      chip.setScale(this.labelScale);
      chip.setData("lm", lm);
      chip.setData("w", Math.ceil(txt.width) + 6);
      chip.setData("h", Math.ceil(txt.height) + 2);
      chip.setData("baseY", y);
      this.landmarkLabelTexts.push(chip);
    }
    this.staggerLandmarkChips();
  }

  /**
   * Neighbouring landmarks (a restaurant beside a bodega row) get chips
   * that would overlap: stagger the later one a line lower. Footprints are
   * measured at the current label scale, so the overview (labels drawn
   * larger) re-staggers instead of letting chips run into each other.
   */
  private staggerLandmarkChips() {
    const k = this.labelScale;
    const placed: Phaser.GameObjects.Container[] = [];
    const chips = [...this.landmarkLabelTexts];
    for (const chip of chips) chip.y = chip.getData("baseY") as number;
    for (const chip of chips.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const w = (chip.getData("w") as number) * k;
      const h = (chip.getData("h") as number) * k;
      for (let guard = 0; guard < 4; guard++) {
        const clash = placed.find((other) => {
          const ow = (other.getData("w") as number) * k;
          const oh = (other.getData("h") as number) * k;
          return Math.abs(other.x - chip.x) < (w + ow) / 2 + 4 && Math.abs(other.y - chip.y) < (h + oh) / 2 + 2;
        });
        if (!clash) break;
        chip.y = clash.y + h + 3;
      }
      placed.push(chip);
    }
  }

  /* ── Label scale ─────────────────────────────────────────── */

  /**
   * Pixel type is only crisp when a font texel covers a whole number of
   * device pixels. Labels live in world space, so their world scale is
   * texel / zoom with texel = RENDER_DPR × K device px: one CSS pixel per
   * texel in the composed overview (K = 1), two under the follow camera and
   * its spotlights (K = 2) — the same on-screen size the old vector labels
   * had, never a fractional resample. K is fixed per camera mode, so the
   * scale tracks the zoom continuously (recomputed past a 0.002 change)
   * instead of stepping at .5 boundaries mid-drift.
   */
  private syncLabelScale() {
    const zoom = this.cameras.main?.zoom ?? 1;
    const k = this.playerSprite ? 2 : 1;
    // The previous K, recovered from the last scale (scale × zoom = RENDER_DPR × K).
    const prevK = Math.round((this.labelScale * this.labelZoom) / RENDER_DPR);
    if (k === prevK && Math.abs(zoom - this.labelZoom) < 0.002) return;
    this.labelZoom = zoom;
    const want = (RENDER_DPR * k) / zoom;
    const rescaled = Math.abs(want - this.labelScale) > 0.01;
    this.labelScale = want;
    for (const chip of this.landmarkLabelTexts) chip.setScale(want);
    this.agentSprites.forEach((sprite) => sprite.setLabelScale(want));
    for (const npc of this.ambientNPCs) npc.setLabelScale(want);
    if (rescaled) this.staggerLandmarkChips();
  }

  /* ── Navigation grid ─────────────────────────────────────── */

  /**
   * (Re)build the walkability grid from the current collision rects. The
   * ground cost comes from the tilemap: paved tiles (asphalt, sidewalk,
   * paths, plazas — registry-driven via roadGids.json) cost 1, grass 1.4,
   * rail ballast 2.6, so walkers favour sidewalks and level crossings
   * without ever being forced onto them.
   */
  /** Authored standing spots from the map's `spot` anchors (Spots.ts). A
   *  procedural town has none: every seat is a blue-noise apron point. */
  private buildSpotRegistry() {
    this.spots = new SpotRegistry(spotsFromAnchors(this.mapAnchors), (x, y) =>
      x >= WORLD_MARGIN && x <= WORLD_W - WORLD_MARGIN
      && y >= WORLD_MARGIN && y <= WORLD_H - WORLD_MARGIN
      && !this.isBlocked(x, y, 2)
      && !(this.navGrid?.isRoad(x, y) ?? false));
  }

  private buildNavGrid() {
    const sidewalk = new Set<number>(roadGids.sidewalk);
    const road = new Set<number>(roadGids.road);
    const rough = new Set<number>(roadGids.rough);
    const T = roadGids.tileSize;
    const detail = this.builtMap?.getLayer("ground-detail")?.tilemapLayer;
    const ground = this.builtMap?.getLayer("ground")?.tilemapLayer;
    const roads = this.landmarks.filter((l) => l.type === "road");
    const classify = (gid: number): GroundKind | null => {
      if (sidewalk.has(gid)) return "sidewalk";
      if (road.has(gid)) return "road";
      if (rough.has(gid)) return "rough";
      return null;
    };
    const kindAt = (px: number, py: number): GroundKind => {
      if (detail || ground) {
        const tx = Math.floor(px / T);
        const ty = Math.floor(py / T);
        const d = detail?.getTileAt(tx, ty)?.index ?? -1;
        const g = ground?.getTileAt(tx, ty)?.index ?? -1;
        return classify(d) ?? (d <= 0 ? classify(g) : null) ?? "grass";
      }
      // Procedural towns: their road landmarks are the only paving.
      for (const r of roads) {
        if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) return "sidewalk";
      }
      return "grass";
    };
    this.navGrid = new NavGrid(this.collisionRects, kindAt);
  }

  /**
   * Where a resident actually goes when "at" a landmark. Buildings resolve
   * to their door apron — the first walkable row below the footprint,
   * preferring the paved cell on that row — and open landmarks (parks,
   * water, roads) to their nearest walkable interior point. The old
   * geometric-centre nudge often landed on the wrong side of a building.
   */
  private deriveEntrance(lm: LandmarkData): { x: number; y: number } {
    const cx = lm.x + lm.width / 2;
    const cy = lm.y + lm.height / 2;
    const grid = this.navGrid;
    if (!grid) return this.findFreeNear(cx, cy);
    const type = lm.type.toLowerCase();
    // A street is not a place to stand: its apron is the sidewalk beside it.
    if (/road|street/.test(type)) {
      return grid.nearestWalkable(cx, cy, 96, { avoidRoad: true }) ?? this.findFreeNear(cx, cy);
    }
    if (/park|water|green|garden|field|lake|river|plaza|square|commons/.test(type)) {
      // The roomiest spot near the centre — never the well, a bench, or
      // the strip of grass between a prop and the rail ballast.
      return grid.openestNear(cx, cy, Math.min(80, Math.max(lm.width, lm.height) / 2))
        ?? this.findFreeNear(cx, cy);
    }
    // Footprint = collision rects that mostly lie inside the landmark rect
    // (so a lamppost on the apron never drags the door downward).
    let bottom = -Infinity;
    for (const r of this.collisionRects) {
      const ox = Math.max(0, Math.min(r.x + r.w, lm.x + lm.width) - Math.max(r.x, lm.x));
      const oy = Math.max(0, Math.min(r.y + r.h, lm.y + lm.height) - Math.max(r.y, lm.y));
      if (ox * oy >= 0.5 * r.w * r.h) bottom = Math.max(bottom, r.y + r.h);
    }
    if (!Number.isFinite(bottom)) {
      return grid.nearestWalkable(cx, cy, 160) ?? this.findFreeNear(cx, cy);
    }
    for (let y = bottom + 10; y <= bottom + 58; y += 8) {
      if (!grid.isWalkable(cx, y)) continue;
      const kind = grid.kindAt(cx, y);
      if (kind === "sidewalk") return { x: cx, y };
      let offRoad: { x: number; y: number } | null = kind === "road" ? null : { x: cx, y };
      for (const dx of [8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 48, -48]) {
        if (!grid.isWalkable(cx + dx, y)) continue;
        const k = grid.kindAt(cx + dx, y);
        if (k === "sidewalk") return { x: cx + dx, y };
        if (!offRoad && k !== "road") offRoad = { x: cx + dx, y };
      }
      if (offRoad) return offRoad;
    }
    return grid.nearestWalkable(cx, bottom + 16, 160, { avoidRoad: true }) ?? this.findFreeNear(cx, cy);
  }

  /** Where a group meets: the stated place, else where most of them dwell,
   *  else the landmark nearest the meeting point. */
  private meetingLandmark(ids: string[], near: { x: number; y: number }, location?: string): string | undefined {
    const stated = location ? this.resolveLandmarkName(location) : undefined;
    if (stated) return stated;
    const votes = new Map<string, number>();
    for (const id of ids) {
      const loc = this.agentRecords.get(id)?.location;
      if (loc) votes.set(loc, (votes.get(loc) ?? 0) + 1);
    }
    const majority = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return majority ?? this.nearestLandmarkName(near);
  }

  /** The non-road landmark whose apron is nearest to a point. */
  private nearestLandmarkName(pt: { x: number; y: number }): string | undefined {
    let best: string | undefined;
    let bestD = Infinity;
    for (const lm of this.landmarks) {
      if (lm.type === "road") continue;
      const pos = this.landmarkPositions.get(lm.name);
      if (!pos) continue;
      const d = Math.hypot(pos.x - pt.x, pos.y - pt.y);
      if (d < bestD) { bestD = d; best = lm.name; }
    }
    return best;
  }

  /** Exact landmark name, else a case-insensitive match, else undefined. */
  private resolveLandmarkName(name: string): string | undefined {
    if (this.landmarkPositions.has(name)) return name;
    const needle = name.trim().toLowerCase();
    for (const key of this.landmarkPositions.keys()) {
      if (key.toLowerCase() === needle) return key;
    }
    return undefined;
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
      if (body === exclude || !body.active || body.isIndoors()) continue;
      if (Phaser.Math.Distance.Between(x, y, body.x, body.y) < clearance) return true;
      const target = body.getReservedTarget();
      if (target && Phaser.Math.Distance.Between(x, y, target.x, target.y) < clearance) return true;
      // A couple's trailing partner is a real second body on the ground.
      const cp = body.getCompanionPoint();
      if (cp && Phaser.Math.Distance.Between(x, y, cp.x, cp.y) < clearance) return true;
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
    const cx = Phaser.Math.Clamp(x, WORLD_MARGIN, WORLD_W - WORLD_MARGIN);
    const cy = Phaser.Math.Clamp(y, WORLD_MARGIN, WORLD_H - WORLD_MARGIN);
    // Two passes: nobody idles in the street if there is any other ground,
    // but a seed point that is itself on the road (a crossing) keeps its
    // neighbourhood.
    const seedOnRoad = this.navGrid?.isRoad(cx, cy) ?? false;
    for (const allowRoad of seedOnRoad ? [true] : [false, true]) {
      const open = (px: number, py: number) =>
        !this.isBlocked(px, py)
        && (allowRoad || !this.navGrid?.isRoad(px, py))
        && (clearOf <= 0 || !this.isOccupied(px, py, clearOf, opts?.exclude));
      if (open(cx, cy)) return { x: cx, y: cy };
      // Sub-tile slots first (18 px) so a crowd fans out around its meeting
      // point, then widening rings until open ground is found.
      for (const radius of [18, 32, 48, 72, 96, 120, 144, 168]) {
        // Ring order starts east/west so overflow fans along the apron
        // instead of stacking straight below the door.
        const candidates: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          candidates.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
        }
        for (const c of candidates) {
          const px = Phaser.Math.Clamp(c.x, WORLD_MARGIN, WORLD_W - WORLD_MARGIN);
          const py = Phaser.Math.Clamp(c.y, WORLD_MARGIN, WORLD_H - WORLD_MARGIN);
          if (open(px, py)) return { x: px, y: py };
        }
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
    for (const w of this.windowGlows) {
      // Someone inside keeps the panes faintly warm even at noon.
      const lived = w.pane && w.landmark && this.occupiedLandmarks.has(w.landmark) ? 0.22 : 0;
      w.obj.setAlpha(Math.max(w.max * g, lived));
    }
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

  /** Scenario id for "undecided" (its color is in optionColors too). */
  private undecidedId = "undecided";

  /** Inject the active scenario's option→color map (see TownView). */
  setOptionColors(colors: Record<string, string>, undecidedId?: string) {
    this.optionColors = colors || {};
    if (undecidedId) this.undecidedId = undecidedId;
    // Re-derive every ring: a late color map must not leave residents grey.
    for (const [id, sprite] of this.agentSprites) {
      if (sprite === this.playerSprite) continue;
      const current = sprite.getStance();
      const candidate = this.agentOpinions.get(id) || current.optionId;
      sprite.setStance(this.stanceFor(candidate, current.confidence), "silent");
    }
  }

  private opinionColor(candidate?: string): string {
    if (candidate && this.optionColors[candidate]) return this.optionColors[candidate];
    return "#FFFFFF";
  }

  /** Stance state for a candidate id + confidence in this scenario's colors. */
  private stanceFor(candidate?: string, confidence?: number): StanceState {
    const undecided = !candidate || candidate === this.undecidedId || !this.optionColors[candidate];
    return {
      optionId: candidate ?? "",
      color: undecided ? (this.optionColors[this.undecidedId] ?? "#D1D5DB") : this.optionColors[candidate!],
      confidence: Number.isFinite(confidence) ? Number(confidence) : 0,
      undecided,
    };
  }
}

// Reference unused customization to keep tree-shaking honest.
void AGENT_CUSTOMIZATION;

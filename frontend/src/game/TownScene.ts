import Phaser from "phaser";
import { AgentSprite, type AgentActivity, type GestureKind } from "./AgentSprite";
import { PlayerSprite } from "./PlayerSprite";
import { TOWN_ACCENT, TOWN_MAP_KEY } from "./config";
import type { AgentState, TownId, LandmarkData, TownData, WeatherKind } from "../types/messages";
import type { UserProfile } from "../context/UserProfileContext";
import { AGENT_CUSTOMIZATION, ALL_CHARACTER_KEYS, resolveAgentSprite } from "./spriteCustomization";
import { drawLandmarkBuilding, drawStreetlamp, type StreetlampHandle } from "./LandmarkArt";
import { composeTownAmbience, type AmbienceHandle } from "./SceneAmbience";
import { WorldClock } from "./WorldClock";
import { Routine, type RoutineEntry } from "./Routine";
import { pickExchange } from "./AmbientLines";
import { FALLBACK_TOWN_DATA } from "../hooks/useTownData";
import { WeatherScene } from "./WeatherScene";

/* ── Helper: fetch town data (single source of truth) ───────── */

async function fetchTownData(townId: TownId): Promise<TownData | null> {
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
  "Did you see that debate?",
  "Early voting ends the 14th.",
  "Who are you voting for?",
  "I'm still undecided…",
  "Property taxes are brutal.",
  "We need real healthcare.",
  "Immigration needs fixing.",
  "This election matters.",
  "My commute is terrible.",
  "The economy, always.",
  "Think about the schools.",
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
  private townId: TownId = "dover";
  private agentSprites: Map<string, AgentSprite> = new Map();
  private agentRecords: Map<string, AgentRecord> = new Map();
  private playerSprite: PlayerSprite | null = null;
  private landmarks: LandmarkData[] = [];
  private landmarkPositions: Map<string, { x: number; y: number }> = new Map();
  private characterKeys: Set<string> = new Set();
  private wanderPoints: Array<{ x: number; y: number }> = [];
  private collisionGroup?: Phaser.Physics.Arcade.StaticGroup;
  private townDataResolved = false;
  private playerSpawnPending: UserProfile | null = null;

  // World clock + sky overlay
  private worldClock = new WorldClock({ startHour: 8, minutesPerSecond: 1 });
  private skyOverlay?: Phaser.GameObjects.Rectangle;

  // Streetlamps (drawn over landmarks, glow at night)
  private streetlamps: StreetlampHandle[] = [];
  private ambience?: AmbienceHandle;
  private currentlyNight = false;

  // Encounter scheduling
  private encounterTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: "TownScene" });
  }

  init(data: { townId: TownId }) {
    this.townId = data.townId;
    // Inline fallback until /api/towns resolves; overridden in create().
    this.landmarks = (FALLBACK_TOWN_DATA[this.townId]?.landmarks ?? []).slice();
  }

  /* ── Preload ─────────────────────────────────────────────── */

  preload() {
    this.load.image("rpg-tileset", "/assets/tilesets/rpg-tileset.png");
    this.load.image("magecity-bg", "/assets/tilesets/magecity.png");
    this.load.image("speech-bubble", "/assets/speech_bubble/v2.png");

    // Town-aware tilemap. Until per-town files exist, fall back to shared tilemap.
    const mapKey = TOWN_MAP_KEY[this.townId];
    const mapUrl = `/assets/maps/${this.townId}.tmj`;
    this.load.tilemapTiledJSON(mapKey, mapUrl);
    // If per-town .tmj is missing, fall back to the shared default.
    this.load.once(`fileerror-tilemapJSON-${mapKey}`, () => {
      this.load.tilemapTiledJSON(mapKey, "/assets/maps/tilemap.json");
      this.load.start();
    });

    this.load.spritesheet("campfire", "/assets/spritesheets/campfire.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("sparkle", "/assets/spritesheets/gentlesparkle32.png", { frameWidth: 32, frameHeight: 32 });
    // Animated water-foam frames (bottom half of gentlewaterfall32.png is foam) — used as
    // lake surface shimmer. We treat the whole sheet as 32×32 cells; foam frames live in
    // the bottom rows.
    this.load.spritesheet("water-foam", "/assets/spritesheets/gentlewaterfall32.png", {
      frameWidth: 32, frameHeight: 32,
    });
    // Animated windmill (8 frames in a 3×3 grid, each 208×208).
    this.load.spritesheet("windmill", "/assets/spritesheets/windmill.png", {
      frameWidth: 208, frameHeight: 208,
    });

    // Character spritesheets — 32×32 frames
    for (const fullKey of ALL_CHARACTER_KEYS) {
      // ALL_CHARACTER_KEYS already prefixes "char-" — use rest as filename.
      const fileName = fullKey.startsWith("char-") ? fullKey.slice(5) : fullKey;
      this.load.spritesheet(fullKey, `/assets/characters/${fileName}.png`, {
        frameWidth: 32,
        frameHeight: 32,
      });
      this.characterKeys.add(fileName);
    }

    // Folk spritesheet as additional fallback
    this.load.spritesheet("folk", "/assets/characters/32x32folk.png", { frameWidth: 32, frameHeight: 32 });

    // Player sprite variants — try 32×32 player-N first, fall back to legacy 16-px.
    for (let i = 1; i <= 6; i++) {
      const key = `char-player-${i}`;
      this.load.spritesheet(key, `/assets/characters/player-${i}.png`, { frameWidth: 32, frameHeight: 32 });
      this.load.once(`fileerror-spritesheet-${key}`, () => {/* silently skip */});
    }
    this.load.spritesheet("char-player", "/assets/characters/player.png", {
      frameWidth: 16, frameHeight: 16,
    });
  }

  /* ── Create ──────────────────────────────────────────────── */

  create() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    // Generate outfit/accessory overlay textures programmatically (FIX 17).
    this.generateOverlayTextures();

    // Tilemap
    this.buildTilemap(W, H);

    // Sky overlay (depth 999) – starts at current hour tint.
    this.skyOverlay = this.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0).setDepth(999);
    this.refreshSkyOverlay();

    // Try to fetch authoritative town data; build landmarks immediately with
    // current (fallback) data and re-render if the API supplies different
    // landmark positions.
    this.layoutLandmarksAndDecor();

    fetchTownData(this.townId).then((d) => {
      if (d && d.landmarks?.length) {
        this.landmarks = d.landmarks;
        this.townDataResolved = true;
        // Re-layout (cheap — destroys old graphics and re-creates).
        this.rebuildLandmarks();
      }
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

    // ── Delicate Smallville-style scene composition (trees, flowers,
    // lampposts with glow, smoke, water shimmer, windmill, particle drift).
    // setHour() is called from the world-clock listener below.
    if (!this.anims.exists("windmill-spin") && this.textures.exists("windmill")) {
      this.anims.create({
        key: "windmill-spin",
        frames: this.anims.generateFrameNumbers("windmill", { start: 0, end: 7 }),
        frameRate: 7,
        repeat: -1,
      });
    }
    this.ambience = composeTownAmbience(this, this.townId, this.landmarks, W, H);
    this.ambience.setHour(this.worldClock.hour);

    // Register + launch the Weather scene in parallel
    if (!this.scene.get("WeatherScene")) {
      this.scene.add("WeatherScene", WeatherScene, false);
    }
    this.scene.launch("WeatherScene", { townId: this.townId });

    // Encounter conversations every 12-20s
    this.encounterTimer = this.time.addEvent({
      delay: 16000,
      loop: true,
      callback: () => this.tryEncounterConversation(),
    });

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
    this.worldClock.tick(delta);
    if (this.worldClock.minute !== prevMin || this.worldClock.hour !== prevHour) {
      this.refreshSkyOverlay();
      this.tickRoutines();
      // Update streetlamp night-mode + ambience glow at top of each hour
      if (this.worldClock.hour !== prevHour) {
        this.applyStreetlampNight();
        this.ambience?.setHour(this.worldClock.hour);
      }
    }

    // Streetlamp flicker (low-probability per frame)
    if (this.currentlyNight) {
      for (const l of this.streetlamps) l.flicker();
    }

    // Y-based depth sort – characters "behind" others appear further back
    this.agentSprites.forEach((s) => s.syncDepth());
    this.playerSprite?.updatePlayer(delta);

    // Player ↔ landmark collision
    if (this.playerSprite && this.collisionGroup) {
      this.physics.collide(this.playerSprite, this.collisionGroup);
    }
  }

  /* ── Agent Management (called from React / TownView) ──── */

  addAgent(agent: AgentState & { routine?: RoutineEntry[] }) {
    if (this.agentSprites.has(agent.id)) return;

    const base = this.landmarkPositions.get(agent.location) ??
      this.wanderPoints[0] ?? { x: 400, y: 400 };

    const sx = Phaser.Math.Clamp(base.x + Phaser.Math.Between(-55, 55), 40, 1160);
    const sy = Phaser.Math.Clamp(base.y + Phaser.Math.Between(-35, 35), 40, 760);

    const custom = resolveAgentSprite(agent.id);

    const sprite = new AgentSprite(this, sx, sy, {
      id: agent.id,
      name: agent.name,
      initials: agent.initials ?? this.initials(agent.name),
      color: agent.color ?? TOWN_ACCENT[this.townId] ?? "#888",
      town: agent.town,
      opinionColor: this.opinionColor(agent.opinion?.candidate),
      spriteKey: custom.spriteKey,
      accessoryKey: custom.accessoryKey,
      tint: custom.tint,
      // Couples render as a single body with a small companion-ring indicator
      // inside the opinion ring (see AgentSprite.redrawRing). The previous
      // side-by-side second body read as a "second figure" parked next to
      // the agent.
      partner: custom.partner,
    });

    this.agentSprites.set(agent.id, sprite);

    const record: AgentRecord = {
      sprite,
      routine: agent.routine ? new Routine(agent.routine) : undefined,
      topConcerns: [],
      idleThoughts: (agent as any).idle_thoughts ?? undefined,
    };
    this.agentRecords.set(agent.id, record);

    // If a routine is supplied, the clock tick drives motion. Otherwise we
    // fall back to randomized wandering.
    if (!record.routine) {
      const initDelay = Phaser.Math.Between(1500, 6000);
      this.time.delayedCall(initDelay, () => this.scheduleWander(agent.id));
    }
  }

  moveAgent(agentId: string, toLocation: string) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    const base = this.landmarkPositions.get(toLocation) ?? this.wanderPoints[0] ?? { x: 400, y: 400 };
    const tx = Phaser.Math.Clamp(base.x + Phaser.Math.Between(-50, 50), 40, 1160);
    const ty = Phaser.Math.Clamp(base.y + Phaser.Math.Between(-35, 35), 40, 760);
    sprite.moveToPosition(tx, ty);
  }

  showAgentSpeech(agentId: string, text: string, duration?: number) {
    this.agentSprites.get(agentId)?.showSpeechBubble(text, duration);
  }

  updateAgentOpinion(agentId: string, candidate: string) {
    this.agentSprites.get(agentId)?.setOpinionColor(this.opinionColor(candidate));
  }

  showAgentEmote(agentId: string, type: "reflecting" | "opinion_changed") {
    this.agentSprites.get(agentId)?.showEmote(type);
  }

  playGesture(agentId: string, gesture: GestureKind) {
    this.agentSprites.get(agentId)?.playGesture(gesture);
  }

  /** Backend conversation_started → pair sprites face each other + go "talking". */
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
  }

  /** Backend conversation_ended → walk talkers back to idle. */
  handleConversationEnded(_conversationId: string) {
    this.agentSprites.forEach((s) => {
      if (s.getActivity() === "talking") s.setActivity("idle");
    });
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
  setWorldTime(h: number, m: number) {
    this.worldClock.setTime(h, m);
    this.refreshSkyOverlay();
    this.tickRoutines();
    this.applyStreetlampNight();
  }

  /** Forward weather to the WeatherScene. */
  setWeather(w: WeatherKind) {
    const ws = this.scene.get("WeatherScene") as any;
    if (ws && typeof ws.setWeather === "function") ws.setWeather(w);
  }

  /** Camera beats — short, < 1.2s pan/zoom for narrative emphasis. */
  playNewsBeat() {
    const cam = this.cameras.main;
    if (!cam) return;
    const top = { x: cam.midPoint.x, y: 80 };
    cam.pan(top.x, top.y, 350, "Sine.easeInOut");
    cam.zoomTo(cam.zoom * 1.15, 300, "Sine.easeInOut");
    this.time.delayedCall(700, () => {
      if (this.playerSprite) {
        cam.pan(this.playerSprite.x, this.playerSprite.y, 400, "Sine.easeInOut");
      }
      cam.zoomTo(cam.zoom / 1.15, 400, "Sine.easeInOut");
    });
  }

  playOpinionShiftBeat(agentId: string) {
    const cam = this.cameras.main;
    const sprite = this.agentSprites.get(agentId);
    if (!cam || !sprite) return;
    const z = cam.zoom;
    cam.pan(sprite.x, sprite.y, 280, "Sine.easeInOut");
    cam.zoomTo(z * 1.2, 240, "Sine.easeInOut");
    this.time.delayedCall(600, () => {
      cam.zoomTo(z, 380, "Sine.easeInOut");
      if (this.playerSprite) cam.pan(this.playerSprite.x, this.playerSprite.y, 380, "Sine.easeInOut");
    });
  }

  playSimEndBeat() {
    const cam = this.cameras.main;
    if (!cam) return;
    const z = cam.zoom;
    cam.zoomTo(z * 0.7, 800, "Sine.easeInOut");
    this.time.delayedCall(1000, () => cam.zoomTo(z, 700, "Sine.easeInOut"));
  }

  /** Export all agent positions for the DOM overlay. */
  getOverlayData(): { id: string; name: string; x: number; y: number; visible: boolean; type: "agent" | "landmark" }[] {
    const data: { id: string; name: string; x: number; y: number; visible: boolean; type: "agent" | "landmark" }[] = [];

    // Agent labels
    this.agentSprites.forEach((sprite) => {
      const info = sprite.getOverlayInfo();
      data.push({ ...info, type: "agent" });
    });

    // Landmark labels — anchored to the TOP of the landmark (not the centre)
    // so they don't stack on top of agents who happen to be standing inside.
    // Additionally we hide the landmark label whenever the player or an agent
    // is currently inside the landmark's bounds — that fixes the
    // "Cnajorate Park" + "STEVEN" overlap in the bug report.
    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cyTop = lm.y - 8; // above the building roof
      let occupied = false;
      this.agentSprites.forEach((sprite) => {
        if (
          sprite.x >= lm.x && sprite.x <= lm.x + lm.width &&
          sprite.y >= lm.y && sprite.y <= lm.y + lm.height
        ) {
          occupied = true;
        }
      });
      data.push({
        id: `lm-${lm.name}`,
        name: lm.name,
        x: cx,
        y: cyTop,
        visible: !occupied,
        type: "landmark",
      });
    }

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
        .map(([id, s]) => ({ id, x: s.x, y: s.y, color: TOWN_ACCENT[this.townId] ?? "#888" })),
      player: this.playerSprite ? { x: this.playerSprite.x, y: this.playerSprite.y } : undefined,
    };
  }

  clearAgents() {
    this.agentSprites.forEach((s) => s.destroy());
    this.agentSprites.clear();
    this.agentRecords.clear();
  }

  /* ── Player Management ──────────────────────────────────── */

  addPlayer(profile: UserProfile) {
    if (this.playerSprite) return; // already spawned
    if (!this.scene.isActive()) {
      // Queue until create() runs.
      this.playerSpawnPending = profile;
      return;
    }

    // Spawn near the first landmark
    const firstLandmark = this.landmarks.find((l) => l.type !== "road") ?? this.landmarks[0];
    const base = firstLandmark
      ? { x: firstLandmark.x + firstLandmark.width / 2, y: firstLandmark.y + firstLandmark.height / 2 }
      : { x: 400, y: 400 };
    const sx = Phaser.Math.Clamp(base.x + Phaser.Math.Between(-30, 30), 60, 1140);
    const sy = Phaser.Math.Clamp(base.y + Phaser.Math.Between(-20, 20), 60, 740);

    // Honor profile.spriteKey if it points to a loaded texture.
    let spriteKey: string | undefined;
    if (profile.spriteKey && this.textures.exists(profile.spriteKey)) {
      spriteKey = profile.spriteKey;
    } else if (this.textures.exists("char-player")) {
      spriteKey = "char-player";
    }

    this.playerSprite = new PlayerSprite(this, sx, sy, {
      id: profile.agentId,
      name: profile.name,
      initials: profile.initials,
      color: profile.color,
      town: profile.town,
      spriteKey,
    });

    // Register in agentSprites so depth sorting includes the player
    this.agentSprites.set(profile.agentId, this.playerSprite);

    // Camera follow with smooth lerp
    this.cameras.main.startFollow(this.playerSprite, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, Number(this.game.config.width), Number(this.game.config.height));

    this.events.emit("player-spawned");
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
    if (!sprite || !this.scene.isActive()) return;

    const idleDelay = Phaser.Math.Between(4000, 13000);
    this.time.delayedCall(idleDelay, () => {
      const sp = this.agentSprites.get(agentId);
      if (!sp) return;

      const target = this.pickWanderTarget();
      sp.moveToPosition(target.x, target.y, () => {
        // Occasionally show an idle thought after arriving.
        // Prefer the agent's own bank (from agent.idle_thoughts) over generic.
        if (Math.random() < 0.28) {
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

  private pickWanderTarget(): { x: number; y: number } {
    if (this.wanderPoints.length === 0) return { x: 400, y: 400 };
    const pt = this.wanderPoints[Math.floor(Math.random() * this.wanderPoints.length)];
    return {
      x: Phaser.Math.Clamp(pt.x + Phaser.Math.Between(-70, 70), 40, 1160),
      y: Phaser.Math.Clamp(pt.y + Phaser.Math.Between(-45, 45), 40, 760),
    };
  }

  private addScatteredWaypoints(W: number, H: number) {
    const cols = 5, rows = 4;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        this.wanderPoints.push({
          x: 120 + (c / (cols - 1)) * (W - 240),
          y: 140 + (r / (rows - 1)) * (H - 280),
        });
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
    a.showSpeechBubble(exchange.a, 2400);
    this.time.delayedCall(1500, () => b.showSpeechBubble(exchange.b, 2400));
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

    for (const charName of this.characterKeys) {
      const key = `char-${charName}`;
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

      const sx = Phaser.Math.Between(80, W - 80);
      const sy = Phaser.Math.Between(120, H - 120);

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
      const tx = Phaser.Math.Clamp(target.x + Phaser.Math.Between(-40, 40), 40, W - 40);
      const ty = Phaser.Math.Clamp(target.y + Phaser.Math.Between(-30, 30), 40, H - 40);
      npc.moveToPosition(tx, ty, () => this.scheduleAmbientWander(npc, W, H));
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
      bird.setDepth(10);

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

  /* ── Generate outfit + accessory overlay textures ──────────── */

  /**
   * Build 96×128 (3×4 grid of 32×32 cells) textures for head-only accessory
   * overlays (kippah / hijab / cap). These hug the silhouette so they read
   * as part of the figure. Outfit overlays (chest patches) were removed —
   * the previous flat-rect approach drew a ~31×20 px solid block on top of
   * each body and read as a floating shape besides the figure.
   */
  private generateOverlayTextures() {
    const accessories: Record<string, (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => void> = {
      "accessory-kippah": (g, cx, cy) => {
        // Small dark cap on crown of head
        g.fillStyle(0x222244, 0.92);
        g.fillEllipse(cx, cy - 26, 9, 3);
      },
      "accessory-hijab": (g, cx, cy) => {
        // Colored arc covering the head
        g.fillStyle(0x6a4a6a, 0.92);
        g.fillEllipse(cx, cy - 24, 18, 13);
        g.fillStyle(0x6a4a6a, 0.92);
        g.fillRect(cx - 7, cy - 22, 14, 8);
      },
      "accessory-cap": (g, cx, cy) => {
        // Baseball cap visor + crown
        g.fillStyle(0x4a5a4a, 1);
        g.fillEllipse(cx, cy - 25, 14, 6);
        g.fillRect(cx - 6, cy - 24, 12, 4);
        // Visor
        g.fillStyle(0x222222, 1);
        g.fillRect(cx - 8, cy - 22, 8, 2);
      },
    };
    for (const [key, draw] of Object.entries(accessories)) {
      if (this.textures.exists(key)) continue;
      const g = this.add.graphics();
      g.setVisible(false);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          const cx = col * 32 + 16;
          const cy = row * 32 + 32;
          draw(g, cx, cy);
        }
      }
      g.generateTexture(key, 96, 128);
      g.destroy();
    }
  }

  /* ── Tilemap / Landmark layout ─────────────────────────── */

  private buildTilemap(W: number, H: number) {
    // The Smallville `the_ville` tilemap was previously rendered at alpha 0.92,
    // which leaked Smallville's houses + roads through the scene as grey/navy
    // rectangles that had nothing to do with our four NJ towns. We now paint a
    // delicate town-specific ground programmatically and leave the tilemap as
    // a faint texture pass only (or skip it entirely).
    this.paintGround(W, H);

    const mapKey = TOWN_MAP_KEY[this.townId];
    if (this.cache.tilemap.has(mapKey)) {
      const map = this.make.tilemap({ key: mapKey });
      const tileset = map.addTilesetImage("rpg-tileset", "rpg-tileset");
      if (tileset) {
        const scaleX = W / map.widthInPixels;
        const scaleY = H / map.heightInPixels;
        const scale = Math.max(scaleX, scaleY);
        const terrain = map.createLayer("terrain", tileset);
        // The Smallville the_ville tilemap has GIDs that don't fully map to
        // our local rpg-tileset.png (the original used Cute RPG World which
        // we don't ship), so even at low opacity it surfaces as misaligned
        // chunks. Disable rendering entirely — our painted ground covers it.
        terrain?.setScale(scale).setAlpha(0).setDepth(0).setVisible(false);
      }
    }
  }

  /** Paint a delicate, town-flavored base ground via Phaser Graphics. */
  private paintGround(W: number, H: number) {
    const accent = Phaser.Display.Color.HexStringToColor(TOWN_ACCENT[this.townId] || "#888").color;
    const baseColors: Record<TownId, { soil: number; grass: number; path: number }> = {
      dover:      { soil: 0xefe2cd, grass: 0xb6c97e, path: 0xd9c298 },
      montclair:  { soil: 0xe9e7df, grass: 0xa6c4a0, path: 0xd0d4c5 },
      parsippany: { soil: 0xe7e8d9, grass: 0xb0c9a0, path: 0xd4d6c2 },
      randolph:   { soil: 0xe8e2cd, grass: 0xa9bf8c, path: 0xcfc8b0 },
    };
    const pal = baseColors[this.townId];

    // Base canvas wash — warm cream/sand
    const ground = this.add.graphics().setDepth(0);
    ground.fillStyle(pal.soil, 1);
    ground.fillRect(0, 0, W, H);

    // Random grass patches (soft organic shapes) — adds visual rhythm so
    // empty cream areas stop reading as "pure grey."
    const rng = mulberry32Local(0xa11ce + this.townId.length * 17);
    for (let i = 0; i < 38; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rx = 28 + rng() * 60;
      const ry = 18 + rng() * 38;
      ground.fillStyle(pal.grass, 0.18 + rng() * 0.18);
      ground.fillEllipse(x, y, rx, ry);
    }

    // Subtle dirt/path circles
    for (let i = 0; i < 22; i++) {
      const x = rng() * W;
      const y = rng() * H;
      ground.fillStyle(pal.path, 0.16);
      ground.fillCircle(x, y, 12 + rng() * 26);
    }

    // Scattered grass-tuft sprites (tiny dark green ticks) — micro-detail
    const tufts = this.add.graphics().setDepth(1);
    tufts.fillStyle(0x5e8a4a, 0.45);
    for (let i = 0; i < 140; i++) {
      const x = rng() * W;
      const y = rng() * H;
      // 3-blade tuft
      tufts.fillTriangle(x, y, x + 1, y - 3, x + 2, y);
      tufts.fillTriangle(x + 3, y, x + 4, y - 2, x + 5, y);
    }

    // Tiny flower flecks in the town accent — only a few, just for warmth
    const flowers = this.add.graphics().setDepth(2);
    for (let i = 0; i < 18; i++) {
      const x = rng() * W;
      const y = rng() * H;
      flowers.fillStyle(accent, 0.45);
      flowers.fillCircle(x, y, 1.6);
      flowers.fillStyle(0xfff7e0, 0.6);
      flowers.fillCircle(x, y, 0.6);
    }

    // Soft vignette at the canvas edges to focus the eye on the town center
    const vignette = this.add.graphics().setDepth(3);
    vignette.fillStyle(0x000000, 0.04);
    vignette.fillRect(0, 0, W, 30);
    vignette.fillRect(0, H - 30, W, 30);
    vignette.fillRect(0, 0, 30, H);
    vignette.fillRect(W - 30, 0, 30, H);
  }

  /** Wipes old landmark graphics + collision and re-creates from this.landmarks. */
  private rebuildLandmarks() {
    // Clear the existing static group; rebuilding is cheap.
    this.collisionGroup?.clear(true, true);
    this.collisionGroup = undefined;
    this.landmarkPositions.clear();
    this.wanderPoints = [];
    this.layoutLandmarksAndDecor();
  }

  private layoutLandmarksAndDecor() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);
    const accent = TOWN_ACCENT[this.townId] || "#888";

    // Subtle landmark zone tint to ground each building visually.
    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;
      this.landmarkPositions.set(lm.name, { x: cx, y: cy });
      if (lm.type !== "road") this.wanderPoints.push({ x: cx, y: cy });

      // Soft accent halo
      const g = this.add.graphics();
      g.fillStyle(Phaser.Display.Color.HexStringToColor(accent).color, 0.07);
      g.fillRoundedRect(lm.x - 4, lm.y - 4, lm.width + 8, lm.height + 8, 5);
      g.setDepth(43);

      // Rich programmatic building art
      drawLandmarkBuilding(this, lm, accent, this.townId);
    }

    // Programmatic collision rectangles for building landmarks.
    this.collisionGroup = this.physics.add.staticGroup();
    for (const lm of this.landmarks) {
      if (lm.type === "road" || lm.type === "park" || lm.type === "commercial-strip") continue;
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height * 0.7;
      const zone = this.add.zone(cx, cy, lm.width, lm.height * 0.6);
      this.physics.add.existing(zone, true);
      this.collisionGroup.add(zone);
    }

    // Add a grid of "street corner" waypoints for richer wandering
    this.addScatteredWaypoints(W, H);

    // Environment decorations (campfire, sparkles, lighting)
    this.buildEnvironmentFX();

    // NOTE: Streetlamps used to be placed here AND by SceneAmbience, which
    // doubled them along every road and read as a wall of orbs. SceneAmbience
    // is now the single source. Old in-scene streetlamps removed.
  }

  /** Place 6-10 streetlamps along roads and near commercial buildings. */
  private addStreetlamps() {
    // Clear stale lamps if any
    for (const l of this.streetlamps) l.group.destroy();
    this.streetlamps = [];

    const placed: Array<{ x: number; y: number }> = [];
    const tryAdd = (x: number, y: number) => {
      // Spacing constraint — keep at least 90 px between lamps
      for (const p of placed) {
        if (Math.hypot(p.x - x, p.y - y) < 90) return;
      }
      const lamp = drawStreetlamp(this, x, y);
      this.streetlamps.push(lamp);
      placed.push({ x, y });
    };

    // Along roads — at the two ends
    for (const lm of this.landmarks) {
      if (lm.type !== "road") continue;
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;
      const horizontal = lm.width >= lm.height;
      if (horizontal) {
        tryAdd(lm.x + 18, cy - lm.height / 2 - 4);
        tryAdd(lm.x + lm.width - 18, cy - lm.height / 2 - 4);
      } else {
        tryAdd(cx - lm.width / 2 - 4, lm.y + 18);
        tryAdd(cx - lm.width / 2 - 4, lm.y + lm.height - 18);
      }
    }

    // Near commercial buildings
    for (const lm of this.landmarks) {
      if (lm.type !== "commercial" && lm.type !== "building" && lm.type !== "commercial-strip") continue;
      tryAdd(lm.x - 8, lm.y + lm.height + 4);
      if (placed.length >= 10) break;
    }

    // Ensure at least 6 — back-fill near other landmarks
    if (placed.length < 6) {
      for (const lm of this.landmarks) {
        if (lm.type === "road") continue;
        tryAdd(lm.x + lm.width / 2, lm.y + lm.height + 6);
        if (placed.length >= 6) break;
      }
    }

    // Apply current time-of-day immediately
    this.applyStreetlampNight();
  }

  private applyStreetlampNight() {
    const h = this.worldClock.hour;
    const night = h >= 19 || h < 6;
    if (night === this.currentlyNight && this.streetlamps.length > 0) {
      // Initial pass still needs alpha set
    }
    this.currentlyNight = night;
    for (const l of this.streetlamps) l.setNight(night);
  }

  private buildEnvironmentFX() {
    if (!this.anims.exists("campfire-burn")) {
      this.anims.create({
        key: "campfire-burn",
        frames: this.anims.generateFrameNumbers("campfire", { start: 0, end: 3 }),
        frameRate: 7,
        repeat: -1,
      });
    }
    if (!this.anims.exists("sparkle-anim")) {
      this.anims.create({
        key: "sparkle-anim",
        frames: this.anims.generateFrameNumbers("sparkle", { start: 0, end: 3 }),
        frameRate: 4,
        repeat: -1,
      });
    }

    const hasWebGL = this.game.renderer.type === Phaser.WEBGL;

    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;

      if (lm.type === "park" && this.textures.exists("campfire")) {
        const fire = this.add.sprite(cx, cy, "campfire").setScale(1.4).setDepth(48).setAlpha(0.85);
        fire.play("campfire-burn");

        if (hasWebGL) {
          const pl = this.add.pointlight(cx, cy, 0xff8800, 120, 0.4, 0.06);
          pl.setDepth(48);
          this.tweens.add({
            targets: pl,
            intensity: { from: 0.25, to: 0.55 },
            radius: { from: 100, to: 140 },
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
        }
      }

      if (lm.type === "church" && this.textures.exists("sparkle")) {
        const sp = this.add.sprite(cx, lm.y + 8, "sparkle").setDepth(48).setAlpha(0.55);
        sp.play("sparkle-anim");

        if (hasWebGL) {
          const pl = this.add.pointlight(cx, lm.y + 8, 0xffd700, 80, 0.2, 0.08);
          pl.setDepth(48);
          this.tweens.add({
            targets: pl,
            intensity: { from: 0.15, to: 0.3 },
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
        }
      }
    }

    if (hasWebGL) {
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      const ambient = this.add.pointlight(W / 2, H / 2, 0xffe4b5, 600, 0.08, 0.01);
      ambient.setDepth(1);
    }
  }

  /* ── Sky tint refresh ───────────────────────────────────── */

  private refreshSkyOverlay() {
    if (!this.skyOverlay) return;
    const tint = WorldClock.computeDayNightTint(this.worldClock.fractionalHour());
    this.skyOverlay.setFillStyle(tint.color, tint.alpha);
  }

  /* ── Per-town flavor — papel-picado, ducks, dogs, leaves ── */

  private addTownFlavor(town: TownId) {
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
    // Papel-picado bunting between two random landmarks.
    const buildings = this.landmarks.filter((l) => l.type !== "road");
    if (buildings.length >= 2) {
      Phaser.Utils.Array.Shuffle(buildings);
      const a = buildings[0], b = buildings[1];
      const ax = a.x + a.width / 2, ay = a.y + 4;
      const bx = b.x + b.width / 2, by = b.y + 4;
      const colors = [0xff6f61, 0xffd166, 0x06d6a0, 0x118ab2, 0xef476f];
      const flagCount = 12;
      for (let i = 1; i < flagCount; i++) {
        const t = i / flagCount;
        // Catenary droop
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t + Math.sin(t * Math.PI) * 14;
        const flag = this.add.graphics();
        flag.fillStyle(colors[i % colors.length], 0.85);
        flag.fillTriangle(-4, 0, 4, 0, 0, 8);
        flag.setPosition(x, y).setDepth(60);
        this.tweens.add({ targets: flag, rotation: { from: -0.12, to: 0.12 }, duration: 1700 + i * 60, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    }

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
    this.time.addEvent({
      delay: 1100, loop: true,
      callback: () => this.spawnLeaf(W, H, [0xb9302a, 0xe25e3b, 0xd8a14a, 0xa84c6c]),
    });

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
    // Duck flies across Lake Parsippany every 30s
    const lake = this.landmarkPositions.get("Lake Parsippany");
    if (lake) {
      const fly = () => {
        const duck = this.add.graphics();
        duck.fillStyle(0x2f2417, 1);
        duck.fillEllipse(0, 0, 12, 6);
        duck.fillEllipse(6, -3, 5, 4);
        duck.lineStyle(2, 0xb88a52, 1);
        duck.setDepth(20).setPosition(-20, lake.y);
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
    leaf.setPosition(startX, -10).setDepth(80);
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

  private opinionColor(candidate?: string): string {
    switch (candidate) {
      case "mejia":    return "#3B82F6";
      case "hathaway": return "#EF4444";
      case "bond":     return "#9CA3AF";
      default:         return "#FFFFFF";
    }
  }
}

/** Deterministic PRNG so the ground texture is stable across reloads. */
function mulberry32Local(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reference unused customization to keep tree-shaking honest.
void AGENT_CUSTOMIZATION;

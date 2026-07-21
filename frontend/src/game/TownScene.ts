import Phaser from "phaser";
import { appUrl } from "../lib/assetUrl";
import { AgentSprite, type AgentActivity, type GestureKind } from "./AgentSprite";
import { PlayerSprite } from "./PlayerSprite";
import { townAccent, townMapKey } from "./config";
import type { AgentState, TownId, LandmarkData, TownData, WeatherKind } from "../types/messages";
import type { UserProfile } from "../context/UserProfileContext";
import { AGENT_CUSTOMIZATION, ALL_CHARACTER_KEYS, resolveAgentSprite } from "./spriteCustomization";
import { composeTownAmbience, type AmbienceHandle, type MapAnchor } from "./SceneAmbience";
import { WorldClock } from "./WorldClock";
import { Routine, type RoutineEntry } from "./Routine";
import { pickExchange } from "./AmbientLines";
import { landmarksFor } from "../hooks/useTownData";
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
  /** Blocked rectangles from the tilemap's "collision" object layer (px). */
  private collisionRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Live-detail anchors from the tilemap's "anchors" object layer. */
  private mapAnchors: MapAnchor[] = [];
  /** Landmark-name → grid-snapped label position from the map's label anchors. */
  private mapLabels: Map<string, { x: number; y: number }> = new Map();
  private townDataResolved = false;
  private playerSpawnPending: UserProfile | null = null;

  // World clock + sky overlay
  private worldClock = new WorldClock({ startHour: 8, minutesPerSecond: 1 });
  private skyOverlay?: Phaser.GameObjects.Rectangle;

  // Night-time lamp glow + sky tint are owned by SceneAmbience + the sky overlay.
  private ambience?: AmbienceHandle;

  // Encounter scheduling
  private encounterTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: "TownScene" });
  }

  init(data: { townId: TownId }) {
    this.townId = data.townId;
    // Inline fallback until /api/towns resolves — curated for NJ-11 towns,
    // a serviceable generic village for any other scenario's towns.
    this.landmarks = landmarksFor(this.townId).slice();
  }

  /* ── Preload ─────────────────────────────────────────────── */

  preload() {
    // Tileset images — shared by every generated town map. The rpg tileset
    // also feeds SceneAmbience's stamp textures (trees, lampposts, flowers).
    this.load.image("rpg-tileset", appUrl("assets/tilesets/rpg-tileset.png"));
    this.load.image("township-modern", appUrl("assets/tilesets/township-modern.png"));
    this.load.image("speech-bubble", appUrl("assets/speech_bubble/v2.png"));

    // Per-town generated tilemap (scripts/mapgen emits one per town).
    this.load.tilemapTiledJSON(townMapKey(this.townId), appUrl(`assets/maps/${this.townId}.tmj`));

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

    // Generate outfit/accessory overlay textures programmatically (FIX 17).
    this.generateOverlayTextures();

    // Tilemap — the generated pixel world (layers, collision, anchors).
    this.buildTilemap(W, H);

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
    this.ambience = composeTownAmbience(this, this.townId, this.mapAnchors, W, H);
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
      // SceneAmbience owns lamp glow + night tint; refresh at top of each hour.
      if (this.worldClock.hour !== prevHour) {
        this.ambience?.setHour(this.worldClock.hour);
      }
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

    const spawn = this.findFreeNear(
      base.x + Phaser.Math.Between(-55, 55),
      base.y + Phaser.Math.Between(-35, 35),
    );
    const sx = spawn.x;
    const sy = spawn.y;

    const custom = resolveAgentSprite(agent.id);

    const sprite = new AgentSprite(this, sx, sy, {
      id: agent.id,
      name: agent.name,
      initials: agent.initials ?? this.initials(agent.name),
      color: agent.color ?? townAccent(this.townId),
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
      topConcerns: agent.top_concerns ?? [],
      idleThoughts: agent.idle_thoughts ?? undefined,
    };
    this.agentRecords.set(agent.id, record);

    // If a routine is supplied, the clock tick drives motion. Otherwise we
    // fall back to randomized wandering.
    if (!record.routine) {
      const initDelay = Phaser.Math.Between(1500, 6000);
      this.time.delayedCall(initDelay, () => this.scheduleWander(agent.id));
    }
  }

  moveAgent(agentId: string, toLocation: string, x?: number, y?: number) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    // Prefer precise pixel coords when both are finite; else resolve by landmark.
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const t = this.findFreeNear(x as number, y as number);
      sprite.moveToPosition(t.x, t.y);
      return;
    }
    const base = this.landmarkPositions.get(toLocation) ?? this.wanderPoints[0] ?? { x: 400, y: 400 };
    const t = this.findFreeNear(
      base.x + Phaser.Math.Between(-50, 50),
      base.y + Phaser.Math.Between(-35, 35),
    );
    sprite.moveToPosition(t.x, t.y);
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
    this.ambience?.setHour(this.worldClock.hour);
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

    // Landmark labels — the generated map ships grid-snapped, centered label
    // anchors; prefer those (they sit exactly on the building the tiles
    // draw). Fall back to the town-JSON rect top for landmarks without one.
    // Labels hide whenever an agent is standing inside the landmark's bounds
    // so names never stack on top of characters.
    for (const lm of this.landmarks) {
      const anchor = this.mapLabels.get(lm.name);
      const cx = anchor ? anchor.x : lm.x + lm.width / 2;
      const cyTop = anchor ? anchor.y : lm.y - 8;
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
        .map(([id, s]) => ({ id, x: s.x, y: s.y, color: townAccent(this.townId) })),
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
    const spawn = this.findFreeNear(
      base.x + Phaser.Math.Between(-30, 30),
      base.y + Phaser.Math.Between(-20, 20),
    );
    const sx = spawn.x;
    const sy = spawn.y;

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

    // Camera follow with smooth lerp + closer zoom while a player is present.
    this.cameras.main.startFollow(this.playerSprite, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, Number(this.game.config.width), Number(this.game.config.height));
    this.cameras.main.zoomTo(1.5, 600, "Sine.easeInOut");

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
    if (this.wanderPoints.length === 0) return this.findFreeNear(400, 400);
    // Rejection-sample so NPCs stop walking into (through) buildings.
    for (let attempt = 0; attempt < 10; attempt++) {
      const pt = this.wanderPoints[Math.floor(Math.random() * this.wanderPoints.length)];
      const x = Phaser.Math.Clamp(pt.x + Phaser.Math.Between(-70, 70), 40, 1160);
      const y = Phaser.Math.Clamp(pt.y + Phaser.Math.Between(-45, 45), 40, 760);
      if (!this.isBlocked(x, y)) return { x, y };
    }
    const pt = this.wanderPoints[Math.floor(Math.random() * this.wanderPoints.length)];
    return this.findFreeNear(pt.x, pt.y);
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
      return;
    }

    const map = this.make.tilemap({ key: mapKey });
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const name of ["rpg-tileset", "township-modern"]) {
      const ts = map.addTilesetImage(name, name);
      if (ts) tilesets.push(ts);
    }
    if (tilesets.length === 0) return;

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
    if (this.playerSprite) return;
    const zoom = Math.max(this.scale.width / W, this.scale.height / H);
    cam.setZoom(zoom);
    cam.centerOn(W / 2, H / 2);
  }

  /** Recompute landmark positions + wander waypoints from this.landmarks.
   *  The visual world is the tilemap now — nothing is drawn here. */
  private rebuildLandmarks() {
    this.landmarkPositions.clear();
    this.wanderPoints = [];
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

  /** Nearest open point to (x, y) — ring-samples outward until unblocked. */
  private findFreeNear(x: number, y: number): { x: number; y: number } {
    const cx = Phaser.Math.Clamp(x, 40, 1160);
    const cy = Phaser.Math.Clamp(y, 40, 760);
    if (!this.isBlocked(cx, cy)) return { x: cx, y: cy };
    for (let radius = 24; radius <= 168; radius += 24) {
      // Try straight down first (doors face roads below buildings), then ring.
      const candidates: Array<{ x: number; y: number }> = [{ x: cx, y: cy + radius }];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        candidates.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
      }
      for (const c of candidates) {
        const px = Phaser.Math.Clamp(c.x, 40, 1160);
        const py = Phaser.Math.Clamp(c.y, 40, 760);
        if (!this.isBlocked(px, py)) return { x: px, y: py };
      }
    }
    return { x: cx, y: cy };
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
    // NOTE: the papel-picado bunting (strung between two random landmark
    // roofs) was dropped with the move to real tilemaps — over baked pixel
    // buildings the unstrung triangles read as floating confetti.

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

  /** Scenario option colors injected from React (non-NJ-11 scenarios). */
  private optionColors: Record<string, string> = {};

  /** Inject the active scenario's option→color map (see TownView). */
  setOptionColors(colors: Record<string, string>) {
    this.optionColors = colors || {};
  }

  private opinionColor(candidate?: string): string {
    if (candidate && this.optionColors[candidate]) return this.optionColors[candidate];
    switch (candidate) {
      case "mejia":    return "#3B82F6";
      case "hathaway": return "#EF4444";
      case "bond":     return "#9CA3AF";
      default:         return "#FFFFFF";
    }
  }
}

// Reference unused customization to keep tree-shaking honest.
void AGENT_CUSTOMIZATION;

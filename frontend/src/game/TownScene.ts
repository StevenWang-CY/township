import Phaser from "phaser";
import { AgentSprite } from "./AgentSprite";
import { PlayerSprite } from "./PlayerSprite";
import { TOWN_LANDMARKS, TOWN_ACCENT, type Landmark } from "./config";
import type { AgentState, TownId } from "../types/messages";
import type { UserProfile } from "../context/UserProfileContext";

/* ── Character sprite → Smallville asset mapping ────────────── */

const AGENT_SPRITE_MAP: Record<string, string> = {
  // Dover
  "carlos-restrepo": "Carlos_Gomez",
  "miguel-hernandez": "Francisco_Lopez",
  "maria-santos": "Carmen_Ortiz",
  "esperanza-guzman": "Isabella_Rodriguez",
  "sofia-ramirez": "Jane_Moreno",
  "tom-kowalski": "Tom_Moreno",
  // Montclair
  "sarah-&-david-chen": "Mei_Lin",
  "rosa-chen": "Yuriko_Yamamoto",
  "jordan-williams": "Latoya_Williams",
  "carmen-&-alejandro-vargas": "Maria_Lopez",
  "rabbi-daniel-goldstein": "Klaus_Mueller",
  "priya-patel": "Ayesha_Khan",
  "margaret-\"peggy\"-o'brien": "Jennifer_Moore",
  // Parsippany
  "raj-&-sunita-krishnamurthy": "Rajiv_Patel",
  "kantibhai-\"kanti\"-desai": "Giorgio_Rossi",
  "brian-mccarthy": "Sam_Moore",
  "aisha-&-omar-khan": "Abigail_Chen",
  "pawan-sharma": "Adam_Smith",
  "linda-morrison": "Hailey_Johnson",
  "grace-reyes": "Tamara_Taylor",
  // Randolph
  "michael-\"mike\"-brennan": "Arthur_Burton",
  "jennifer-\"jen\"-russo": "Jennifer_Moore",
  "frank-deluca": "Wolfgang_Schulz",
  "tyler-&-megan-hart": "Ryan_Park",
  "vikram-iyer": "Eddy_Lin",
  "tony-mancini": "John_Lin",
};

const FALLBACK_SPRITES = [
  "Carlos_Gomez", "Maria_Lopez", "Adam_Smith", "Abigail_Chen",
  "Tom_Moreno", "Hailey_Johnson", "Rajiv_Patel", "Tamara_Taylor",
];

// Brief "overheard" snippets agents display while wandering
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

/* ── TownScene ──────────────────────────────────────────────── */

export class TownScene extends Phaser.Scene {
  private townId: TownId = "dover";
  private agentSprites: Map<string, AgentSprite> = new Map();
  private playerSprite: PlayerSprite | null = null;
  private landmarks: Landmark[] = [];
  private landmarkPositions: Map<string, { x: number; y: number }> = new Map();
  private characterKeys: Set<string> = new Set();
  // Wander waypoints: all non-road landmark centers
  private wanderPoints: Array<{ x: number; y: number }> = [];
  // Tilemap collision layer for player physics
  private collisionLayer: Phaser.Tilemaps.TilemapLayer | null = null;

  constructor() {
    super({ key: "TownScene" });
  }

  init(data: { townId: TownId }) {
    this.townId = data.townId;
    this.landmarks = TOWN_LANDMARKS[this.townId] || [];
  }

  /* ── Preload ─────────────────────────────────────────────── */

  preload() {
    this.load.image("rpg-tileset", "/assets/tilesets/rpg-tileset.png");
    this.load.tilemapTiledJSON("town-map", "/assets/maps/tilemap.json");
    this.load.image("magecity-bg", "/assets/tilesets/magecity.png");
    this.load.image("speech-bubble", "/assets/speech_bubble/v2.png");

    this.load.spritesheet("campfire", "/assets/spritesheets/campfire.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("sparkle", "/assets/spritesheets/gentlesparkle32.png", { frameWidth: 32, frameHeight: 32 });

    // Character spritesheets (96 × 128 → 3 cols × 4 rows)
    const allChars = new Set([...Object.values(AGENT_SPRITE_MAP), ...FALLBACK_SPRITES]);
    for (const name of allChars) {
      this.load.spritesheet(`char-${name}`, `/assets/characters/${name}.png`, {
        frameWidth: 32,
        frameHeight: 32,
      });
      this.characterKeys.add(name);
    }

    // Folk spritesheet as additional fallback
    this.load.spritesheet("folk", "/assets/characters/32x32folk.png", { frameWidth: 32, frameHeight: 32 });

    // Player sprite (48×64 → 3 cols × 4 rows of 16×16 frames)
    this.load.spritesheet("char-player", "/assets/characters/player.png", {
      frameWidth: 16, frameHeight: 16,
    });
  }

  /* ── Create ──────────────────────────────────────────────── */

  create() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    // Tilemap
    this.buildTilemap(W, H);

    // Landmark overlays
    const accent = TOWN_ACCENT[this.townId] || "#888";
    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;
      this.landmarkPositions.set(lm.name, { x: cx, y: cy });
      if (lm.type !== "road") this.wanderPoints.push({ x: cx, y: cy });
      this.drawLandmarkLabel(lm, accent);
    }

    // Add extra wander points scattered around the map
    this.addScatteredWaypoints(W, H);

    // Environment decorations
    this.buildEnvironmentFX();

    // Character walk / idle animations
    this.createCharacterAnimations();
    this.createPlayerAnimations();

    // Ambient background passers-by
    this.spawnAmbientNPCs();

    // Ambient birds flying across sky
    this.scheduleBirds(W, H);

    // Town title banner
    this.buildTitleBanner(W);
  }

  /* ── Update (called every frame) ────────────────────────── */

  update(_time: number, delta: number) {
    // Y-based depth sort – characters "behind" others appear further back
    this.agentSprites.forEach((s) => s.syncDepth());
    this.playerSprite?.updatePlayer(delta);

    // Player ↔ tilemap collision (physics-enabled player only)
    if (this.playerSprite && this.collisionLayer) {
      this.physics.collide(this.playerSprite, this.collisionLayer);
    }
  }

  /* ── Agent Management (called from React / TownView) ──── */

  addAgent(agent: AgentState) {
    if (this.agentSprites.has(agent.id)) return;

    const base = this.landmarkPositions.get(agent.location) ??
      this.wanderPoints[0] ?? { x: 400, y: 400 };

    const sx = Phaser.Math.Clamp(base.x + Phaser.Math.Between(-55, 55), 40, 1160);
    const sy = Phaser.Math.Clamp(base.y + Phaser.Math.Between(-35, 35), 40, 760);

    const charName = AGENT_SPRITE_MAP[agent.id] ??
      FALLBACK_SPRITES[Math.floor(Math.random() * FALLBACK_SPRITES.length)];

    const sprite = new AgentSprite(this, sx, sy, {
      id: agent.id,
      name: agent.name,
      initials: agent.initials ?? this.initials(agent.name),
      color: agent.color ?? TOWN_ACCENT[this.townId] ?? "#888",
      town: agent.town,
      opinionColor: this.opinionColor(agent.opinion?.candidate),
      spriteKey: this.textures.exists(`char-${charName}`) ? `char-${charName}` : undefined,
    });

    this.agentSprites.set(agent.id, sprite);

    // Stagger autonomous wandering so agents don't all leave at once
    const initDelay = Phaser.Math.Between(1500, 6000);
    this.time.delayedCall(initDelay, () => this.scheduleWander(agent.id));
  }

  moveAgent(agentId: string, toLocation: string) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    const base = this.landmarkPositions.get(toLocation) ?? this.wanderPoints[0] ?? { x: 400, y: 400 };
    const tx = Phaser.Math.Clamp(base.x + Phaser.Math.Between(-50, 50), 40, 1160);
    const ty = Phaser.Math.Clamp(base.y + Phaser.Math.Between(-35, 35), 40, 760);
    sprite.moveToPosition(tx, ty);
  }

  showAgentSpeech(agentId: string, text: string, duration = 5000) {
    this.agentSprites.get(agentId)?.showSpeechBubble(text, duration);
  }

  updateAgentOpinion(agentId: string, candidate: string) {
    this.agentSprites.get(agentId)?.setOpinionColor(this.opinionColor(candidate));
  }

  showAgentEmote(agentId: string, type: "reflecting" | "opinion_changed") {
    this.agentSprites.get(agentId)?.showEmote(type);
  }

  /** Export all agent positions for the DOM overlay. */
  getOverlayData(): { id: string; name: string; x: number; y: number; visible: boolean; type: "agent" | "landmark" }[] {
    const data: { id: string; name: string; x: number; y: number; visible: boolean; type: "agent" | "landmark" }[] = [];

    // Agent labels
    this.agentSprites.forEach((sprite) => {
      const info = sprite.getOverlayInfo();
      data.push({ ...info, type: "agent" });
    });

    // Landmark labels (static positions)
    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;
      data.push({ id: `lm-${lm.name}`, name: lm.name, x: cx, y: cy, visible: true, type: "landmark" });
    }

    return data;
  }

  clearAgents() {
    this.agentSprites.forEach((s) => s.destroy());
    this.agentSprites.clear();
  }

  /* ── Player Management ──────────────────────────────────── */

  addPlayer(profile: UserProfile) {
    if (this.playerSprite) return; // already spawned

    // Spawn near the first landmark
    const firstLandmark = this.landmarks.find((l) => l.type !== "road") ?? this.landmarks[0];
    const base = firstLandmark
      ? { x: firstLandmark.x + firstLandmark.width / 2, y: firstLandmark.y + firstLandmark.height / 2 }
      : { x: 400, y: 400 };
    const sx = Phaser.Math.Clamp(base.x + Phaser.Math.Between(-30, 30), 60, 1140);
    const sy = Phaser.Math.Clamp(base.y + Phaser.Math.Between(-20, 20), 60, 740);

    const spriteKey = this.textures.exists("char-player") ? "char-player" : undefined;

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

  /* ── Autonomous Wandering ────────────────────────────────── */

  private scheduleWander(agentId: string) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite || !this.scene.isActive()) return;

    const idleDelay = Phaser.Math.Between(4000, 13000);
    this.time.delayedCall(idleDelay, () => {
      const sp = this.agentSprites.get(agentId);
      if (!sp) return;

      const target = this.pickWanderTarget();
      sp.moveToPosition(target.x, target.y, () => {
        // Occasionally show an idle thought after arriving
        if (Math.random() < 0.28) {
          const thought = IDLE_THOUGHTS[Math.floor(Math.random() * IDLE_THOUGHTS.length)];
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
    // Add a grid of "street corner" waypoints for richer wandering
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

  /* ── Character Animations ────────────────────────────────── */

  private createCharacterAnimations() {
    /**
     * 96 × 128 spritesheet → 3 cols × 4 rows = 12 frames:
     *   walk-down:  frames 0,1,2
     *   walk-left:  frames 3,4,5
     *   walk-right: frames 6,7,8
     *   walk-up:    frames 9,10,11
     */
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
        // Idle is handled as a stopped frame in AgentSprite, but create a subtle 2-frame
        // "breathe" that cycles the 3 walk frames very slowly for resting characters
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

  /** Create walk/idle animations for the player sprite (16×16 frames, same layout). */
  private createPlayerAnimations() {
    const key = "char-player";
    if (!this.textures.exists(key)) return;

    const dirs = [
      { name: "down", start: 0, end: 2, idle: 1 },
      { name: "left", start: 3, end: 5, idle: 4 },
      { name: "right", start: 6, end: 8, idle: 7 },
      { name: "up", start: 9, end: 11, idle: 10 },
    ];

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

  /* ── Ambient Background NPCs ──────────────────────────────── */

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

      const npc = this.add.sprite(sx, sy, key, 1);
      npc.setScale(1.9);
      npc.setOrigin(0.5, 1);
      npc.setDepth(50 + sy);
      npc.setAlpha(1); // fully opaque — visual hierarchy via scale, not alpha

      // Pick a random walk animation
      const dirs = ["down", "left", "right", "up"] as const;
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const walkKey = `${key}-walk-${dir}`;
      if (this.anims.exists(walkKey)) npc.play(walkKey);

      // Wander via tweens
      this.scheduleAmbientWander(npc, W, H);
    }
  }

  private scheduleAmbientWander(npc: Phaser.GameObjects.Sprite, W: number, H: number) {
    const delay = Phaser.Math.Between(2000, 9000);
    this.time.delayedCall(delay, () => {
      if (!npc.active) return;
      const tx = Phaser.Math.Between(80, W - 80);
      const ty = Phaser.Math.Between(120, H - 120);
      const dx = tx - npc.x;
      const dy = ty - npc.y;
      const dist = Math.hypot(dx, dy);

      // Choose direction animation
      let dir = "down";
      if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
      else dir = dy > 0 ? "down" : "up";
      const wKey = `${npc.texture.key}-walk-${dir}`;
      if (this.anims.exists(wKey)) npc.play(wKey, true);

      this.tweens.add({
        targets: npc,
        x: tx,
        y: ty,
        duration: Phaser.Math.Clamp(dist * 4, 700, 3000),
        ease: "Sine.easeInOut",
        onUpdate: () => npc.setDepth(50 + npc.y),
        onComplete: () => {
          npc.stop();
          npc.setFrame(1);
          this.scheduleAmbientWander(npc, W, H);
        },
      });
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
      // Simple "V" wings
      bird.lineBetween(-5, 0, 0, -3);
      bird.lineBetween(0, -3, 5, 0);
      bird.setPosition(x0, y);
      bird.setDepth(10);

      const duration = Phaser.Math.Between(6000, 12000);

      // Wing-flap via scale tween
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

      // Schedule next bird
      const nextDelay = Phaser.Math.Between(3000, 9000);
      this.time.delayedCall(nextDelay, launchBird);
    };

    // Start a few birds at staggered times
    for (let i = 0; i < 3; i++) {
      this.time.delayedCall(Phaser.Math.Between(1000, 5000), launchBird);
    }
  }

  /* ── Tilemap / Environment ───────────────────────────────── */

  private buildTilemap(W: number, H: number) {
    const map = this.make.tilemap({ key: "town-map" });
    const tileset = map.addTilesetImage("rpg-tileset", "rpg-tileset");
    if (tileset) {
      const scaleX = W / map.widthInPixels;
      const scaleY = H / map.heightInPixels;
      const scale = Math.max(scaleX, scaleY);

      const terrain = map.createLayer("terrain", tileset);
      const bridge = map.createLayer("bridge", tileset);
      const deco = map.createLayer("deco", tileset);

      terrain?.setScale(scale).setAlpha(0.92);
      bridge?.setScale(scale);
      deco?.setScale(scale);

      // Store terrain layer for player collision
      if (terrain) {
        this.collisionLayer = terrain;
        // Collide with water/wall tiles (tile index 0 = empty, exclude it)
        terrain.setCollisionByExclusion([-1, 0]);
      }
    }
  }

  private drawLandmarkLabel(lm: Landmark, accent: string) {
    const g = this.add.graphics();

    // Subtle zone tint (keep for visual grounding)
    g.fillStyle(Phaser.Display.Color.HexStringToColor(accent).color, 0.07);
    g.fillRoundedRect(lm.x - 4, lm.y - 4, lm.width + 8, lm.height + 8, 5);
    g.setDepth(45);

    // Text labels now rendered by DOM CanvasOverlay — no Phaser text here
  }

  private buildEnvironmentFX() {
    // Campfire at parks
    if (!this.anims.exists("campfire-burn")) {
      this.anims.create({
        key: "campfire-burn",
        frames: this.anims.generateFrameNumbers("campfire", { start: 0, end: 3 }),
        frameRate: 7,
        repeat: -1,
      });
    }
    // Sparkle at churches
    if (!this.anims.exists("sparkle-anim")) {
      this.anims.create({
        key: "sparkle-anim",
        frames: this.anims.generateFrameNumbers("sparkle", { start: 0, end: 3 }),
        frameRate: 4,
        repeat: -1,
      });
    }

    // Check if WebGL is available for PointLight support
    const hasWebGL = this.game.renderer.type === Phaser.WEBGL;

    for (const lm of this.landmarks) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;

      if (lm.type === "park" && this.textures.exists("campfire")) {
        const fire = this.add.sprite(cx, cy, "campfire").setScale(1.4).setDepth(12).setAlpha(0.85);
        fire.play("campfire-burn");

        if (hasWebGL) {
          // PointLight: warm orange atmospheric glow with pulse
          const pl = this.add.pointlight(cx, cy, 0xff8800, 120, 0.4, 0.06);
          pl.setDepth(11);
          this.tweens.add({
            targets: pl,
            intensity: { from: 0.25, to: 0.55 },
            radius: { from: 100, to: 140 },
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
        } else {
          // Fallback: Graphics-based warm light
          const light = this.add.graphics();
          light.fillStyle(0xff8800, 0.07);
          light.fillCircle(cx, cy, 40);
          light.setDepth(11);
          this.tweens.add({ targets: light, alpha: 0.01, duration: 600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        }
      }

      if (lm.type === "church" && this.textures.exists("sparkle")) {
        const sp = this.add.sprite(cx, lm.y + 8, "sparkle").setDepth(12).setAlpha(0.55);
        sp.play("sparkle-anim");

        if (hasWebGL) {
          // PointLight: golden subtle glow at churches
          const pl = this.add.pointlight(cx, lm.y + 8, 0xffd700, 80, 0.2, 0.08);
          pl.setDepth(11);
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

    // Global ambient warmth — large low-intensity centered PointLight
    if (hasWebGL) {
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      const ambient = this.add.pointlight(W / 2, H / 2, 0xffe4b5, 600, 0.08, 0.01);
      ambient.setDepth(1);
    }
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

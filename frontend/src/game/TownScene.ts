import Phaser from "phaser";
import { AgentSprite } from "./AgentSprite";
import { TOWN_LANDMARKS, TOWN_ACCENT, type Landmark } from "./config";
import type { AgentState, TownId } from "../types/messages";

/**
 * Character sprite mapping: Township agents → Smallville character PNGs.
 * Each Smallville character PNG is a 32×128 spritesheet (4 frames: down, left, right, up).
 * We assign each Township agent a visually appropriate Smallville character.
 */
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

// Fallback sprites for agents not in the map
const FALLBACK_SPRITES = [
  "Carlos_Gomez", "Maria_Lopez", "Adam_Smith", "Abigail_Chen",
  "Tom_Moreno", "Hailey_Johnson", "Rajiv_Patel", "Tamara_Taylor",
];

/* ── TownScene ──────────────────────────────────────────────── */

export class TownScene extends Phaser.Scene {
  private townId: TownId = "dover";
  private agentSprites: Map<string, AgentSprite> = new Map();
  private landmarks: Landmark[] = [];
  private landmarkPositions: Map<string, { x: number; y: number }> = new Map();
  private characterKeys: Set<string> = new Set();

  constructor() {
    super({ key: "TownScene" });
  }

  init(data: { townId: TownId }) {
    this.townId = data.townId;
    this.landmarks = TOWN_LANDMARKS[this.townId] || [];
  }

  preload() {
    // Load the ai-town tilemap and tileset
    this.load.image("rpg-tileset", "/assets/tilesets/rpg-tileset.png");
    this.load.tilemapTiledJSON("town-map", "/assets/maps/tilemap.json");

    // Load background image
    this.load.image("magecity-bg", "/assets/tilesets/magecity.png");

    // Load speech bubble
    this.load.image("speech-bubble", "/assets/speech_bubble/v2.png");

    // Load animated spritesheets
    this.load.spritesheet("campfire", "/assets/spritesheets/campfire.png", {
      frameWidth: 32, frameHeight: 32,
    });
    this.load.spritesheet("sparkle", "/assets/spritesheets/gentlesparkle32.png", {
      frameWidth: 32, frameHeight: 32,
    });

    // Load all character sprites (Smallville format: 32x128, 4 frames vertically)
    const allChars = new Set(Object.values(AGENT_SPRITE_MAP));
    FALLBACK_SPRITES.forEach(s => allChars.add(s));

    for (const charName of allChars) {
      this.load.spritesheet(`char-${charName}`, `/assets/characters/${charName}.png`, {
        frameWidth: 32,
        frameHeight: 32,
      });
      this.characterKeys.add(charName);
    }

    // Also load the ai-town folk spritesheet as fallback
    this.load.spritesheet("folk", "/assets/characters/32x32folk.png", {
      frameWidth: 32, frameHeight: 32,
    });
  }

  create() {
    const w = Number(this.game.config.width);
    const h = Number(this.game.config.height);
    const accent = TOWN_ACCENT[this.townId] || "#888";

    // Try to load the tilemap
    const map = this.make.tilemap({ key: "town-map" });
    if (map) {
      const tileset = map.addTilesetImage("rpg-tileset", "rpg-tileset");
      if (tileset) {
        // Scale tilemap to fill the game area (40x40 @ 16px = 640px, scale to 1200x800)
        const scaleX = w / (map.widthInPixels);
        const scaleY = h / (map.heightInPixels);
        const scale = Math.max(scaleX, scaleY);

        // Create tile layers
        const terrainLayer = map.createLayer("terrain", tileset);
        const bridgeLayer = map.createLayer("bridge", tileset);
        const decoLayer = map.createLayer("deco", tileset);

        if (terrainLayer) {
          terrainLayer.setScale(scale);
          terrainLayer.setAlpha(0.9);
        }
        if (bridgeLayer) {
          bridgeLayer.setScale(scale);
        }
        if (decoLayer) {
          decoLayer.setScale(scale);
        }
      }
    }

    // Draw landmark overlay labels on top of tilemap
    for (const lm of this.landmarks) {
      this.landmarkPositions.set(lm.name, {
        x: lm.x + lm.width / 2,
        y: lm.y + lm.height / 2,
      });
      this.drawLandmarkLabel(lm, accent);
    }

    // Add animated environment decorations
    this.addEnvironmentDecorations();

    // Title banner
    const townNames: Record<string, string> = {
      dover: "Dover",
      montclair: "Montclair",
      parsippany: "Parsippany-Troy Hills",
      randolph: "Randolph",
    };

    // Semi-transparent title bar
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x000000, 0.3);
    titleBg.fillRoundedRect(w / 2 - 120, 6, 240, 30, 8);

    this.add
      .text(w / 2, 20, townNames[this.townId] || this.townId, {
        fontFamily: "Playfair Display, Georgia, serif",
        fontSize: "18px",
        fontStyle: "bold",
        color: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(100);

    // Create walk animations for each character
    this.createCharacterAnimations();
  }

  private drawLandmarkLabel(lm: Landmark, accent: string) {
    // Semi-transparent label background
    const g = this.add.graphics();
    const cx = lm.x + lm.width / 2;
    const cy = lm.y + lm.height / 2;

    // Highlight zone (subtle)
    g.fillStyle(
      Phaser.Display.Color.HexStringToColor(accent).color,
      0.08,
    );
    g.fillRoundedRect(lm.x - 5, lm.y - 5, lm.width + 10, lm.height + 10, 6);

    // Label background
    const labelWidth = Math.max(lm.name.length * 6.5, 60);
    g.fillStyle(0x000000, 0.5);
    g.fillRoundedRect(cx - labelWidth / 2, cy - 8, labelWidth, 16, 4);

    // Label text
    this.add
      .text(cx, cy, lm.name, {
        fontFamily: "Inter, sans-serif",
        fontSize: "10px",
        fontStyle: "bold",
        color: "#FFFFFF",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(50);
  }

  private addEnvironmentDecorations() {
    // Add campfire animations at park locations
    for (const lm of this.landmarks) {
      if (lm.type === "park") {
        try {
          if (!this.anims.exists("campfire-burn")) {
            this.anims.create({
              key: "campfire-burn",
              frames: this.anims.generateFrameNumbers("campfire", { start: 0, end: 3 }),
              frameRate: 6,
              repeat: -1,
            });
          }
          const fire = this.add.sprite(
            lm.x + lm.width / 2,
            lm.y + lm.height / 2,
            "campfire",
          );
          fire.setScale(1.5);
          fire.play("campfire-burn");
          fire.setDepth(10);
        } catch {
          // Asset may not have loaded
        }
      }

      // Sparkle at churches/temples
      if (lm.type === "church") {
        try {
          if (!this.anims.exists("sparkle-anim")) {
            this.anims.create({
              key: "sparkle-anim",
              frames: this.anims.generateFrameNumbers("sparkle", { start: 0, end: 3 }),
              frameRate: 4,
              repeat: -1,
            });
          }
          const sparkle = this.add.sprite(
            lm.x + lm.width / 2,
            lm.y + 10,
            "sparkle",
          );
          sparkle.play("sparkle-anim");
          sparkle.setDepth(10);
          sparkle.setAlpha(0.6);
        } catch {
          // Asset may not have loaded
        }
      }
    }
  }

  private createCharacterAnimations() {
    // Create walk animations for each loaded character spritesheet
    // Smallville characters are 32x32 spritesheets with multiple rows
    for (const charName of this.characterKeys) {
      const key = `char-${charName}`;
      try {
        // Down walk (row 0)
        if (!this.anims.exists(`${key}-down`)) {
          this.anims.create({
            key: `${key}-down`,
            frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }),
            frameRate: 6,
            repeat: -1,
          });
        }
        // Idle (first frame)
        if (!this.anims.exists(`${key}-idle`)) {
          this.anims.create({
            key: `${key}-idle`,
            frames: [{ key, frame: 0 }],
            frameRate: 1,
          });
        }
      } catch {
        // Some spritesheets may have different formats
      }
    }
  }

  /* ── Agent Management (called from React) ────────────────── */

  addAgent(agent: AgentState) {
    if (this.agentSprites.has(agent.id)) return;

    const pos = this.getAgentPosition(agent.location);
    const jx = pos.x + (Math.random() - 0.5) * 50;
    const jy = pos.y + (Math.random() - 0.5) * 40;

    // Determine which character sprite to use
    const charName = AGENT_SPRITE_MAP[agent.id];
    const spriteKey = charName ? `char-${charName}` : undefined;

    const sprite = new AgentSprite(this, jx, jy, {
      id: agent.id,
      name: agent.name,
      initials: agent.initials || this.getInitials(agent.name),
      color: agent.color || TOWN_ACCENT[this.townId] || "#888",
      town: agent.town,
      opinionColor: this.getOpinionColor(agent.opinion?.candidate),
      spriteKey,
    });

    this.agentSprites.set(agent.id, sprite);
  }

  moveAgent(agentId: string, toLocation: string) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    const pos = this.getAgentPosition(toLocation);
    const jx = pos.x + (Math.random() - 0.5) * 50;
    const jy = pos.y + (Math.random() - 0.5) * 40;
    sprite.moveToPosition(jx, jy);
  }

  showAgentSpeech(agentId: string, text: string, duration = 4000) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    sprite.showSpeechBubble(text, duration);
  }

  updateAgentOpinion(agentId: string, candidate: string) {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;
    sprite.setOpinionColor(this.getOpinionColor(candidate));
  }

  clearAgents() {
    this.agentSprites.forEach((s) => s.destroy());
    this.agentSprites.clear();
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  private getAgentPosition(location: string): { x: number; y: number } {
    const pos = this.landmarkPositions.get(location);
    if (pos) return pos;
    for (const lm of this.landmarks) {
      if (lm.type !== "road") {
        return { x: lm.x + lm.width / 2, y: lm.y + lm.height / 2 };
      }
    }
    return { x: 400, y: 400 };
  }

  private getInitials(name: string): string {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  private getOpinionColor(candidate?: string): string {
    switch (candidate) {
      case "mejia":
        return "#3B82F6";
      case "hathaway":
        return "#EF4444";
      case "bond":
        return "#9CA3AF";
      default:
        return "#FFFFFF";
    }
  }
}

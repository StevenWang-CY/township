import Phaser from "phaser";
import { AgentSprite } from "./AgentSprite";
import type { TownId, PoliticalRegistration } from "../types/messages";
import { TOWN_META } from "../types/messages";
import { TOWN_ACCENT } from "./config";

/**
 * OnboardingScene — NPC-guided onboarding using real tilemap + character sprites.
 *
 * The user "arrives" in a cozy corner of the town. NPC greeter Rosa walks up
 * and guides them through a conversational onboarding. At each step, either
 * Phaser UI elements (for multiple-choice) or React overlays (for text input)
 * collect the user's responses.
 */

type OnboardingStep = "intro" | "name" | "town" | "leaning" | "concerns" | "personality" | "complete";

const GREETER_SPRITE = "Tamara_Taylor";
const PLAYER_TEMP_SPRITE = "Adam_Smith";

const CONCERNS = [
  { key: "healthcare", label: "Healthcare", dot: "#EF4444" },
  { key: "immigration", label: "Immigration", dot: "#F59E0B" },
  { key: "taxes", label: "Taxes", dot: "#10B981" },
  { key: "education", label: "Education", dot: "#6366F1" },
  { key: "housing", label: "Housing", dot: "#EC4899" },
  { key: "economy", label: "Economy", dot: "#14B8A6" },
  { key: "safety", label: "Public Safety", dot: "#F97316" },
  { key: "environment", label: "Environment", dot: "#22C55E" },
];

const LEANINGS: Array<{ key: PoliticalRegistration; label: string; color: number; colorHex: string }> = [
  { key: "democrat", label: "Democrat", color: 0x3b82f6, colorHex: "#3B82F6" },
  { key: "republican", label: "Republican", color: 0xef4444, colorHex: "#EF4444" },
  { key: "unaffiliated", label: "Independent", color: 0x9ca3af, colorHex: "#9CA3AF" },
];

export class OnboardingScene extends Phaser.Scene {
  private currentStep: OnboardingStep = "intro";
  private greeter?: AgentSprite;
  private playerChar?: AgentSprite;
  private uiGroup?: Phaser.GameObjects.Container;

  // Collected onboarding data
  private userName = "";
  private userTown: TownId = "dover";
  private userLeaning: PoliticalRegistration = "unaffiliated";
  private userConcerns: string[] = [];
  private userPersonality = "";

  // Pre-selected town from URL query param
  private preselectedTown: TownId | null = null;

  constructor() {
    super({ key: "OnboardingScene" });
  }

  init(data: { preselectedTown?: TownId }) {
    this.preselectedTown = data.preselectedTown ?? null;
    if (this.preselectedTown) this.userTown = this.preselectedTown;
  }

  /* ── Preload (reuse all existing assets) ─────────────────── */

  preload() {
    this.load.image("rpg-tileset", "/assets/tilesets/rpg-tileset.png");
    this.load.tilemapTiledJSON("town-map", "/assets/maps/tilemap.json");
    this.load.spritesheet("campfire", "/assets/spritesheets/campfire.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("sparkle", "/assets/spritesheets/gentlesparkle32.png", { frameWidth: 32, frameHeight: 32 });

    // Character spritesheets
    for (const name of [GREETER_SPRITE, PLAYER_TEMP_SPRITE]) {
      this.load.spritesheet(`char-${name}`, `/assets/characters/${name}.png`, {
        frameWidth: 32, frameHeight: 32,
      });
    }
  }

  /* ── Create ──────────────────────────────────────────────── */

  create() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    // ── Tilemap background ──────────────────────────────────
    this.buildTilemap(W, H);

    // ── Warm ambient overlay ────────────────────────────────
    const warmOverlay = this.add.graphics();
    warmOverlay.fillStyle(0xf5ecd7, 0.15);
    warmOverlay.fillRect(0, 0, W, H);
    warmOverlay.setDepth(1);

    // ── Campfire at center-left ─────────────────────────────
    this.buildAmbientFX(W, H);

    // ── Character animations ────────────────────────────────
    this.createAnimations(GREETER_SPRITE);
    this.createAnimations(PLAYER_TEMP_SPRITE);

    // ── Player character (standing near campfire) ────────────
    const playerX = W * 0.42;
    const playerY = H * 0.52;

    this.playerChar = new AgentSprite(this, playerX, playerY, {
      id: "onboarding-player",
      name: "You",
      initials: "?",
      color: "#3B5998",
      town: "dover",
      spriteKey: this.textures.exists(`char-${PLAYER_TEMP_SPRITE}`) ? `char-${PLAYER_TEMP_SPRITE}` : undefined,
    });

    // ── Birds ───────────────────────────────────────────────
    this.scheduleBirds(W, H);

    // ── Ambient NPCs in background ──────────────────────────
    this.spawnAmbientNPCs(W, H);

    // ── UI container for overlays ───────────────────────────
    this.uiGroup = this.add.container(0, 0).setDepth(300);

    // ── Fade in from black ──────────────────────────────────
    this.cameras.main.fadeIn(1200, 0, 0, 0);

    // ── Camera zoom to create cozy feel ─────────────────────
    this.cameras.main.setZoom(1.25);
    this.cameras.main.centerOn(W * 0.5, H * 0.5);

    // ── Start the onboarding sequence ───────────────────────
    this.time.delayedCall(1200, () => this.startGreeterEntrance());
  }

  /* ── Onboarding Flow ────────────────────────────────────── */

  private startGreeterEntrance() {
    const W = Number(this.game.config.width);
    const H = Number(this.game.config.height);

    // Rosa enters from the right
    const startX = W * 0.85;
    const targetX = W * 0.55;
    const y = H * 0.52;

    this.greeter = new AgentSprite(this, startX, y, {
      id: "rosa-greeter",
      name: "Rosa",
      initials: "R",
      color: "#E8763B",
      town: "dover",
      spriteKey: this.textures.exists(`char-${GREETER_SPRITE}`) ? `char-${GREETER_SPRITE}` : undefined,
    });

    // Walk toward the player
    this.greeter.moveToPosition(targetX, y, () => {
      // Sparkle burst on arrival
      this.spawnSparkles(targetX, y - 40, 3);

      this.time.delayedCall(400, () => {
        this.greeter?.showSpeechBubble("Welcome to Township!", 2500);
        this.time.delayedCall(3000, () => {
          this.greeter?.showSpeechBubble("I'm Rosa — what's your name?", 4000);
          this.time.delayedCall(1500, () => {
            this.currentStep = "name";
            this.events.emit("onboarding-need-input", {
              step: "name",
              prompt: "What's your name?",
            });
          });
        });
      });
    });
  }

  /** Called by React when the user submits a text input. */
  receiveInput(step: string, value: string) {
    if (step === "name") {
      this.userName = value.trim();
      this.greeter?.showSpeechBubble(`Nice to meet you, ${this.userName}!`, 2500);

      this.time.delayedCall(3000, () => {
        if (this.preselectedTown) {
          // Skip town selection if pre-selected
          this.greeter?.showSpeechBubble(`${TOWN_META[this.preselectedTown].name} — great place!`, 2500);
          this.time.delayedCall(3000, () => this.showLeaningSelection());
        } else {
          this.showTownSelection();
        }
      });
    } else if (step === "personality") {
      this.userPersonality = value.trim();
      this.completeOnboarding();
    }
  }

  /* ── Town Selection (Phaser UI) ─────────────────────────── */

  private showTownSelection() {
    this.currentStep = "town";
    this.greeter?.showSpeechBubble("Where in the district are you from?", 4000);

    this.time.delayedCall(800, () => {
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      const container = this.add.container(0, 0).setDepth(350);

      const towns: TownId[] = ["dover", "montclair", "parsippany", "randolph"];
      const cardWidth = 130;
      const gap = 16;
      const totalWidth = towns.length * cardWidth + (towns.length - 1) * gap;
      const startX = (W - totalWidth) / 2 + cardWidth / 2;
      const y = H * 0.78;

      towns.forEach((townId, i) => {
        const cx = startX + i * (cardWidth + gap);
        const card = this.createTownCard(townId, cx, y);

        // Staggered entrance
        card.setScale(0.8);
        card.setAlpha(0);
        this.tweens.add({
          targets: card,
          scaleX: 1, scaleY: 1, alpha: 1,
          duration: 220,
          delay: i * 90,
          ease: "Back.easeOut",
        });

        container.add(card);
      });

      this.uiGroup?.add(container);
      (this as any)._townContainer = container;
    });
  }

  private createTownCard(townId: TownId, x: number, y: number): Phaser.GameObjects.Container {
    const meta = TOWN_META[townId];
    const accent = TOWN_ACCENT[townId] || meta.color;
    const accentNum = Phaser.Display.Color.HexStringToColor(accent).color;
    const card = this.add.container(x, y);

    const w = 120, h = 56, r = 10;

    // Shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.08);
    shadow.fillRoundedRect(-w / 2 + 2, 3, w, h, r);
    card.add(shadow);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(accentNum, 0.1);
    bg.fillRoundedRect(-w / 2, 0, w, h, r);
    bg.fillStyle(0xffffff, 0.75);
    bg.fillRoundedRect(-w / 2, 0, w, h, r);
    bg.lineStyle(1.5, accentNum, 0.35);
    bg.strokeRoundedRect(-w / 2, 0, w, h, r);
    card.add(bg);

    // Color dot
    const dot = this.add.graphics();
    dot.fillStyle(accentNum, 1);
    dot.fillCircle(-w / 2 + 16, 16, 5);
    card.add(dot);

    // Town name
    const name = this.add.text(-w / 2 + 26, 10, meta.name, {
      fontFamily: "Inter, sans-serif",
      fontSize: "11px",
      fontStyle: "bold",
      color: "#2C2416",
      resolution: 2,
    });
    card.add(name);

    // Tagline
    const tagline = this.add.text(-w / 2 + 12, 30, meta.tagline, {
      fontFamily: "Inter, sans-serif",
      fontSize: "8px",
      color: "#6B5E4F",
      resolution: 2,
    });
    card.add(tagline);

    // Population
    const pop = this.add.text(-w / 2 + 12, 42, `Pop. ${meta.population}`, {
      fontFamily: "Inter, sans-serif",
      fontSize: "7px",
      color: accent,
      fontStyle: "bold",
      resolution: 2,
    });
    card.add(pop);

    // Interaction
    card.setSize(w, h);
    card.setInteractive({ cursor: "pointer" });

    card.on("pointerover", () => {
      this.tweens.add({ targets: card, y: y - 3, scaleX: 1.05, scaleY: 1.05, duration: 120, ease: "Back.easeOut" });
      bg.clear();
      bg.fillStyle(accentNum, 0.15);
      bg.fillRoundedRect(-w / 2, 0, w, h, r);
      bg.fillStyle(0xffffff, 0.85);
      bg.fillRoundedRect(-w / 2, 0, w, h, r);
      bg.lineStyle(2, accentNum, 0.7);
      bg.strokeRoundedRect(-w / 2, 0, w, h, r);
    });

    card.on("pointerout", () => {
      this.tweens.add({ targets: card, y, scaleX: 1, scaleY: 1, duration: 120, ease: "Back.easeOut" });
      bg.clear();
      bg.fillStyle(accentNum, 0.1);
      bg.fillRoundedRect(-w / 2, 0, w, h, r);
      bg.fillStyle(0xffffff, 0.75);
      bg.fillRoundedRect(-w / 2, 0, w, h, r);
      bg.lineStyle(1.5, accentNum, 0.35);
      bg.strokeRoundedRect(-w / 2, 0, w, h, r);
    });

    card.on("pointerdown", () => {
      this.userTown = townId;

      // Select animation
      this.tweens.add({
        targets: card, scaleX: 0.93, scaleY: 0.93,
        duration: 80, yoyo: true, ease: "Quad.easeOut",
      });

      // Ripple burst
      this.spawnRipple(x, y + h / 2, accentNum);

      // Fade out all cards
      const cont = (this as any)._townContainer as Phaser.GameObjects.Container;
      this.time.delayedCall(300, () => {
        this.tweens.add({
          targets: cont, alpha: 0, y: cont.y + 20,
          duration: 250, ease: "Quad.easeIn",
          onComplete: () => cont.destroy(),
        });

        this.greeter?.showSpeechBubble(`${meta.name} — great place!`, 2500);
        this.time.delayedCall(3000, () => this.showLeaningSelection());
      });
    });

    return card;
  }

  /* ── Political Leaning Selection ────────────────────────── */

  private showLeaningSelection() {
    this.currentStep = "leaning";
    this.greeter?.showSpeechBubble("Everyone has their own views. How about you?", 4000);

    this.time.delayedCall(800, () => {
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      const container = this.add.container(0, 0).setDepth(350);

      const pillWidth = 110;
      const gap = 14;
      const totalWidth = LEANINGS.length * pillWidth + (LEANINGS.length - 1) * gap;
      const startX = (W - totalWidth) / 2 + pillWidth / 2;
      const y = H * 0.78;

      LEANINGS.forEach((lean, i) => {
        const cx = startX + i * (pillWidth + gap);
        const pill = this.createLeaningPill(lean, cx, y, container);

        pill.setScale(0.8);
        pill.setAlpha(0);
        this.tweens.add({
          targets: pill, scaleX: 1, scaleY: 1, alpha: 1,
          duration: 220, delay: i * 90, ease: "Back.easeOut",
        });

        container.add(pill);
      });

      this.uiGroup?.add(container);
      (this as any)._leanContainer = container;
    });
  }

  private createLeaningPill(
    lean: typeof LEANINGS[number],
    x: number, y: number,
    parent: Phaser.GameObjects.Container,
  ): Phaser.GameObjects.Container {
    const pill = this.add.container(x, y);
    const w = 100, h = 34, r = 17;

    // Shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.1);
    shadow.fillRoundedRect(-w / 2 + 2, 2, w, h, r);
    pill.add(shadow);

    // Background gradient-like (darker bottom)
    const bg = this.add.graphics();
    bg.fillStyle(lean.color, 0.85);
    bg.fillRoundedRect(-w / 2, 0, w, h, r);
    // Lighter top
    bg.fillStyle(0xffffff, 0.18);
    bg.fillRoundedRect(-w / 2 + 2, 1, w - 4, h * 0.45, { tl: r - 2, tr: r - 2, bl: 0, br: 0 });
    pill.add(bg);

    // Label
    const text = this.add.text(0, h / 2, lean.label, {
      fontFamily: "Inter, sans-serif",
      fontSize: "11px",
      fontStyle: "bold",
      color: "#ffffff",
      resolution: 2,
    });
    text.setOrigin(0.5, 0.5);
    pill.add(text);

    pill.setSize(w, h);
    pill.setInteractive({ cursor: "pointer" });

    pill.on("pointerover", () => {
      this.tweens.add({ targets: pill, y: y - 2, scaleX: 1.06, scaleY: 1.06, duration: 100, ease: "Back.easeOut" });
    });
    pill.on("pointerout", () => {
      this.tweens.add({ targets: pill, y, scaleX: 1, scaleY: 1, duration: 100, ease: "Back.easeOut" });
    });

    pill.on("pointerdown", () => {
      this.userLeaning = lean.key;

      // Select pulse
      this.tweens.add({
        targets: pill, scaleX: 1.1, scaleY: 1.1,
        duration: 150, yoyo: true, ease: "Back.easeOut",
      });

      this.spawnRipple(x, y + h / 2, lean.color);

      // Fade out
      const cont = (this as any)._leanContainer as Phaser.GameObjects.Container;
      this.time.delayedCall(350, () => {
        this.tweens.add({
          targets: cont, alpha: 0, y: cont.y + 20,
          duration: 250, ease: "Quad.easeIn",
          onComplete: () => cont.destroy(),
        });

        this.greeter?.showSpeechBubble("Understood. We've got all kinds here.", 2500);
        this.time.delayedCall(3000, () => this.showConcernsSelection());
      });
    });

    return pill;
  }

  /* ── Concerns Selection (multi-select chips) ────────────── */

  private showConcernsSelection() {
    this.currentStep = "concerns";
    this.userConcerns = [];
    this.greeter?.showSpeechBubble("What keeps you up at night? Pick 2-3.", 5000);

    this.time.delayedCall(800, () => {
      const W = Number(this.game.config.width);
      const H = Number(this.game.config.height);
      const container = this.add.container(0, 0).setDepth(350);

      const chipW = 110, chipH = 28, gap = 8;
      const cols = 4, rows = 2;
      const totalW = cols * chipW + (cols - 1) * gap;
      const startX = (W - totalW) / 2 + chipW / 2;
      const startY = H * 0.72;

      const selected = new Set<string>();
      const chips: Array<{ container: Phaser.GameObjects.Container; key: string; bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; check: Phaser.GameObjects.Text | undefined }> = [];

      CONCERNS.forEach((concern, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = startX + col * (chipW + gap);
        const cy = startY + row * (chipH + gap);

        const chip = this.add.container(cx, cy);
        const r = 8;

        const bg = this.add.graphics();
        this.drawChipBg(bg, chipW, chipH, r, false, concern.dot);
        chip.add(bg);

        // Colored dot
        const dot = this.add.graphics();
        dot.fillStyle(Phaser.Display.Color.HexStringToColor(concern.dot).color, 1);
        dot.fillCircle(-chipW / 2 + 12, chipH / 2, 3.5);
        chip.add(dot);

        const text = this.add.text(-chipW / 2 + 20, chipH / 2, concern.label, {
          fontFamily: "Inter, sans-serif",
          fontSize: "9px",
          color: "#6B5E4F",
          resolution: 2,
        });
        text.setOrigin(0, 0.5);
        chip.add(text);

        chip.setSize(chipW, chipH);
        chip.setInteractive({ cursor: "pointer" });

        // Stagger in
        chip.setScale(0.85);
        chip.setAlpha(0);
        this.tweens.add({
          targets: chip, scaleX: 1, scaleY: 1, alpha: 1,
          duration: 180, delay: i * 50, ease: "Back.easeOut",
        });

        const chipData = { container: chip, key: concern.key, bg, text, check: undefined as Phaser.GameObjects.Text | undefined };
        chips.push(chipData);

        chip.on("pointerover", () => {
          if (!selected.has(concern.key)) {
            bg.clear();
            this.drawChipBg(bg, chipW, chipH, r, false, concern.dot, true);
          }
        });
        chip.on("pointerout", () => {
          if (!selected.has(concern.key)) {
            bg.clear();
            this.drawChipBg(bg, chipW, chipH, r, false, concern.dot);
          }
        });

        chip.on("pointerdown", () => {
          if (selected.has(concern.key)) {
            selected.delete(concern.key);
            bg.clear();
            this.drawChipBg(bg, chipW, chipH, r, false, concern.dot);
            text.setColor("#6B5E4F");
            text.setFontStyle("normal");
            chipData.check?.destroy();
            chipData.check = undefined;
          } else if (selected.size < 3) {
            selected.add(concern.key);
            bg.clear();
            this.drawChipBg(bg, chipW, chipH, r, true, concern.dot);
            text.setColor("#2C2416");
            text.setFontStyle("bold");

            // Checkmark
            const check = this.add.text(chipW / 2 - 6, chipH / 2, "✓", {
              fontFamily: "Inter, sans-serif",
              fontSize: "10px",
              fontStyle: "bold",
              color: "#3B5998",
              resolution: 2,
            });
            check.setOrigin(0.5, 0.5);
            check.setScale(0);
            this.tweens.add({ targets: check, scaleX: 1, scaleY: 1, duration: 150, ease: "Back.easeOut" });
            chip.add(check);
            chipData.check = check;

            // Squish feedback
            this.tweens.add({ targets: chip, scaleX: 0.94, scaleY: 0.94, duration: 60, yoyo: true, ease: "Quad.easeOut" });
          }

          this.userConcerns = [...selected];

          // Show/hide continue button
          if (selected.size >= 2 && !(this as any)._continueBtn) {
            this.showContinueButton(container, W, startY + rows * (chipH + gap) + 16);
          } else if (selected.size < 2 && (this as any)._continueBtn) {
            ((this as any)._continueBtn as Phaser.GameObjects.Container).destroy();
            (this as any)._continueBtn = undefined;
          }
        });

        container.add(chip);
      });

      this.uiGroup?.add(container);
      (this as any)._concernsContainer = container;
    });
  }

  private drawChipBg(
    g: Phaser.GameObjects.Graphics, w: number, h: number, r: number,
    selected: boolean, _dotColor: string, hover = false,
  ) {
    const civicBlue = 0x3b5998;

    if (selected) {
      g.fillStyle(civicBlue, 0.1);
      g.fillRoundedRect(-w / 2, 0, w, h, r);
      g.lineStyle(1.5, civicBlue, 0.6);
      g.strokeRoundedRect(-w / 2, 0, w, h, r);
    } else {
      g.fillStyle(0xffffff, 0.85);
      g.fillRoundedRect(-w / 2, 0, w, h, r);
      g.lineStyle(1, hover ? civicBlue : 0xd4cfc6, hover ? 0.5 : 0.6);
      g.strokeRoundedRect(-w / 2, 0, w, h, r);
    }
  }

  private showContinueButton(parent: Phaser.GameObjects.Container, x: number, y: number) {
    const btn = this.add.container(x / 2, y);
    const w = 100, h = 32, r = 8;

    const bg = this.add.graphics();
    // Shadow
    bg.fillStyle(0x000000, 0.1);
    bg.fillRoundedRect(-w / 2 + 1, 2, w, h, r);
    // Fill
    bg.fillStyle(0x3b5998, 1);
    bg.fillRoundedRect(-w / 2, 0, w, h, r);
    // Highlight
    bg.fillStyle(0xffffff, 0.15);
    bg.fillRoundedRect(-w / 2 + 2, 1, w - 4, h * 0.45, { tl: r - 1, tr: r - 1, bl: 0, br: 0 });
    btn.add(bg);

    const text = this.add.text(0, h / 2, "Continue", {
      fontFamily: "Inter, sans-serif",
      fontSize: "11px",
      fontStyle: "bold",
      color: "#ffffff",
      resolution: 2,
    });
    text.setOrigin(0.5, 0.5);
    btn.add(text);

    btn.setSize(w, h);
    btn.setInteractive({ cursor: "pointer" });

    // Entrance
    btn.setAlpha(0);
    btn.setScale(0.9);
    this.tweens.add({ targets: btn, alpha: 1, scaleX: 1, scaleY: 1, duration: 200, ease: "Back.easeOut" });

    // Gentle pulse
    this.tweens.add({
      targets: btn, scaleX: 1.03, scaleY: 1.03,
      duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });

    btn.on("pointerover", () => {
      this.tweens.add({ targets: btn, scaleX: 1.06, scaleY: 1.06, duration: 100, ease: "Back.easeOut" });
    });
    btn.on("pointerout", () => {
      this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 100 });
    });

    btn.on("pointerdown", () => {
      // Dismiss concerns container
      const cont = (this as any)._concernsContainer as Phaser.GameObjects.Container;
      this.tweens.add({
        targets: cont, alpha: 0, y: cont.y + 20,
        duration: 250, ease: "Quad.easeIn",
        onComplete: () => cont.destroy(),
      });
      (this as any)._continueBtn = undefined;
      (this as any)._concernsContainer = undefined;

      this.greeter?.showSpeechBubble("Tell me a bit about yourself.", 4000);
      this.time.delayedCall(1500, () => {
        this.currentStep = "personality";
        this.events.emit("onboarding-need-input", {
          step: "personality",
          prompt: "Tell us about yourself",
        });
      });
    });

    parent.add(btn);
    (this as any)._continueBtn = btn;
  }

  /* ── Completion ─────────────────────────────────────────── */

  private completeOnboarding() {
    this.currentStep = "complete";
    const townName = TOWN_META[this.userTown].name;
    this.greeter?.showSpeechBubble(`Welcome home, ${this.userName}!`, 3000);

    this.time.delayedCall(2000, () => {
      // Walk together toward the right
      const W = Number(this.game.config.width);
      const exitX = W + 50;
      const y = this.greeter?.y ?? 400;

      this.greeter?.moveToPosition(exitX, y);
      this.playerChar?.moveToPosition(exitX - 40, y);

      // Fade to white
      this.time.delayedCall(1200, () => {
        this.cameras.main.fadeOut(600, 255, 255, 255);

        this.cameras.main.once("camerafadeoutcomplete", () => {
          // Derive user profile data
          const initials = this.userName
            .split(" ")
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2) || "?";

          const agentId = "player-" + this.userName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

          this.events.emit("onboarding-complete", {
            name: this.userName,
            town: this.userTown,
            politicalLeaning: this.userLeaning,
            topConcerns: this.userConcerns,
            personality: this.userPersonality,
            initials,
            color: TOWN_ACCENT[this.userTown] || TOWN_META[this.userTown].color,
            agentId: agentId || "player",
          });
        });
      });
    });
  }

  /* ── Ambient Effects (reused patterns from TownScene) ──── */

  private buildTilemap(W: number, H: number) {
    const map = this.make.tilemap({ key: "town-map" });
    const tileset = map.addTilesetImage("rpg-tileset", "rpg-tileset");
    if (tileset) {
      const scale = Math.max(W / map.widthInPixels, H / map.heightInPixels);
      const terrain = map.createLayer("terrain", tileset);
      const bridge = map.createLayer("bridge", tileset);
      const deco = map.createLayer("deco", tileset);
      terrain?.setScale(scale).setAlpha(0.92);
      bridge?.setScale(scale);
      deco?.setScale(scale);
    }
  }

  private buildAmbientFX(W: number, H: number) {
    // Campfire
    if (!this.anims.exists("campfire-burn")) {
      this.anims.create({
        key: "campfire-burn",
        frames: this.anims.generateFrameNumbers("campfire", { start: 0, end: 3 }),
        frameRate: 7, repeat: -1,
      });
    }
    if (this.textures.exists("campfire")) {
      const fx = W * 0.38, fy = H * 0.56;
      const fire = this.add.sprite(fx, fy, "campfire").setScale(1.6).setDepth(12).setAlpha(0.85);
      fire.play("campfire-burn");
      const light = this.add.graphics();
      light.fillStyle(0xff8800, 0.08);
      light.fillCircle(fx, fy, 50);
      light.setDepth(11);
      this.tweens.add({ targets: light, alpha: 0.02, duration: 600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }

    // Sparkles
    if (!this.anims.exists("sparkle-anim")) {
      this.anims.create({
        key: "sparkle-anim",
        frames: this.anims.generateFrameNumbers("sparkle", { start: 0, end: 3 }),
        frameRate: 4, repeat: -1,
      });
    }
    if (this.textures.exists("sparkle")) {
      for (let i = 0; i < 3; i++) {
        const sx = W * 0.3 + Math.random() * W * 0.4;
        const sy = H * 0.3 + Math.random() * H * 0.3;
        const sp = this.add.sprite(sx, sy, "sparkle").setDepth(12).setAlpha(0.35 + Math.random() * 0.2);
        sp.play("sparkle-anim");
      }
    }
  }

  private createAnimations(charName: string) {
    const key = `char-${charName}`;
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
          frameRate: 9, repeat: -1,
        });
      }
      const idleKey = `${key}-idle-${d.name}`;
      if (!this.anims.exists(idleKey)) {
        this.anims.create({
          key: idleKey,
          frames: [{ key, frame: d.idle }, { key, frame: d.start }, { key, frame: d.idle }, { key, frame: d.end }],
          frameRate: 1.6, repeat: -1, repeatDelay: 1200,
        });
      }
    }
  }

  private scheduleBirds(W: number, H: number) {
    const launchBird = () => {
      const fromLeft = Math.random() < 0.5;
      const y = Phaser.Math.Between(30, H / 3);
      const x0 = fromLeft ? -20 : W + 20;
      const x1 = fromLeft ? W + 20 : -20;
      const bird = this.add.graphics();
      bird.lineStyle(2, 0x334455, 0.5);
      bird.lineBetween(-5, 0, 0, -3);
      bird.lineBetween(0, -3, 5, 0);
      bird.setPosition(x0, y).setDepth(10);
      this.tweens.add({ targets: bird, scaleY: -1, duration: 280, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.tweens.add({ targets: bird, x: x1, y: y + Phaser.Math.Between(-15, 15), duration: Phaser.Math.Between(6000, 10000), ease: "Sine.easeInOut", onComplete: () => bird.destroy() });
      this.time.delayedCall(Phaser.Math.Between(4000, 10000), launchBird);
    };
    this.time.delayedCall(2000, launchBird);
  }

  private spawnAmbientNPCs(W: number, H: number) {
    const chars = [GREETER_SPRITE, PLAYER_TEMP_SPRITE];
    for (let i = 0; i < 2; i++) {
      const charName = chars[i % chars.length];
      const key = `char-${charName}`;
      if (!this.textures.exists(key)) continue;
      const sx = Phaser.Math.Between(80, W - 80);
      const sy = Phaser.Math.Between(120, H - 120);
      const npc = this.add.sprite(sx, sy, key, 1);
      npc.setScale(1.9).setOrigin(0.5, 1).setDepth(50 + sy).setAlpha(0.45);
      const dirs = ["down", "left", "right", "up"] as const;
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const walkKey = `${key}-walk-${dir}`;
      if (this.anims.exists(walkKey)) npc.play(walkKey);
      this.scheduleAmbientWander(npc, W, H);
    }
  }

  private scheduleAmbientWander(npc: Phaser.GameObjects.Sprite, W: number, H: number) {
    this.time.delayedCall(Phaser.Math.Between(3000, 8000), () => {
      if (!npc.active) return;
      const tx = Phaser.Math.Between(80, W - 80);
      const ty = Phaser.Math.Between(120, H - 120);
      const dx = tx - npc.x, dy = ty - npc.y;
      const dist = Math.hypot(dx, dy);
      let dir = "down";
      if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
      else dir = dy > 0 ? "down" : "up";
      const wKey = `${npc.texture.key}-walk-${dir}`;
      if (this.anims.exists(wKey)) npc.play(wKey, true);
      this.tweens.add({
        targets: npc, x: tx, y: ty,
        duration: Phaser.Math.Clamp(dist * 4, 700, 3000),
        ease: "Sine.easeInOut",
        onUpdate: () => npc.setDepth(50 + npc.y),
        onComplete: () => { npc.stop(); npc.setFrame(1); this.scheduleAmbientWander(npc, W, H); },
      });
    });
  }

  /* ── Visual helpers ─────────────────────────────────────── */

  private spawnSparkles(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const sx = x + Phaser.Math.Between(-15, 15);
      const sy = y + Phaser.Math.Between(-10, 10);
      const g = this.add.graphics();
      g.fillStyle(0xffd700, 0.7);
      g.fillCircle(0, 0, 3);
      g.fillStyle(0xffffff, 0.5);
      g.fillCircle(0, 0, 1.5);
      g.setPosition(sx, sy).setDepth(200).setScale(0);
      this.tweens.add({
        targets: g, scaleX: 1.2, scaleY: 1.2, alpha: 0,
        duration: 500, delay: i * 120, ease: "Quad.easeOut",
        onComplete: () => g.destroy(),
      });
    }
  }

  private spawnRipple(x: number, y: number, color: number) {
    for (let i = 0; i < 3; i++) {
      const g = this.add.graphics();
      g.lineStyle(2, color, 0.5);
      g.strokeCircle(0, 0, 8);
      g.setPosition(x, y).setDepth(200).setScale(0.5);
      this.tweens.add({
        targets: g, scaleX: 2 + i * 0.5, scaleY: 2 + i * 0.5, alpha: 0,
        duration: 500, delay: i * 80, ease: "Quad.easeOut",
        onComplete: () => g.destroy(),
      });
    }
  }
}

import Phaser from "phaser";

const SPRITE_SIZE = 32;
const SPRITE_SCALE = 1.8;
const LABEL_OFFSET_Y = 35;
const SPEECH_OFFSET_Y = -45;

export class AgentSprite extends Phaser.GameObjects.Container {
  // Character sprite (from Smallville spritesheet) or fallback circle
  private charSprite?: Phaser.GameObjects.Sprite;
  private circle?: Phaser.GameObjects.Graphics;
  private initialsText?: Phaser.GameObjects.Text;
  private opinionRing: Phaser.GameObjects.Graphics;
  private nameLabel: Phaser.GameObjects.Text;
  private speechBg: Phaser.GameObjects.Graphics;
  private speechText: Phaser.GameObjects.Text;
  private speechTimer?: Phaser.Time.TimerEvent;
  private bobTween?: Phaser.Tweens.Tween;
  private moveTween?: Phaser.Tweens.Tween;
  private shadowGraphics: Phaser.GameObjects.Graphics;

  public agentId: string;
  public agentName: string;
  public townId: string;
  private agentColor: string;
  private opinionColor: string;
  private usingSpritesheet: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: {
      id: string;
      name: string;
      initials: string;
      color: string;
      town: string;
      opinionColor?: string;
      spriteKey?: string;
    }
  ) {
    super(scene, x, y);

    this.agentId = config.id;
    this.agentName = config.name;
    this.townId = config.town;
    this.agentColor = config.color;
    this.opinionColor = config.opinionColor || "#FFFFFF";
    this.usingSpritesheet = false;

    // Shadow under character
    this.shadowGraphics = scene.add.graphics();
    this.shadowGraphics.fillStyle(0x000000, 0.15);
    this.shadowGraphics.fillEllipse(0, 14, 28, 10);
    this.add(this.shadowGraphics);

    // Opinion ring (drawn around character)
    this.opinionRing = scene.add.graphics();
    this.drawOpinionRing();
    this.add(this.opinionRing);

    // Try to use character spritesheet
    if (config.spriteKey && scene.textures.exists(config.spriteKey)) {
      this.charSprite = scene.add.sprite(0, 0, config.spriteKey, 0);
      this.charSprite.setScale(SPRITE_SCALE);
      this.charSprite.setOrigin(0.5, 0.5);
      this.add(this.charSprite);
      this.usingSpritesheet = true;
    } else {
      // Fallback: colored circle with initials
      this.circle = scene.add.graphics();
      this.drawFallbackCircle();
      this.add(this.circle);

      this.initialsText = scene.add.text(0, 0, config.initials, {
        fontFamily: "Inter, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#FFFFFF",
      });
      this.initialsText.setOrigin(0.5, 0.5);
      this.add(this.initialsText);
    }

    // Name label below character
    const firstName = config.name.split(" ")[0].replace(/['"]/g, "");
    this.nameLabel = scene.add.text(0, LABEL_OFFSET_Y, firstName, {
      fontFamily: "Inter, sans-serif",
      fontSize: "10px",
      fontStyle: "bold",
      color: "#FFFFFF",
      stroke: "#000000",
      strokeThickness: 2,
    });
    this.nameLabel.setOrigin(0.5, 0);
    this.add(this.nameLabel);

    // Speech bubble (hidden by default)
    this.speechBg = scene.add.graphics();
    this.speechBg.setVisible(false);
    this.add(this.speechBg);

    this.speechText = scene.add.text(0, SPEECH_OFFSET_Y, "", {
      fontFamily: "Inter, sans-serif",
      fontSize: "9px",
      color: "#2C2416",
      align: "center",
      wordWrap: { width: 130 },
    });
    this.speechText.setOrigin(0.5, 1);
    this.speechText.setVisible(false);
    this.add(this.speechText);

    // Interactive hit area
    this.setSize(SPRITE_SIZE * SPRITE_SCALE + 20, SPRITE_SIZE * SPRITE_SCALE + LABEL_OFFSET_Y + 20);
    this.setInteractive({ cursor: "pointer" });
    this.on("pointerover", () => {
      scene.tweens.add({
        targets: this,
        scaleX: 1.12,
        scaleY: 1.12,
        duration: 120,
        ease: "Back.easeOut",
      });
      // Show name brighter
      this.nameLabel.setColor("#FFD700");
    });
    this.on("pointerout", () => {
      scene.tweens.add({
        targets: this,
        scaleX: 1,
        scaleY: 1,
        duration: 120,
        ease: "Back.easeOut",
      });
      this.nameLabel.setColor("#FFFFFF");
    });
    this.on("pointerdown", () => {
      scene.events.emit("agent-clicked", this.agentId);
    });

    scene.add.existing(this);
    this.setDepth(20);

    // Start idle animation
    this.startBob();
  }

  private drawOpinionRing() {
    this.opinionRing.clear();
    const oc = Phaser.Display.Color.HexStringToColor(this.opinionColor);
    // Glowing ring around character
    this.opinionRing.lineStyle(2.5, oc.color, 0.8);
    this.opinionRing.strokeCircle(0, 0, SPRITE_SIZE * SPRITE_SCALE * 0.55);
  }

  private drawFallbackCircle() {
    if (!this.circle) return;
    this.circle.clear();
    const c = Phaser.Display.Color.HexStringToColor(this.agentColor);
    this.circle.fillStyle(c.color, 1);
    this.circle.fillCircle(0, 0, 18);
  }

  private startBob() {
    this.bobTween = this.scene.tweens.add({
      targets: this,
      y: this.y - 2.5,
      duration: 1000 + Math.random() * 500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  moveToPosition(targetX: number, targetY: number, duration = 1500) {
    this.bobTween?.pause();
    this.moveTween?.stop();

    // Play walk animation if using spritesheet
    if (this.usingSpritesheet && this.charSprite) {
      const key = this.charSprite.texture.key;
      const animKey = `${key}-down`;
      if (this.scene.anims.exists(animKey)) {
        this.charSprite.play(animKey);
      }
    }

    this.moveTween = this.scene.tweens.add({
      targets: this,
      x: targetX,
      y: targetY,
      duration,
      ease: "Quad.easeInOut",
      onComplete: () => {
        // Stop walk animation
        if (this.usingSpritesheet && this.charSprite) {
          this.charSprite.stop();
          this.charSprite.setFrame(0); // idle frame
        }
        this.bobTween?.resume();
      },
    });
  }

  showSpeechBubble(text: string, duration = 4000) {
    const truncated = text.length > 55 ? text.slice(0, 52) + "..." : text;
    this.speechText.setText(truncated);
    this.speechText.setVisible(true);

    const bounds = this.speechText.getBounds();
    const pad = 7;
    this.speechBg.clear();
    // Background with slight blue tint
    this.speechBg.fillStyle(0xffffff, 0.95);
    this.speechBg.lineStyle(1, 0xc0b8a0, 1);
    this.speechBg.fillRoundedRect(
      -bounds.width / 2 - pad,
      SPEECH_OFFSET_Y - bounds.height - pad,
      bounds.width + pad * 2,
      bounds.height + pad * 2,
      5,
    );
    this.speechBg.strokeRoundedRect(
      -bounds.width / 2 - pad,
      SPEECH_OFFSET_Y - bounds.height - pad,
      bounds.width + pad * 2,
      bounds.height + pad * 2,
      5,
    );
    // Triangle pointer
    this.speechBg.fillStyle(0xffffff, 0.95);
    this.speechBg.fillTriangle(-4, SPEECH_OFFSET_Y + 2, 4, SPEECH_OFFSET_Y + 2, 0, SPEECH_OFFSET_Y + 9);
    this.speechBg.setVisible(true);
    this.speechBg.setDepth(90);
    this.speechText.setDepth(91);

    this.speechTimer?.remove();
    this.speechTimer = this.scene.time.delayedCall(duration, () => {
      this.speechBg.setVisible(false);
      this.speechText.setVisible(false);
    });
  }

  setOpinionColor(color: string) {
    this.opinionColor = color;
    this.drawOpinionRing();

    // Pulse animation on opinion change
    this.scene.tweens.add({
      targets: this,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 200,
      yoyo: true,
      ease: "Quad.easeOut",
    });
  }

  destroy(fromScene?: boolean) {
    this.bobTween?.stop();
    this.moveTween?.stop();
    this.speechTimer?.remove();
    super.destroy(fromScene);
  }
}

import Phaser from "phaser";
import type { WeatherKind } from "../types/messages";

/**
 * WeatherScene — runs on top of TownScene as a translucent overlay (depth
 * 998). Renders rain / snow / cloud / fog with cheap Phaser primitives and
 * gracefully cross-fades when the weather changes.
 *
 * Listens for `setWeather(kind)` calls from the parent TownScene rather than
 * directly subscribing to the WS — TownScene fans events out to keep coupling
 * minimal.
 */

interface RainDrop {
  g: Phaser.GameObjects.Graphics;
  tween: Phaser.Tweens.Tween;
}
interface SnowFlake {
  g: Phaser.GameObjects.Graphics;
  baseX: number;
  phase: number;
}

export class WeatherScene extends Phaser.Scene {
  private current: WeatherKind = "clear";
  private container?: Phaser.GameObjects.Container;
  private cloudOverlay?: Phaser.GameObjects.Graphics;
  private fogBands: Phaser.GameObjects.Graphics[] = [];
  private rainDrops: RainDrop[] = [];
  private snowFlakes: SnowFlake[] = [];
  private paused = false;
  private resizeListener?: () => void;

  constructor() {
    super({ key: "WeatherScene", active: false });
  }

  init() {
    this.current = "clear";
  }

  create() {
    this.container = this.add.container(0, 0).setDepth(998);

    // Honor user "reduce motion" preference from localStorage.
    try {
      const raw = localStorage.getItem("township-user-profile");
      if (raw) {
        const profile = JSON.parse(raw);
        if (profile?.reducedMotion) this.paused = true;
      }
    } catch { /* ignore */ }

    // Resize handler so weather stays full-screen.
    this.resizeListener = () => this.rebuild();
    this.scale.on("resize", this.resizeListener);
  }

  shutdown() {
    if (this.resizeListener) this.scale.off("resize", this.resizeListener);
    this.clearWeather();
  }

  /* ── Public API ────────────────────────────────────────── */

  setWeather(kind: WeatherKind) {
    if (kind === this.current) return;
    this.crossfadeTo(kind);
  }

  pause() {
    this.paused = true;
    for (const r of this.rainDrops) r.tween.pause();
  }

  resume() {
    this.paused = false;
    for (const r of this.rainDrops) r.tween.resume();
  }

  /* ── Build/destroy logic ────────────────────────────────── */

  private crossfadeTo(next: WeatherKind) {
    const out = this.container;
    if (out && out.list.length > 0) {
      this.tweens.add({
        targets: out,
        alpha: 0,
        duration: 500,
        ease: "Sine.easeInOut",
        onComplete: () => {
          this.clearWeather();
          this.current = next;
          this.applyWeather(next);
          if (this.container) {
            this.container.setAlpha(0);
            this.tweens.add({ targets: this.container, alpha: 1, duration: 500 });
          }
        },
      });
    } else {
      this.current = next;
      this.applyWeather(next);
      if (this.container) {
        this.container.setAlpha(0);
        this.tweens.add({ targets: this.container, alpha: 1, duration: 500 });
      }
    }
  }

  private rebuild() {
    this.clearWeather();
    this.applyWeather(this.current);
  }

  private clearWeather() {
    for (const d of this.rainDrops) { d.tween.stop(); d.g.destroy(); }
    this.rainDrops = [];
    for (const f of this.snowFlakes) f.g.destroy();
    this.snowFlakes = [];
    for (const b of this.fogBands) b.destroy();
    this.fogBands = [];
    this.cloudOverlay?.destroy();
    this.cloudOverlay = undefined;
    if (this.container) {
      this.container.removeAll(true);
    }
  }

  private applyWeather(kind: WeatherKind) {
    if (!this.container) return;
    switch (kind) {
      case "clear":   return;
      case "cloudy":  return this.spawnClouds();
      case "rain":    return this.spawnRain();
      case "snow":    return this.spawnSnow();
      case "fog":     return this.spawnFog();
    }
  }

  /* ── Cloudy: low-alpha gray gradient ───────────────────── */

  private spawnClouds() {
    if (!this.container) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const g = this.add.graphics();
    g.fillGradientStyle(0x9aa4b4, 0x9aa4b4, 0xc8cfd9, 0xc8cfd9, 0.22, 0.22, 0.10, 0.10);
    g.fillRect(0, 0, W, H);
    this.container.add(g);
    this.cloudOverlay = g;
  }

  /* ── Rain ──────────────────────────────────────────────── */

  private spawnRain() {
    if (!this.container) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const DROPS = 200;

    for (let i = 0; i < DROPS; i++) this.spawnRainDrop(W, H, /* stagger */ true);

    // Light blue ambient haze
    const haze = this.add.graphics();
    haze.fillStyle(0x6892c4, 0.07);
    haze.fillRect(0, 0, W, H);
    this.container.add(haze);
  }

  private spawnRainDrop(W: number, H: number, stagger = false) {
    const g = this.add.graphics();
    g.lineStyle(1, 0xb6cae3, 0.65);
    g.lineBetween(0, 0, -2, 8);
    const x = Phaser.Math.Between(-20, W + 20);
    const y = -Phaser.Math.Between(0, H);
    g.setPosition(x, y);

    const tween = this.tweens.add({
      targets: g,
      x: x - 30,
      y: H + 20,
      duration: Phaser.Math.Between(500, 900),
      ease: "Linear",
      delay: stagger ? Phaser.Math.Between(0, 800) : 0,
      onComplete: () => {
        // Splash at ground
        this.spawnSplash(g.x, H - 4);
        g.destroy();
        // Replace if the kind is still rain.
        if (this.current === "rain" && !this.paused) this.spawnRainDrop(W, H);
      },
    });
    this.container?.add(g);
    this.rainDrops.push({ g, tween });
  }

  private spawnSplash(x: number, y: number) {
    const splash = this.add.graphics();
    splash.lineStyle(1, 0xb6cae3, 0.7);
    splash.strokeCircle(0, 0, 1);
    splash.setPosition(x, y);
    this.tweens.add({
      targets: splash,
      scaleX: 4,
      scaleY: 1.5,
      alpha: 0,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => splash.destroy(),
    });
  }

  /* ── Snow ──────────────────────────────────────────────── */

  private spawnSnow() {
    if (!this.container) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const FLAKES = 120;

    for (let i = 0; i < FLAKES; i++) {
      const g = this.add.graphics();
      const radius = 1.5 + Math.random() * 2;
      g.fillStyle(0xffffff, 0.65 + Math.random() * 0.3);
      g.fillCircle(0, 0, radius);
      const x = Math.random() * W;
      const y = Math.random() * H - H;
      g.setPosition(x, y);
      this.container.add(g);
      this.snowFlakes.push({ g, baseX: x, phase: Math.random() * Math.PI * 2 });

      this.tweens.add({
        targets: g,
        y: H + 10,
        duration: 9000 + Math.random() * 5000,
        ease: "Linear",
        repeat: -1,
        onRepeat: () => {
          g.setY(-10);
        },
      });
    }
  }

  /* ── Fog ───────────────────────────────────────────────── */

  private spawnFog() {
    if (!this.container) return;
    const W = this.scale.width;
    const H = this.scale.height;
    for (let i = 0; i < 3; i++) {
      const band = this.add.graphics();
      band.fillStyle(0xe0e7ef, 0.18);
      band.fillEllipse(W / 2, (i + 0.5) * (H / 3), W * 1.4, H * 0.4);
      band.setPosition(-W * 0.2, 0);
      this.container.add(band);
      this.fogBands.push(band);
      this.tweens.add({
        targets: band,
        x: W * 0.2,
        duration: 14000 + i * 2000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  /* ── Per-frame: side-drift on snow ─────────────────────── */

  override update(time: number, _delta: number) {
    if (this.paused) return;
    if (this.snowFlakes.length === 0) return;
    for (const f of this.snowFlakes) {
      f.g.x = f.baseX + Math.sin(time / 900 + f.phase) * 12;
    }
  }
}

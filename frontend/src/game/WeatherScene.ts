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
 *
 * ── Clipping contract (Round-2 P1: weather overflow) ────────────────────
 * Under Scale.RESIZE the canvas tracks its DOM parent, so on tall/mobile
 * viewports the reported scale size can momentarily disagree with the laid
 * out page (Phaser re-polls parent bounds on an interval), and the town map
 * itself may not cover the whole canvas (overview letterboxing). Weather
 * therefore never trusts a size captured at spawn time:
 *   • the scene camera's viewport is pinned every frame-ish to the
 *     intersection of the canvas and the TownScene camera's projected world
 *     rect, so the camera scissor clips every particle to the visible town —
 *     nothing can draw over parchment margins or page chrome;
 *   • all spawn math reads the *current* viewport size (`viewW`/`viewH`),
 *     including the rain respawn chain (previously it recursed with the
 *     width/height captured when the storm started);
 *   • viewport size changes rebuild the particle field (debounced), so a
 *     resize never leaves a half-covered or overflowing storm behind.
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

  /** Current clipped viewport (camera scissor) — all spawn math uses this. */
  private viewW = 0;
  private viewH = 0;
  /** Throttle for the per-frame viewport sync. */
  private viewSyncAccum = 0;
  /** Debounce timer for size-change rebuilds. */
  private rebuildTimer?: Phaser.Time.TimerEvent;

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

    this.syncViewport();

    // Resize handler so weather stays exactly canvas/town-sized. The actual
    // rebuild is debounced — RESIZE mode can emit a burst of events while a
    // mobile URL bar collapses or a flex layout settles.
    this.resizeListener = () => {
      if (this.syncViewport()) this.queueRebuild();
    };
    this.scale.on("resize", this.resizeListener);

    // Phaser does not call a method named `shutdown` automatically — wire it
    // to the real lifecycle event so the scale listener never leaks.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
  }

  shutdown() {
    if (this.resizeListener) {
      this.scale.off("resize", this.resizeListener);
      this.resizeListener = undefined;
    }
    this.rebuildTimer?.remove(false);
    this.rebuildTimer = undefined;
    this.clearWeather();
  }

  /* ── Viewport clipping ─────────────────────────────────── */

  /**
   * Pin the weather camera to the intersection of the canvas and the town
   * map's on-screen rect. Returns true when the clip SIZE changed enough
   * that the particle field should be rebuilt.
   */
  private syncViewport(): boolean {
    const cam = this.cameras?.main;
    if (!cam) return false;
    const gw = Math.max(1, this.scale.width);
    const gh = Math.max(1, this.scale.height);

    let x = 0;
    let y = 0;
    let w = gw;
    let h = gh;

    // Project the town's world rect (the map spans the logical game size)
    // through the TownScene camera into screen space.
    const town = this.scene.get("TownScene");
    const tcam = town?.cameras?.main;
    const worldW = Number(this.game.config.width);
    const worldH = Number(this.game.config.height);
    if (tcam && worldW > 0 && worldH > 0) {
      const z = tcam.zoom;
      const left = (0 - tcam.worldView.x) * z;
      const top = (0 - tcam.worldView.y) * z;
      const right = (worldW - tcam.worldView.x) * z;
      const bottom = (worldH - tcam.worldView.y) * z;
      x = Math.max(0, Math.floor(left));
      y = Math.max(0, Math.floor(top));
      w = Math.min(gw, Math.ceil(right)) - x;
      h = Math.min(gh, Math.ceil(bottom)) - y;
      if (w < 8 || h < 8) { x = 0; y = 0; w = gw; h = gh; }
    }

    cam.setViewport(x, y, Math.round(w), Math.round(h));
    cam.setScroll(0, 0);

    // Rebuild when the clip GROWS (new area would be bare) or collapses
    // dramatically. Mild shrinks — conversation-spotlight zooms, drift —
    // are handled by the scissor alone so the storm never visibly resets.
    const changed = (w - this.viewW > 48 || h - this.viewH > 48)
      || (w < this.viewW * 0.6 || h < this.viewH * 0.6);
    this.viewW = w;
    this.viewH = h;
    return changed;
  }

  /** Debounced rebuild after the viewport settles at a new size. */
  private queueRebuild() {
    this.rebuildTimer?.remove(false);
    this.rebuildTimer = this.time.delayedCall(180, () => {
      this.rebuildTimer = undefined;
      this.rebuild();
    });
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
    this.container?.setAlpha(1);
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
    const W = this.viewW;
    const H = this.viewH;
    const g = this.add.graphics();
    g.fillGradientStyle(0x9aa4b4, 0x9aa4b4, 0xc8cfd9, 0xc8cfd9, 0.22, 0.22, 0.10, 0.10);
    g.fillRect(0, 0, W, H);
    this.container.add(g);
    this.cloudOverlay = g;
  }

  /* ── Rain ──────────────────────────────────────────────── */

  private spawnRain() {
    if (!this.container) return;
    const W = this.viewW;
    const H = this.viewH;
    // Density scales with covered area so a phone-sized clip is not a
    // monsoon and a desktop canvas is not a drizzle (old fixed 200).
    const drops = Phaser.Math.Clamp(Math.round((W * H) / 4800), 60, 260);

    for (let i = 0; i < drops; i++) this.spawnRainDrop(/* stagger */ true);

    // Light blue ambient haze
    const haze = this.add.graphics();
    haze.fillStyle(0x6892c4, 0.07);
    haze.fillRect(0, 0, W, H);
    this.container.add(haze);
  }

  private spawnRainDrop(stagger = false) {
    // Always read the CURRENT clip size — the respawn chain used to close
    // over the size captured when the storm started, which kept painting a
    // stale extent after the canvas or town frame changed size.
    const W = this.viewW;
    const H = this.viewH;
    const g = this.add.graphics();
    g.lineStyle(1, 0xb6cae3, 0.65);
    g.lineBetween(0, 0, -2, 8);
    const x = Phaser.Math.Between(-20, W + 20);
    const y = -Phaser.Math.Between(0, H);
    g.setPosition(x, y);

    const entry: RainDrop = { g, tween: null as unknown as Phaser.Tweens.Tween };
    entry.tween = this.tweens.add({
      targets: g,
      x: x - 30,
      y: H + 20,
      duration: Phaser.Math.Between(500, 900),
      ease: "Linear",
      delay: stagger ? Phaser.Math.Between(0, 800) : 0,
      onComplete: () => {
        // Splash at ground (bottom of the current clip).
        this.spawnSplash(g.x, this.viewH - 4);
        g.destroy();
        // Retire this entry (the array used to grow without bound) and
        // replace it if the kind is still rain.
        this.rainDrops = this.rainDrops.filter((d) => d !== entry);
        if (this.current === "rain" && !this.paused) this.spawnRainDrop();
      },
    });
    this.container?.add(g);
    this.rainDrops.push(entry);
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
    this.container?.add(splash);
  }

  /* ── Snow ──────────────────────────────────────────────── */

  private spawnSnow() {
    if (!this.container) return;
    const W = this.viewW;
    const H = this.viewH;
    const flakes = Phaser.Math.Clamp(Math.round((W * H) / 8000), 40, 160);

    for (let i = 0; i < flakes; i++) {
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
    const W = this.viewW;
    const H = this.viewH;
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

  /* ── Per-frame: viewport sync + side-drift on snow ─────── */

  override update(time: number, delta: number) {
    // Keep the clip glued to the town frame (~4 Hz — the town camera pans
    // and zooms during overview drift and conversation spotlights).
    this.viewSyncAccum += delta;
    if (this.viewSyncAccum >= 250) {
      this.viewSyncAccum = 0;
      if (this.syncViewport()) this.queueRebuild();
    }

    if (this.paused) return;
    if (this.snowFlakes.length === 0) return;
    for (const f of this.snowFlakes) {
      f.g.x = f.baseX + Math.sin(time / 900 + f.phase) * 12;
    }
  }
}

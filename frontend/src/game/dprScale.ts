import Phaser from "phaser";
import { RENDER_DPR } from "./config";

/**
 * Backing-store size for a game parented to `el`: its CSS box × RENDER_DPR,
 * rounded to whole device pixels.
 */
export function backingSize(el: HTMLElement): { width: number; height: number } {
  return {
    width: Math.round(el.clientWidth * RENDER_DPR),
    height: Math.round(el.clientHeight * RENDER_DPR),
  };
}

/**
 * Keep a `Scale.NONE` game's backing store at `parent`'s CSS size × RENDER_DPR
 * (see RENDER_DPR in config.ts). Sizes the game as soon as it has a canvas,
 * then on every parent resize (ResizeObserver; window resize as the
 * fallback) — bursts coalesce into one animation frame, zero sizes
 * (display:none, mid-layout) are ignored, and unchanged sizes are skipped.
 * `game.scale.resize` then sets the canvas's CSS box to size × zoom, i.e.
 * back to the parent, and emits the scale RESIZE the scenes refit on.
 *
 * Returns a disposer; call it before `game.destroy()`.
 */
export function installDprScale(game: Phaser.Game, parent: HTMLElement): () => void {
  let raf = 0;
  let disposed = false;

  const apply = () => {
    raf = 0;
    if (disposed || !game.isBooted || !game.scale?.canvas) return;
    const { width, height } = backingSize(parent);
    if (width === 0 || height === 0) return;
    if (game.scale.width === width && game.scale.height === height) return;
    game.scale.resize(width, height);
  };
  const schedule = () => {
    if (disposed || raf) return;
    raf = requestAnimationFrame(apply);
  };

  // Boot is synchronous once the document is ready; otherwise the canvas
  // arrives with the game's READY event.
  if (game.isBooted) apply();
  else game.events.once(Phaser.Core.Events.READY, apply);

  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(schedule);
    observer.observe(parent);
  } else {
    window.addEventListener("resize", schedule);
  }

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    observer?.disconnect();
    window.removeEventListener("resize", schedule);
    game.events.off(Phaser.Core.Events.READY, apply);
  };
}

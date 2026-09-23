#!/usr/bin/env node
/**
 * tokenize — replace raw colour literals in every src css/tsx file with design
 * tokens from src/styles/tokens.css. Idempotent; run after adding colours.
 *
 *   node scripts/tokenize.mjs            # rewrite files
 *   node scripts/tokenize.mjs --check    # list what would change, exit 1 if any
 *
 * Exempt: tokens.css itself (the source of truth), src/game/** (Phaser draws
 * with numeric colours), and any rule under `.high-contrast` (deliberate
 * literal overrides). Scenario-driven colours never appear as literals —
 * they arrive at runtime from the scenario package.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const CHECK = process.argv.includes("--check");

/** hex (lower-case, 6-digit) → token expression. `white` is contextual. */
export const TOKEN_MAP = {
  "#f5ede0": "var(--color-surface-1)",
  "#ede4d3": "var(--color-surface-2)",
  "#faf6ef": "var(--color-surface-3)",
  "#fffaf1": "var(--color-surface-3)",
  "#f8f3ea": "var(--color-surface-3)",
  "#f6f0e5": "var(--color-surface-3)",
  "#e8dcc8": "var(--color-surface-mat)",
  "#e7ddc6": "var(--color-surface-mat)",
  "#2c2520": "var(--color-ink)",
  "#6b5e52": "var(--color-ink-2)",
  "#6b5b45": "var(--color-ink-2)",
  "#73675a": "var(--color-ink-3)",
  "#6b7280": "var(--color-ink-3)",
  "#c4a35a": "var(--color-accent)",
  "#765a1f": "var(--color-accent-ink)",
  "#d9c48e": "var(--color-accent-light)",
  "#d8c49b": "var(--color-accent-light)",
  "#f1d8ae": "var(--color-accent-light)",
  "#e8e0d4": "var(--color-line)",
  "#d4cfc6": "var(--color-line)",
  "#32733e": "var(--color-success)",
  "#4caf50": "var(--color-success)",
  "#865018": "var(--color-warning)",
  "#b85050": "var(--color-danger)",
  "#ef4444": "var(--color-danger)",
  "#b5493a": "var(--color-live)",
  "#3b5998": "var(--color-civic)",
  "#5b7ec0": "var(--color-civic-light)",
  "#263e73": "var(--color-civic-ink)",
  "#d1d5db": "var(--color-undecided)",
  "#fff8e0": "var(--color-on-overlay)",
  "#fffaf0": "var(--color-on-overlay)",
  "#fff9ec": "var(--color-on-overlay)",
  "#fbf4e4": "var(--color-parchment)",
  "#fbf2dd": "var(--color-parchment)",
  "#f1e4c8": "var(--color-parchment-2)",
  "#f1e2c2": "var(--color-parchment-2)",
  "#d6b682": "var(--color-parchment-2)",
  "#f1e4c6": "var(--color-parchment-3)",
  "#f2ecdd": "var(--color-parchment-3)",
  "#c9b285": "var(--color-parchment-line)",
  "#c4ae8c": "var(--color-parchment-line)",
  "#d7c7ab": "var(--color-parchment-line)",
  "#4a3a24": "var(--color-parchment-ink)",
  "#4b3b1c": "var(--color-parchment-ink)",
  "#57432c": "var(--color-parchment-ink)",
  "#8a755a": "var(--color-parchment-ink-2)",
  "#8a7a5e": "var(--color-parchment-ink-2)",
  "#e4cfa4": "var(--color-parchment-deep)",
  "#b08f5a": "var(--color-parchment-accent)",
  "#fff4df": "var(--color-notice-bg)",
  "#5f351f": "var(--color-notice-ink)",
  "#70452a": "var(--color-notice-link)",
  "#4a9b5c": "var(--color-friendly)",
  "#c09060": "var(--color-warming)",
  "#9a8e80": "var(--color-neutral)",
  "#8b7d6b": "var(--color-neutral)",
  "#e0a040": "var(--color-weather-clear)",
  "#90a0b8": "var(--color-weather-cloudy)",
  "#5080c0": "var(--color-weather-rain)",
  "#a0c0e8": "var(--color-weather-snow)",
  "#b0b0b0": "var(--color-weather-fog)",
  "#e8763b": "var(--color-cat-immigration)",
  "#3b82f6": "var(--color-cat-healthcare)",
  "#f59e0b": "var(--color-cat-economy)",
  "#8b5cf6": "var(--color-cat-education)",
  "#10b981": "var(--color-cat-housing)",
  "#ec4899": "var(--color-cat-community)",
  "#376f6a": "var(--color-cat-development)",
  "#596d82": "var(--color-cat-weather)",
  "#55402f": "var(--color-wood)",
  "#8a6f52": "var(--color-wood-light)",
  "#6b5340": "var(--color-wood-light)",
  "#3a3226": "var(--color-atlas-ink)",
  "#3a2c1f": "var(--color-atlas-ink)",
  "#2c2416": "var(--color-atlas-ink-deep)",
  "#f6eedd": "var(--color-atlas-parch)",
  "#a9bf8c": "var(--color-map-green)",
  "#b4a48c": "var(--color-map-hill)",
  "#c2b49e": "var(--color-map-hill)",
  "#cfd8e0": "var(--color-debug-ink)",
  "#444444": "var(--color-debug-line)",
  "#555555": "var(--color-debug-line)",
  "#f2c071": "var(--color-debug-accent)",
};

/** Files whose colour literals are allowed (source of truth / canvas). */
export const EXEMPT = [/^styles\/tokens\.css$/, /^game\//];

const HEX = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

function expand(hex) {
  const h = hex.slice(1).toLowerCase();
  return h.length === 3 ? "#" + h.split("").map((c) => c + c).join("") : "#" + h;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

export function tokenizeSource(text, rel) {
  const lines = text.split("\n");
  let changed = 0;
  let inHighContrast = false;
  const residual = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (rel.endsWith(".css")) {
      if (/high-contrast/.test(line) && /\{\s*$/.test(line)) inHighContrast = true;
      if (inHighContrast && /^\s*\}/.test(line)) { inHighContrast = false; continue; }
      if (inHighContrast) continue;
      if (/^\s*\/\*.*\*\/\s*$/.test(line) || /^\s*\/\*/.test(line) && !/\*\//.test(line)) continue; // comment lines
    }
    if (line.includes("tokenize: keep")) continue;
    const next = line.replace(HEX, (m, _d, offset) => {
      const full = expand(m);
      let token = TOKEN_MAP[full];
      if (!token && (full === "#ffffff")) {
        const before = line.slice(0, offset);
        const asInk = /(?:^|[^-])color\s*[:=]|stroke\s*=|fill\s*=|color:\s*\w+\s*\?/.test(before);
        token = asInk ? "var(--color-on-accent)" : "var(--color-surface-card)";
      }
      if (!token && full === "#000000") token = "var(--color-ink)";
      if (!token) { residual.push({ line: i + 1, hex: m }); return m; }
      return token;
    });
    if (next !== line) { lines[i] = next; changed++; }
  }
  return { text: lines.join("\n"), changed, residual };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let total = 0;
  const residuals = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (EXEMPT.some((re) => re.test(rel))) continue;
    const before = readFileSync(file, "utf8");
    const { text, changed, residual } = tokenizeSource(before, rel);
    for (const r of residual) residuals.push(`${rel}:${r.line} ${r.hex}`);
    if (changed) {
      total += changed;
      if (CHECK) console.log(`would change ${rel} (${changed} lines)`);
      else writeFileSync(file, text);
    }
  }
  if (residuals.length) console.log("unmapped literals:\n  " + residuals.join("\n  "));
  console.log(`${CHECK ? "pending" : "rewrote"} ${total} lines`);
  if (CHECK && total > 0) process.exit(1);
}

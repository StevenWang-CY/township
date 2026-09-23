import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EXEMPT, tokenizeSource } from "./tokenize.mjs";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const BREAKPOINTS = new Set(["480px", "768px", "1024px", "1280px"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC).map((p) => [relative(SRC, p).split("\\").join("/"), readFileSync(p, "utf8")]);
const styled = files.filter(([rel]) => !EXEMPT.some((re) => re.test(rel)));

test("no colour literal outside tokens.css, the canvas code and marked lines", () => {
  const offenders = [];
  for (const [rel, text] of styled) {
    const { residual, changed } = tokenizeSource(text, rel);
    for (const r of residual) offenders.push(`${rel}:${r.line} ${r.hex}`);
    if (changed) offenders.push(`${rel}: ${changed} line(s) still carry a mappable literal — run node scripts/tokenize.mjs`);
  }
  assert.deepEqual(offenders, []);
});

test("media queries use only the four breakpoints", () => {
  const offenders = [];
  for (const [rel, text] of files.filter(([r]) => r.endsWith(".css"))) {
    for (const m of text.matchAll(/@media[^{]*/g)) {
      const q = m[0];
      if (!/width/.test(q)) continue;
      for (const w of q.matchAll(/(\d+)px/g)) if (!BREAKPOINTS.has(w[1] + "px")) offenders.push(`${rel}: ${q.trim()}`);
      if (/max-width|min-width/.test(q)) offenders.push(`${rel}: ${q.trim()} (use range syntax: width < 768px)`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no DOM type below 11px and no numeric z-index", () => {
  const offenders = [];
  for (const [rel, text] of files.filter(([r]) => r.endsWith(".css") && !/^game\//.test(r))) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const fs = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(line);
      if (fs && Number(fs[1]) < 11) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      if (/z-index:\s*-?\d/.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()} (use a --z-* token)`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("every token the sheets reference is declared", () => {
  const tokens = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  const hc = readFileSync(join(SRC, "styles", "motion.css"), "utf8");
  for (const m of hc.matchAll(/(--[\w-]+):/g)) declared.add(m[1]);
  const missing = new Set();
  for (const [rel, text] of files) {
    if (/^game\//.test(rel)) continue;
    for (const m of text.matchAll(/var\((--(?:color|text|radius|duration|ease|z|shadow|font|spacing|breakpoint)[\w-]*)\)/g)) {
      if (!declared.has(m[1])) missing.add(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual([...missing], []);
});

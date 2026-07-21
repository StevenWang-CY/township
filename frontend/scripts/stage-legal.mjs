#!/usr/bin/env node
/** Copy root legal notices into Vite's public tree for every distribution. */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(FRONTEND_DIR, "..");
const OUT_DIR = join(FRONTEND_DIR, "public", "legal");

mkdirSync(OUT_DIR, { recursive: true });
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "RESPONSIBLE_USE.md"]) {
  copyFileSync(join(REPO_ROOT, file), join(OUT_DIR, file));
}

console.log("stage-legal: LICENSE, third-party notices, and responsible-use policy staged");

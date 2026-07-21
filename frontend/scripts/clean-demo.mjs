#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = join(FRONTEND_DIR, "public", "demo");

// Demo feeds are generated inputs for the Pages player, never inputs to the
// ordinary live build. Cleaning here prevents a prior `demo:build` from
// silently leaking recorded payloads into `dist/`; keep the tracked ignore
// policy in place for the next staging pass.
if (existsSync(demoDir)) {
  for (const entry of readdirSync(demoDir)) {
    if (entry !== ".gitignore") rmSync(join(demoDir, entry), { recursive: true, force: true });
  }
}

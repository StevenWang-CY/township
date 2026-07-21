import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { stageDemos } from "./stage-demo.mjs";

const CORE_NOTICE =
  "Township is a simulation, not a poll. Its outputs do not measure real public opinion and must never be presented as if they do.";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "township-stage-demo-"));
  const scenariosDir = join(root, "scenarios");
  const packageDir = join(scenariosDir, "safe-scenario");
  const outDir = join(root, "out");
  mkdirSync(packageDir, { recursive: true });
  writeJson(join(packageDir, "demo", "simulation_cache.json"), {
    schema_version: 1,
    privacy_version: 1,
    events: [{ type: "simulation_started", agents: [], towns: [] }],
    district_summary: null,
  });
  writeJson(join(packageDir, "scenario.json"), {
    id: "safe-scenario",
    title: "Safe Scenario",
    question: "What should happen?",
    kind: "vote",
    options: [{ id: "yes", name: "Yes", label: "Yes", color: "#123456" }],
    undecided: { id: "undecided", label: "Undecided", color: "#999999" },
    town_order: ["harbor"],
    round_plan: [{ round: 1, phases: ["seed"] }],
    responsible_use: {
      core_notice: CORE_NOTICE,
      residents_notice: "Residents are fictional.",
      subjects_notice: "Subjects are documented.",
      outputs_notice: "Outputs are synthetic.",
    },
  });
  writeJson(join(packageDir, "towns", "harbor.json"), {
    name: "Harbor",
    landmarks: [],
  });
  writeJson(join(packageDir, "god-scenarios.json"), []);
  return { root, scenariosDir, packageDir, outDir };
}

test("stageDemos stages a current contained package", () => {
  const value = fixture();
  try {
    assert.deepEqual(
      stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir }),
      { default: "safe-scenario", scenarios: ["safe-scenario"] },
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

const escapedInputs = [
  ["scenario package", "package"],
  ["demo cache", "demo/simulation_cache.json"],
  ["manifest", "scenario.json"],
  ["town", "towns/harbor.json"],
  ["God preset", "god-scenarios.json"],
];

for (const [label, relativePath] of escapedInputs) {
  test(`stageDemos refuses an escaping ${label} symlink`, () => {
    const value = fixture();
    const outside = join(value.root, `outside-${label.replaceAll(" ", "-")}.json`);
    try {
      if (relativePath === "package") {
        const realPackage = join(value.root, "outside-package");
        renameSync(value.packageDir, realPackage);
        symlinkSync(realPackage, value.packageDir, "dir");
      } else {
        const target = join(value.packageDir, relativePath);
        renameSync(target, outside);
        symlinkSync(outside, target);
      }
      assert.throws(
        () => stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir }),
        (error) => {
          assert.match(error.message, /symbolic link|stay within/);
          assert.equal(error.message.includes(outside), false);
          return true;
        },
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });
}

test("stageDemos refuses an unversioned legacy demo", () => {
  const value = fixture();
  try {
    writeJson(join(value.packageDir, "demo", "simulation_cache.json"), {
      events: [{ type: "simulation_started", agents: [], towns: [] }],
    });
    assert.throws(
      () => stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir }),
      /predates the private-player boundary/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

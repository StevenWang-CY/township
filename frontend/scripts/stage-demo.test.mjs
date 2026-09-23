import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { FEED_MAX_EVENTS, stageDemos } from "./stage-demo.mjs";

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
    const result = stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir });
    assert.equal(result.default, "safe-scenario");
    assert.deepEqual(result.scenarios, ["safe-scenario"]);
    // Without a demo manifest the classic cache is the one (flagship) feed,
    // served at both the feed address and the classic <id>.json.
    assert.deepEqual(result.feeds["safe-scenario"].map((f) => [f.id, f.file, f.flagship, f.events]), [
      ["one-day", "safe-scenario--one-day.json", true, 1],
    ]);
    assert.equal(
      readFileSync(join(value.outDir, "safe-scenario.json"), "utf8"),
      readFileSync(join(value.outDir, "safe-scenario--one-day.json"), "utf8"),
    );
    // The staged bootstrap mirrors /api/scenario, round plan included.
    const payload = JSON.parse(readFileSync(join(value.outDir, "safe-scenario-scenario.json"), "utf8"));
    assert.equal(payload.total_rounds, 1);
    assert.deepEqual(payload.round_plan, [{ round: 1, phases: ["seed"], clock: "12:00" }]);
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


test("a demo manifest stages every recording, marks the flagship, and keeps the classic address", () => {
  const value = fixture();
  try {
    writeJson(join(value.packageDir, "demo", "campaign_cache.json"), {
      schema_version: 1,
      privacy_version: 1,
      events: [
        { type: "simulation_started", agents: [], towns: [] },
        { type: "round_started", round: 0, total_rounds: 1, day: 1 },
      ],
      district_summary: null,
    });
    writeJson(join(value.packageDir, "demo", "manifest.json"), {
      feeds: [
        { id: "one-day", file: "simulation_cache.json", label: "One day" },
        { id: "campaign", file: "campaign_cache.json", label: "The campaign", flagship: true },
      ],
    });
    const result = stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir });
    assert.deepEqual(result.feeds["safe-scenario"].map((f) => [f.id, f.flagship, f.events]), [
      ["one-day", false, 1],
      ["campaign", true, 2],
    ]);
    const manifest = JSON.parse(readFileSync(join(value.outDir, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.feeds, result.feeds);
    // the flagship answers at <id>.json
    const classic = JSON.parse(readFileSync(join(value.outDir, "safe-scenario.json"), "utf8"));
    assert.equal(classic.feed_id, "campaign");
    assert.equal(classic.events.length, 2);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("a recording over the player's event budget is refused", () => {
  const value = fixture();
  try {
    const events = Array.from({ length: FEED_MAX_EVENTS + 1 }, () => ({ type: "world_clock_tick", hour: 8, minute: 0 }));
    writeJson(join(value.packageDir, "demo", "simulation_cache.json"), {
      schema_version: 1,
      privacy_version: 1,
      events,
      district_summary: null,
    });
    assert.throws(
      () => stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir }),
      /budget is 16000/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("a demo manifest with a bad feed id or file is refused", () => {
  const value = fixture();
  try {
    writeJson(join(value.packageDir, "demo", "manifest.json"), {
      feeds: [{ id: "Bad Id", file: "simulation_cache.json", label: "x" }],
    });
    assert.throws(() => stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir }), /unique slug/);
    writeJson(join(value.packageDir, "demo", "manifest.json"), {
      feeds: [{ id: "ok", file: "../scenario.json", label: "x" }],
    });
    assert.throws(() => stageDemos({ scenariosDir: value.scenariosDir, outDir: value.outDir }), /inside demo/);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

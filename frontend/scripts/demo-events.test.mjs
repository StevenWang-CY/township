import assert from "node:assert/strict";
import test from "node:test";

import { publicDemoEvents } from "./demo-events.mjs";

test("static demo staging drops legacy private relationship events", () => {
  const publicEvent = { type: "world_clock_tick", hour: 12, minute: 30 };
  const privateEvent = {
    type: "relationship_update",
    player_id: "must-never-ship",
    agent_id: "resident-1",
    trust: 10,
  };

  assert.deepEqual(publicDemoEvents([publicEvent, privateEvent]), [publicEvent]);
  assert.deepEqual(publicDemoEvents(null), []);
});

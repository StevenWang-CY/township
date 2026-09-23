/**
 * Campaign beats for the README hero and the campaign stills, driven by the
 * staged campaign feed (`<scenario>--campaign.json`) through the demo player
 * handle (`window.__demoPlayer`, exposed by the demo build) and the scene's
 * capture API (`window.__town`, `window.__townshipScene`).
 *
 * Every frame is the real recording at a real moment: a weekday morning as
 * commuters leave, a recorded conversation between two voices with its own
 * lines, a week of the calendar passing, election day at the polling place,
 * results night. Nothing is staged by hand.
 */

/** Open a route on a specific staged recording (`?feed=<id>`). */
export async function openFeedRoute(page, origin, route, feedId, scenario = null) {
  const query = new URLSearchParams({ capture: "1", feed: feedId });
  if (scenario) query.set("scenario", scenario);
  await page.goto(`${origin}/?${query.toString()}#${route}`, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Boolean(window.__demoPlayer?.ready), null, { timeout: 45_000 });
}

export async function player(page, method, ...args) {
  return page.evaluate(([m, a]) => {
    const p = window.__demoPlayer;
    if (!p || typeof p[m] !== "function") return null;
    return p[m](...a);
  }, [method, args]);
}

/** Seek the player to an absolute event index and let the scene settle. */
export async function seekPlayer(page, index, settleMs = 900) {
  await player(page, "pause");
  await player(page, "seekTo", Math.max(0, index));
  await page.waitForTimeout(settleMs);
}

/** Index of `town`'s round_started for a day (and beat), or -1. */
export function dayRoundIndex(feed, town, day, beat = null) {
  return feed.events.findIndex(
    (e) => e.type === "round_started" && e.town === town && e.day === day && (beat === null || e.beat === beat),
  );
}

/** Tier lookup from the roster the feed opens with. */
export function tiersOf(feed) {
  const started = feed.events.find((e) => e.type === "simulation_started");
  const tiers = new Map();
  for (const a of started?.agents ?? []) tiers.set(a.id, a.tier ?? "voice");
  return tiers;
}

/**
 * The first recorded conversation in `town` at or after `fromIndex` between
 * two voices with at least two spoken lines — the exchange the hero shows.
 */
export function findVoiceConversation(feed, town, fromIndex = 0) {
  const tiers = tiersOf(feed);
  const events = feed.events;
  for (let i = Math.max(0, fromIndex); i < events.length; i++) {
    const e = events[i];
    if (e.type !== "conversation_started" || e.conversation.town !== town) continue;
    const [a, b] = e.conversation.participants;
    if (tiers.get(a) !== "voice" || tiers.get(b) !== "voice") continue;
    let lines = 0;
    let end = i;
    for (let j = i + 1; j < events.length; j++) {
      const f = events[j];
      if (f.type === "conversation_ended" && f.conversation_id === e.conversation.id) { end = j; break; }
      if (f.type === "agent_speech" && (f.agent_id === a || f.agent_id === b) && f.town === town) lines++;
    }
    if (lines >= 2 && end > i) return { index: i, end, a, b, location: e.conversation.location, topic: e.conversation.topic };
  }
  return null;
}

/** Centre the camera on two residents at a spotlight zoom. */
export async function frameOnPair(page, a, b, zoom = 1.7) {
  return page.evaluate(([aId, bId, z]) => {
    const scene = window.__townshipScene;
    const sa = scene?.agentSprites?.get(aId);
    const sb = scene?.agentSprites?.get(bId);
    if (!scene || !sa || !sb) return false;
    window.__town?.setOverviewMode(false);
    const cam = scene.cameras.main;
    cam.panEffect?.reset();
    cam.zoomEffect?.reset();
    cam.setZoom(z);
    cam.centerOn((sa.x + sb.x) / 2, (sa.y + sb.y) / 2 - 44); // room for the bubbles above their heads
    return true;
  }, [a, b, zoom]);
}

export async function framePollingPlace(page, zoom = 1.7) {
  return page.evaluate((z) => {
    const scene = window.__townshipScene;
    const poll = scene?.civic?.getPollingPlace?.();
    if (!scene || !poll) return false;
    window.__town?.setOverviewMode(false);
    const cam = scene.cameras.main;
    cam.panEffect?.reset();
    cam.zoomEffect?.reset();
    cam.setZoom(z);
    cam.centerOn(poll.x, poll.y + 8);
    return true;
  }, zoom);
}

async function overview(page) {
  await page.evaluate(() => {
    const scene = window.__townshipScene;
    const cam = scene?.cameras?.main;
    cam?.panEffect?.reset();
    cam?.zoomEffect?.reset();
    window.__town?.setOverviewMode(false);
    window.__town?.setOverviewMode(true);
  });
}

/** The day-in-review card belongs to the week beat, not the polling place. */
async function dismissDayCard(page) {
  const close = page.locator(".day-summary-close").first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function clearBubbles(page) {
  await page.evaluate(() => {
    window.__townshipScene?.agentSprites?.forEach?.((s) => s.clearSpeechBubbles?.());
  });
}

/**
 * The hero's campaign beats, on an open `/town/<town>` route playing the
 * campaign feed. `frame(repeats)` appends the current canvas to the GIF.
 */
export async function heroCampaignBeats({ page, feed, town, frame, setTownMoment, waitForTown }) {
  await waitForTown(page, 12);
  await player(page, "setSpeed", 1);

  // Beat 1 — a weekday morning: the town wakes, commuters leave for work.
  const morning = dayRoundIndex(feed, town, 4, "morning");
  await seekPlayer(page, morning >= 0 ? morning + 1 : 0);
  await overview(page);
  await setTownMoment(page, 8, 15);
  await player(page, "play");
  for (let i = 0; i < 5; i += 1) {
    await clearBubbles(page);
    await frame();
    await page.waitForTimeout(320);
  }
  await player(page, "pause");

  // Beat 2 — a recorded conversation between two voices, its own lines.
  const convo = findVoiceConversation(feed, town, morning);
  if (convo) {
    await seekPlayer(page, convo.index - 1, 900);
    await dismissDayCard(page);
    await player(page, "play");
    await page.waitForTimeout(1_400); // conversation_started lands, the pair walks in, the scene settles
    await frameOnPair(page, convo.a, convo.b, 1.7);
    await page.waitForTimeout(300);
    for (let i = 0; i < 14; i += 1) {
      await frameOnPair(page, convo.a, convo.b, 1.7);
      await frame();
      await page.waitForTimeout(520);
    }
    await player(page, "pause");
    await clearBubbles(page);
    await overview(page);
    await page.waitForTimeout(900);
  }

  // Beat 4 — a week passes: mornings and evenings across days 5–10, the
  // yard signs taking colour as residents make up their minds.
  for (const day of [5, 6, 7, 8, 9, 10]) {
    const beat = day % 2 ? "morning" : "evening";
    const idx = dayRoundIndex(feed, town, day, beat);
    if (idx < 0) continue;
    await seekPlayer(page, idx + 1, 900);
    await overview(page);
    await setTownMoment(page, beat === "morning" ? 9 : 19, 30);
    await clearBubbles(page);
    await page.waitForTimeout(300);
    await frame(2);
  }

  // Beat 5 — election day: the polling place opens and residents queue,
  // vote and take their stickers; then results night.
  const events = feed.events;
  const firstBallot = events.findIndex((e) => e.type === "ballot_cast" && e.town === town);
  if (firstBallot >= 0) {
    await seekPlayer(page, firstBallot - 6, 900);
    await dismissDayCard(page);
    await setTownMoment(page, 8, 45);
    await framePollingPlace(page, 1.7);
    await player(page, "play");
    for (let i = 0; i < 9; i += 1) {
      await clearBubbles(page);
      await frame();
      await page.waitForTimeout(1_200);
    }
    await player(page, "pause");
  }
  const result = events.findIndex((e) => e.type === "election_result" && e.town === town);
  if (result >= 0) {
    await seekPlayer(page, result + 2, 900);
    await dismissDayCard(page);
    await setTownMoment(page, 21, 0);
    await framePollingPlace(page, 1.45);
    await page.waitForTimeout(400);
    await frame(3);
    await overview(page);
    await page.waitForTimeout(500);
    await frame(4);
  }
}

/** The day-in-review card as the calendar turns, on the campaign feed. */
export async function captureDayInReview(page, feed, town, shot, outPath) {
  const dayTwo = dayRoundIndex(feed, town, 6, "morning");
  if (dayTwo < 0) return false;
  await seekPlayer(page, dayTwo - 4, 500);
  await player(page, "setSpeed", 1);
  await player(page, "play");
  await page.locator(".day-summary-card").waitFor({ state: "visible", timeout: 20_000 });
  await player(page, "pause");
  await overview(page);
  await page.waitForTimeout(400);
  await shot(page, outPath);
  return true;
}

/** The roster with its neighbors group open. */
export async function captureNeighbors(page, shot, outPath) {
  const summary = page.locator(".roster-group-summary").first();
  await summary.waitFor({ state: "visible", timeout: 20_000 });
  await summary.click();
  await page.waitForTimeout(400);
  await shot(page, outPath);
}

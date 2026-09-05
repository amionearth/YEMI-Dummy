// Golden test for openpets.water-reminder.
import assert from "node:assert/strict";
import {
  DAY_MS,
  SNOOZE_MS,
  cleanState,
  paceDelayMs,
  recordDrinkState,
  register,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

const realDateNow = Date.now;
let activeClock;
function createHarness(...args) {
  const harness = createTestHarness(...args);
  activeClock = harness.clock;
  return harness;
}
Date.now = () => activeClock?.now() ?? realDateNow();

assert.equal(paceDelayMs("gentle"), 60 * 60_000);
assert.equal(paceDelayMs("normal"), 45 * 60_000);
assert.equal(paceDelayMs("often"), 30 * 60_000);
assert.equal(paceDelayMs("surprise"), 45 * 60_000);
assert.deepEqual(cleanState({ lastDrinkAt: 10, pausedUntil: 20, streakDays: 2 }), {
  lastDrinkAt: 10,
  pausedUntil: 20,
  lastStreakCelebratedDate: "",
  streakDays: 2,
  nextDueAt: 0,
});
assert.equal(recordDrinkState({}, 1_700_000_000_000).streakDays, 1);
assert.equal(
  recordDrinkState(recordDrinkState({}, 1_700_000_000_000), 1_700_000_000_000 + DAY_MS).streakDays,
  2,
);

const PERMISSIONS = ["pet:speak", "pet:interact", "audio", "schedule", "storage", "commands"];
const LOCALES = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8",
    ),
  ),
};

// 1) start schedules the next reminder.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "often" },
    locales: LOCALES,
    nowMs: 1_000_000,
  });
  await h.start();
  assert.equal(h.calls.schedules.size, 1, "expected one active schedule");
  h.expectStored("state", (v) => v.nextDueAt > Date.now() && v.nextDueAt <= Date.now() + 30 * 60_000 + 1_000);
  h.expectNoErrors();
}

// 2) reminder alert uses Done/Later and no sound without customSound.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "often" },
    locales: LOCALES,
    nowMs: 2_000_000,
  });
  await h.start();
  await h.clock.advance("31m");
  h.expectBubble({
    indicator: {
      icon: { kind: "icon", name: "water" },
      label: "Water reminder",
      tone: "info",
      color: "#0ea5e9",
      background: "#e0f2fe",
      borderColor: "#7dd3fc",
    },
    tone: "info",
    sticky: true,
    priority: "high",
  });
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  assert.deepEqual(bubble.spec.actions?.map((a) => a.id), ["done", "later"]);
  assert.equal(h.calls.alerts.length, 1, "expected ctx.ui.alert delivery");
  assert.equal(h.calls.sounds.length, 0, "custom sound unset — no sound should play");
  h.expectNoErrors();
}

// 2b) stale due times reset on launch instead of firing immediately.
{
  const nowMs = 2_500_000;
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "often" },
    locales: LOCALES,
    nowMs,
  });
  await h.ctx.storage.set("state", { nextDueAt: nowMs - 1, lastDrinkAt: nowMs - 31 * 60_000 });
  await h.start();
  h.expectStored("state", (v) => v.nextDueAt > Date.now() + 29 * 60_000);
  await h.clock.advance("1s");
  assert.equal(h.calls.alerts.length, 0, "stale launch state should not fire immediately");
  h.expectNoErrors();
}

// 2c) A callback queued before startup reconciliation cannot deliver early.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "often" },
    locales: LOCALES,
    nowMs: 2_750_000,
  });
  const handlers = [];
  const once = h.ctx.schedule.once;
  h.ctx.schedule.once = async (id, delayMs, handler) => {
    handlers.push(handler);
    return once(id, delayMs, handler);
  };
  await h.start();
  const staleHandler = handlers[0];
  await h.clock.advance("1s");
  await h.start();
  await staleHandler();
  assert.equal(h.calls.alerts.length, 0, "stale scheduled callback must not show an alert");
  h.expectNoErrors();
}

// 3) Done records a drink and does not create duplicate success reactions.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "normal" },
    locales: LOCALES,
    nowMs: 3_000_000,
  });
  await h.start();
  await h.clock.advance("46m");
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  await h.fireBubbleAction(bubble.handle.id, "done");
  h.expectStored("state", (v) => v.lastDrinkAt > 0 && v.streakDays === 1);
  assert.equal(h.calls.reactions?.length ?? 0, 0, "should not call generic success reactions");
  assert.equal(h.calls.schedules.size, 1, "expected exactly one next reminder");
  h.expectNoErrors();
}

// 4) Later snoozes for 15 minutes.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "often" },
    locales: LOCALES,
    nowMs: 4_000_000,
  });
  await h.start();
  await h.clock.advance("31m");
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  await h.fireBubbleAction(bubble.handle.id, "later");
  h.expectStored("state", (v) => v.nextDueAt > Date.now() && v.nextDueAt <= Date.now() + SNOOZE_MS + 1_000);
  assert.equal(h.calls.schedules.size, 1, "expected one snooze schedule");
  h.expectNoErrors();
}

// 5) pause-today stores pausedUntil and speaks.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
  });
  await h.start();
  await h.runCommand("pause-today");
  h.expectStored("state", (v) => v.pausedUntil > Date.now() && v.pausedUntil <= Date.now() + DAY_MS);
  h.expectSpoke(/Paused for today/);
  h.expectNoErrors();
}

// 6) drink-now command speaks localized done and schedules from now.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "gentle" },
    locales: LOCALES,
    nowMs: 6_000_000,
  });
  await h.start();
  await h.runCommand("drink-now");
  h.expectSpoke(/Nice/);
  h.expectStored("state", (v) => v.lastDrinkAt > 0 && v.nextDueAt > Date.now() + 59 * 60_000);
  h.expectNoErrors();
}

// 7) custom sound only plays when configured.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "often", customSound: "chime" },
    locales: LOCALES,
    nowMs: 7_000_000,
  });
  await h.start();
  await h.clock.advance("31m");
  assert.ok(h.calls.sounds.some((s) => s.sound === "chime"), "expected configured sound");
  h.expectNoErrors();
}

// 8) test-reminder command previews the water alert with the droplet icon.
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    config: { pace: "normal" },
    locales: LOCALES,
    nowMs: 8_000_000,
  });
  await h.start();
  await h.runCommand("test-reminder");
  h.expectBubble({
    indicator: {
      icon: { kind: "icon", name: "water" },
      label: "Water reminder",
      tone: "info",
      color: "#0ea5e9",
      background: "#e0f2fe",
      borderColor: "#7dd3fc",
    },
    tone: "info",
    sticky: true,
    priority: "high",
  });
  assert.equal(h.calls.alerts.length, 1, "expected test command to deliver ctx.ui.alert");
  h.expectNoErrors();
}

Date.now = realDateNow;
console.log("openpets.water-reminder: all checks passed.");

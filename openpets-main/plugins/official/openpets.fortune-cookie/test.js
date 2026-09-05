// Golden test for openpets.fortune-cookie.
import assert from "node:assert/strict";
import {
  DEFAULT_DAILY_TIME,
  FORTUNE_COUNT,
  SCHEDULE_ID,
  cleanState,
  fireDailyFortune,
  fortuneIndexForDate,
  localDateKey,
  normalizeDailyTime,
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

assert.equal(normalizeDailyTime("9:05"), "09:05");
assert.equal(normalizeDailyTime("23:59"), "23:59");
assert.equal(normalizeDailyTime("24:00"), DEFAULT_DAILY_TIME);
assert.equal(normalizeDailyTime("soon"), DEFAULT_DAILY_TIME);
assert.equal(localDateKey(new Date(2026, 0, 2, 8).getTime()), "2026-01-02");
assert.equal(fortuneIndexForDate("2026-01-02"), fortuneIndexForDate("2026-01-02"));
assert.notEqual(fortuneIndexForDate("2026-01-02"), fortuneIndexForDate("2026-01-03"));
assert.deepEqual(cleanState({ lastShownDate: "2026-01-02", anotherOffset: 2.8 }), {
  lastShownDate: "2026-01-02",
  anotherOffset: 2,
});

const PERMISSIONS = ["pet:speak", "schedule", "storage", "commands"];
const LOCALES = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8",
    ),
  ),
};

function assertNoMixedBodyMedia(h) {
  for (const bubble of h.calls.bubbles) {
    assert.equal(Boolean(bubble.spec.icon && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body icon must not be combined with text/markdown");
    assert.equal(Boolean(bubble.spec.svg && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body svg must not be combined with text/markdown");
    assert.equal(Boolean(bubble.spec.image && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body image must not be combined with text/markdown");
  }
}

async function withFakeNow(nowMs, run) {
  const original = Date.now;
  Date.now = () => nowMs;
  try {
    return await run();
  } finally {
    Date.now = original;
  }
}

// 1) start registers the daily schedule at configured time and both commands.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    config: { dailyTime: "08:30" },
    locales: LOCALES,
    nowMs: new Date(2026, 0, 2, 7).getTime(),
  });
  await h.start();
  h.expectScheduled(SCHEDULE_ID);
  assert.equal(h.calls.schedules.get(SCHEDULE_ID).daily.time, "08:30");
  assert.deepEqual([...h.calls.commands.keys()], ["today-fortune", "another-fortune"]);
  h.expectNoErrors();
}

// 2) scheduled daily fortune stores lastShownDate and does not spam twice.
{
  await withFakeNow(new Date(2026, 0, 2, 10).getTime(), async () => {
    const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.now() });
    await h.start();
    assert.equal(await fireDailyFortune(h.ctx), true);
    h.expectSpoke(/Today's fortune:/);
    h.expectBubble({
      indicator: {
        icon: { kind: "icon", name: "fortune" },
        label: "Daily Fortune Cookie",
        tone: "info",
        color: "#d97706",
        background: "#fef3c7",
        borderColor: "#fbbf24",
      },
    });
    h.expectStored("state", (v) => v.lastShownDate === "2026-01-02");
    assertNoMixedBodyMedia(h);
    const spokeCount = h.calls.speak.length;
    assert.equal(await fireDailyFortune(h.ctx), false);
    assert.equal(h.calls.speak.length, spokeCount, "same day schedule should not speak twice");
    h.expectNoErrors();
  });
}

// 3) today command is deterministic and does not mark scheduled delivery as shown.
{
  await withFakeNow(new Date(2026, 2, 4, 9).getTime(), async () => {
    const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.now() });
    await h.start();
    await h.runCommand("today-fortune");
    await h.runCommand("today-fortune");
    const todayFortune = LOCALES.en[`fortune.${fortuneIndexForDate("2026-03-04")}`];
    assert.ok(h.calls.speak.every((message) => message.includes(todayFortune)), "today command should use the same dated fortune");
    assert.equal(h.calls.storage.has("state"), false, "today command should not suppress the scheduled daily fortune");
    h.expectNoErrors();
  });
}

// 4) another command rotates to a different fortune and persists offset.
{
  await withFakeNow(new Date(2026, 4, 6, 12).getTime(), async () => {
    const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.now() });
    await h.start();
    await h.runCommand("today-fortune");
    const todayMessage = h.calls.speak[h.calls.speak.length - 1];
    await h.runCommand("another-fortune");
    const anotherMessage = h.calls.speak[h.calls.speak.length - 1];
    assert.notEqual(anotherMessage, todayMessage, "another fortune should differ from today's fortune");
    h.expectStored("state", (v) => v.anotherOffset === 1);
    assert.ok(h.calls.speak.length === 2);
    h.expectNoErrors();
  });
}

// 5) no reactions, network, notifications, or errors are produced.
{
  await withFakeNow(new Date(2026, 6, 8, 10).getTime(), async () => {
    const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.now() });
    await h.start();
    await h.runCommand("another-fortune");
    assert.equal(h.calls.react.length, 0, "fortune cookie should not trigger reactions");
    assert.equal(h.calls.netCalls.length, 0, "fortune cookie should not use network");
    assert.equal(h.calls.notifications.length, 0, "fortune cookie should not notify");
    assert.ok(FORTUNE_COUNT >= 10, "expected a curated local fortune set");
    h.expectNoErrors();
  });
}

console.log("openpets.fortune-cookie: all checks passed.");

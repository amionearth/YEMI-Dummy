// Golden test for openpets.day-routine.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EVENING_SCHEDULE_ID,
  LAST_EVENING_KEY,
  LAST_MORNING_KEY,
  MORNING_SCHEDULE_ID,
  PAUSED_DATE_KEY,
  fireMorning,
  localDateKey,
  nextLocalTimeMs,
  parseTime,
  register,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}

assert.deepEqual(parseTime("21:30", "09:00"), { hour: 21, minute: 30 });
assert.deepEqual(parseTime("bad", "08:15"), { hour: 8, minute: 15 });
assert.equal(nextLocalTimeMs("09:00", new Date(2026, 0, 1, 8, 0).getTime()), new Date(2026, 0, 1, 9, 0).getTime());
assert.equal(nextLocalTimeMs("09:00", new Date(2026, 0, 1, 10, 0).getTime()), new Date(2026, 0, 2, 9, 0).getTime());

const PERMISSIONS = ["pet:speak", "schedule", "storage", "commands"];
const LOCALES = { en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")) };
const MESSAGE_FILTER_PATTERN = /```|<script|function\s+\w+|=>|\b(class|import|export|const|let|var)\b|https?:\/\/|www\.|\/[\w.-]+\/[\w./-]+|[A-Za-z]:\\/;

for (const [key, value] of Object.entries(LOCALES.en)) {
  if (key.startsWith("speech.")) {
    assert.equal(MESSAGE_FILTER_PATTERN.test(value), false, `${key} must pass the host speech safety filter`);
  }
}

function assertNoMixedBodyMedia(h) {
  for (const bubble of h.calls.bubbles) {
    assert.equal(Boolean(bubble.spec.icon && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body icon must not be combined with text/markdown");
    assert.equal(Boolean(bubble.spec.svg && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body svg must not be combined with text/markdown");
    assert.equal(Boolean(bubble.spec.image && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body image must not be combined with text/markdown");
  }
}

// 1) Start schedules local morning/evening and does not speak on launch.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { morningTime: "09:00", eveningTime: "21:00" },
    nowMs: new Date(2026, 0, 1, 8, 0).getTime(),
  });
  await h.start();
  assert.equal(h.calls.schedules.size, 2, "expected morning and evening schedules");
  assert.ok(h.calls.schedules.has(MORNING_SCHEDULE_ID));
  assert.ok(h.calls.schedules.has(EVENING_SCHEDULE_ID));
  assert.equal(h.calls.speak.length, 0, "start should not spam speech");
  h.expectNoErrors();
}

// 2) Morning fires once per date and stores lastMorningDate.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { morningTime: "09:00", eveningTime: "21:00" },
    nowMs: new Date(2026, 0, 1, 8, 55).getTime(),
  });
  await h.start();
  await h.clock.advance("6m");
  h.expectSpoke(/Good morning/);
  h.expectBubble({
    indicator: {
      icon: { kind: "icon", name: "routine" },
      label: "Morning & Evening Routine",
      tone: "info",
      color: "#f97316",
      background: "#ffedd5",
      borderColor: "#fdba74",
    },
  });
  h.expectStored(LAST_MORNING_KEY, (v) => v === localDateKey());
  assert.equal(h.calls.reactions?.length ?? 0, 0, "routine should not use reactions");
  assertNoMixedBodyMedia(h);
  const speechCount = h.calls.speak.length;
  await fireMorning(h.ctx);
  assert.equal(h.calls.speak.length, speechCount, "second same-day morning should be suppressed");
  h.expectNoErrors();
}

// 3) Evening fires once per date and stores lastEveningDate.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { morningTime: "09:00", eveningTime: "21:00" },
    nowMs: new Date(2026, 0, 1, 20, 59).getTime(),
  });
  await h.start();
  await h.clock.advance("2m");
  h.expectSpoke(/Evening check-in/);
  h.expectStored(LAST_EVENING_KEY, (v) => v === localDateKey());
  h.expectNoErrors();
}

// 4) Commands deliver clear moments and respect once-per-day storage keys.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: new Date(2026, 0, 2, 12, 0).getTime(),
  });
  await h.start();
  assert.deepEqual(h.calls.commands.get("morning-now")?.meta.icon, { kind: "icon", name: "routine" });
  await h.runCommand("morning-now");
  await h.runCommand("evening-now");
  await h.runCommand("morning-now");
  h.expectStored(LAST_MORNING_KEY, (v) => v === localDateKey());
  h.expectStored(LAST_EVENING_KEY, (v) => v === localDateKey());
  assert.equal(h.calls.speak.length, 3, "manual commands should always produce feedback");
  h.expectNoErrors();
}

// 5) Pause today stores the date and suppresses scheduled check-ins.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { morningTime: "09:00", eveningTime: "21:00" },
    nowMs: new Date(2026, 0, 3, 8, 55).getTime(),
  });
  await h.start();
  await h.runCommand("pause-today");
  h.expectStored(PAUSED_DATE_KEY, (v) => v === localDateKey());
  h.expectSpoke(/Paused for today/);
  const speechCount = h.calls.speak.length;
  await h.clock.advance("6m");
  assert.equal(h.calls.speak.length, speechCount, "paused day should not add morning speech");
  h.expectNoErrors();
}

// 6) Disabled morning cancels only that schedule.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { enableMorning: false, enableEvening: true, eveningTime: "21:00" },
  });
  await h.start();
  assert.equal(h.calls.schedules.has(MORNING_SCHEDULE_ID), false);
  assert.equal(h.calls.schedules.has(EVENING_SCHEDULE_ID), true);
  assert.equal(h.calls.netCalls?.length ?? 0, 0, "no network calls expected");
  assert.equal(h.calls.reactions?.length ?? 0, 0, "no reactions expected");
  h.expectNoErrors();
}

console.log("openpets.day-routine: all checks passed.");

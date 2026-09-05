// Golden test for openpets.mood-check-in.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_HISTORY,
  addMood,
  cleanState,
  nextCheckInMs,
  normalizeTime,
  recordMood,
  register,
  todayKey,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}
if (typeof createTestHarness !== "function") {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}

assert.equal(normalizeTime("7:05"), "07:05");
assert.equal(normalizeTime("26:00"), "16:00");
const localBefore = new Date(2026, 0, 1, 15, 0).getTime();
const localDue = new Date(2026, 0, 1, 16, 0).getTime();
const localAfter = new Date(2026, 0, 1, 17, 0).getTime();
const localTomorrowDue = new Date(2026, 0, 2, 16, 0).getTime();
assert.equal(nextCheckInMs("16:00", localBefore), localDue);
assert.equal(nextCheckInMs("16:00", localAfter), localTomorrowDue);
assert.equal(addMood(Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, mood: "okay" })), "great", Date.UTC(2026, 0, 25)).length, MAX_HISTORY);
assert.deepEqual(cleanState({ history: [{ date: "x", mood: "bad" }, { date: "y", mood: "great" }] }).history, [{ date: "y", mood: "great" }]);

const PERMISSIONS = ["pet:speak", "pet:interact", "schedule", "storage", "commands"];
const LOCALES = {
  en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")),
};

function timeInMinutes(minutes) {
  const date = new Date(Date.now() + minutes * 60_000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// 1) start schedules the daily check-in.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, config: { checkInTime: timeInMinutes(60) }, locales: LOCALES, nowMs: localBefore });
  await h.start();
  assert.equal(h.calls.schedules.size, 1, "expected one daily schedule");
  h.expectStored("mood-check-in-state", (v) => v.nextDueAt > Date.now());
  h.expectNoErrors();
}

// 2) due schedule opens alert with mood actions and bundled icon.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, config: { checkInTime: timeInMinutes(1) }, locales: LOCALES, nowMs: new Date(2026, 0, 1, 15, 59).getTime() });
  await h.start();
  await h.clock.advance("2m");
  h.expectBubble({ indicator: { icon: { kind: "icon", name: "mood" }, label: "Mood check-in", tone: "info", color: "#db2777", background: "#fce7f3", borderColor: "#f9a8d4" }, tone: "info", sticky: true, priority: "high" });
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  assert.deepEqual(bubble.spec.actions?.map((a) => a.id), ["great", "okay", "tired", "stressed"]);
  assert.equal(h.calls.alerts.length, 1, "expected ctx.ui.alert delivery");
  h.expectNoErrors();
}

// 3) action records one bounded mood entry, speaks support, and does not react.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.UTC(2026, 0, 2, 16, 0) });
  await h.start();
  await h.runCommand("check-in-now");
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  await h.fireBubbleAction(bubble.handle.id, "tired");
  h.expectStored("mood-check-in-state", (v) => v.history.length === 1 && v.history[0].mood === "tired");
  h.expectSpoke(/small pause/i);
  assert.equal(h.calls.reactions?.length ?? 0, 0, "should not call pet reactions");
  h.expectNoErrors();
}

// 4) history remains bounded.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.UTC(2026, 0, 20, 12, 0) });
  await h.start();
  for (let i = 0; i < 20; i += 1) await recordMood(h.ctx, i % 2 ? "okay" : "great");
  h.expectStored("mood-check-in-state", (v) => v.history.length <= MAX_HISTORY);
  h.expectNoErrors();
}

// 5) pause today stores today's pause and prevents due alert duplication.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, config: { checkInTime: timeInMinutes(1) }, locales: LOCALES, nowMs: new Date(2026, 0, 3, 15, 59).getTime() });
  await h.start();
  await h.runCommand("pause-today");
  h.expectSpoke(/Paused for today/);
  h.expectStored("mood-check-in-state", (v) => v.pausedDate === todayKey());
  await h.clock.advance("2m");
  assert.equal(h.calls.alerts.length, 0, "paused day should not show check-in alert");
  h.expectNoErrors();
}

// 6) summary command handles empty and recent history.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.UTC(2026, 0, 4, 12, 0) });
  await h.start();
  await h.runCommand("mood-summary");
  h.expectSpoke(/No mood check-ins/);
  await recordMood(h.ctx, "stressed");
  await h.runCommand("mood-summary");
  h.expectSpoke(/most common one was Stressed/);
  h.expectNoErrors();
}

// 7) force command may be run twice, but a single action for today updates one entry.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: Date.UTC(2026, 0, 5, 12, 0) });
  await h.start();
  await h.runCommand("check-in-now");
  await h.runCommand("check-in-now");
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  await h.fireBubbleAction(bubble.handle.id, "okay");
  h.expectStored("mood-check-in-state", (v) => v.history.length === 1 && v.history[0].mood === "okay");
  assert.equal(h.calls.net?.length ?? 0, 0, "plugin should not use network");
  h.expectNoErrors();
}

console.log("openpets.mood-check-in: all checks passed.");

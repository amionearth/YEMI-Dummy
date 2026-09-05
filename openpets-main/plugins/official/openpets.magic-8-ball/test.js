// Golden test for openpets.magic-8-ball.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ANSWER_COUNT,
  MAX_HISTORY,
  askMagic8Ball,
  cleanQuestion,
  normalizeHistory,
  pickAnswerKey,
  register,
  showLastAnswer,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}

assert.equal(cleanQuestion("  Should I?\n\nMaybe?  "), "Should I? Maybe?");
assert.equal(cleanQuestion(null), "");
assert.equal(cleanQuestion("x".repeat(200)).length, 160);
assert.equal(pickAnswerKey(() => 0), "answer.1");
assert.equal(pickAnswerKey(() => 0.999999), `answer.${ANSWER_COUNT}`);
assert.deepEqual(normalizeHistory([{ askedAt: 1, answerKey: "answer.1" }, null, { bad: true }]), [
  { askedAt: 1, answerKey: "answer.1" },
]);

const PERMISSIONS = ["pet:speak", "commands", "storage"];
const LOCALES = { en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")) };

function withRandom(value, fn) {
  const oldRandom = Math.random;
  Math.random = () => value;
  return Promise.resolve(fn()).finally(() => {
    Math.random = oldRandom;
  });
}

function assertNoNetworkOrReactions(h) {
  assert.equal(h.calls.reactions?.length ?? 0, 0, "should not create duplicate reactions");
  assert.equal(h.calls.netCalls.length, 0, "should not call network");
}

function assertNoMixedBodyMedia(h) {
  for (const bubble of h.calls.bubbles) {
    assert.equal(Boolean(bubble.spec.icon && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body icon must not be combined with text/markdown");
    assert.equal(Boolean(bubble.spec.svg && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body svg must not be combined with text/markdown");
    assert.equal(Boolean(bubble.spec.image && (bubble.spec.text || bubble.spec.markdown)), false, "bubble body image must not be combined with text/markdown");
  }
}

// 1) start registers three commands, including a form command with bundled icon.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 1_000_000 });
  await h.start();
  assert.deepEqual(h.calls.commands.get("ask-decision")?.meta.icon, { kind: "icon", name: "magic8" });
  assert.equal(h.calls.commands.get("ask-decision")?.meta.form?.fields?.[0]?.id, "question");
  assert.equal(h.calls.commands.get("quick-answer")?.meta.title, "$t:command.quickAnswer.title");
  assert.equal(h.calls.commands.get("show-last")?.meta.title, "$t:command.showLast.title");
  h.expectNoErrors();
}

// 2) ask-decision cleans question, speaks once, and stores bounded history.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 2_000_000 });
  await h.start();
  await withRandom(0, () => h.runCommand("ask-decision", { question: "  Should I refactor?\nToday?  " }));
  h.expectSpoke(/Should I refactor\? Today\?/);
  h.expectSpoke(/Signs point to a cheerful yes/);
  h.expectBubble({
    indicator: {
      icon: { kind: "icon", name: "magic8" },
      label: "Magic 8-Ball",
      tone: "info",
      color: "#7c3aed",
      background: "#ede9fe",
      borderColor: "#c4b5fd",
    },
  });
  h.expectStored("history", (v) => v.length === 1 && v[0].question === "Should I refactor? Today?" && v[0].answerKey === "answer.1");
  assert.equal(h.calls.speak.length, 1, "one command should produce one speech feedback");
  assertNoNetworkOrReactions(h);
  assertNoMixedBodyMedia(h);
  h.expectNoErrors();
}

// 3) quick answer stores an answer without a question.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 3_000_000 });
  await h.start();
  await withRandom(0.999999, () => h.runCommand("quick-answer"));
  h.expectSpoke(/calmer path/);
  h.expectStored("history", (v) => v.length === 1 && v[0].question === "" && v[0].answerKey === "answer.16");
  assertNoNetworkOrReactions(h);
  h.expectNoErrors();
}

// 4) helper storage caps last/history entries.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 4_000_000 });
  for (let i = 0; i < MAX_HISTORY + 3; i += 1) {
    await withRandom(0, () => askMagic8Ball(h.ctx, { question: `q${i}` }));
  }
  h.expectStored("history", (v) => v.length === MAX_HISTORY && v[0].question === `q${MAX_HISTORY + 2}`);
  assertNoNetworkOrReactions(h);
  h.expectNoErrors();
}

// 5) show-last handles empty and populated paths.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 5_000_000 });
  await h.start();
  await h.runCommand("show-last");
  h.expectSpoke(/No Magic 8-Ball answers yet/);
  await withRandom(0, () => h.runCommand("ask-decision", { question: "Tea?" }));
  await h.runCommand("show-last");
  h.expectSpoke(/Last time for/);
  h.expectSpoke(/Tea\?/);
  h.expectNoErrors();
}

// 6) direct showLastAnswer returns the stored item and does not throw.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 6_000_000 });
  await h.ctx.storage.set("history", [{ askedAt: Date.now(), question: "Walk?", answerKey: "answer.2" }]);
  const last = await showLastAnswer(h.ctx);
  assert.equal(last.question, "Walk?");
  h.expectSpoke(/Looks promising/);
  assertNoNetworkOrReactions(h);
  h.expectNoErrors();
}

console.log("openpets.magic-8-ball: all checks passed.");

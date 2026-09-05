// Behavioral tests for openpets.higgsfield-watch.
import assert from "node:assert/strict";
import { register } from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

const permissions = [
  "network",
  "schedule",
  "storage",
  "pet:speak",
  "pet:reaction",
  "commands",
  "status",
];

const locales = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8",
    ),
  ),
};

const JOBS = "https://fnf.higgsfield.ai/agents/jobs";

const h = createTestHarness(register, {
  permissions,
  locales,
  config: { apiToken: "test-token", pollIntervalSeconds: 10, announceStarts: true },
});

// Seed poll: one already-completed job — must be absorbed silently.
h.net.mock(JOBS, { status: 200, json: [{ id: "old-1", status: "completed", display_name: "Seedream 5.0 Pro", result_url: "https://cdn.example/x.png" }] });
await h.start();

const commandIds = [...h.calls.commands.keys()];
assert.ok(commandIds.includes("hf-check-now"), "registers check-now command");
assert.ok(commandIds.includes("hf-reset-state"), "registers reset command");
assert.ok(h.calls.schedules.has("hf-poll"), "schedules the polling loop");
assert.equal(h.calls.speak.length, 0, "first poll seeds silently");

// A new pending job appears — the pet announces tracking.
h.net.mock(JOBS, { status: 200, json: [
  { id: "old-1", status: "completed", display_name: "Seedream 5.0 Pro", result_url: "https://cdn.example/x.png" },
  { id: "new-1", status: "queued", display_name: "Nano Banana Pro" },
] });
await h.clock.advance("10s");
assert.ok(h.calls.speak.some((m) => m.includes("Tracking 1 new Higgsfield generation")), "announces new pending job");

// The job completes — the pet celebrates with the model name and kind.
h.net.mock(JOBS, { status: 200, json: [
  { id: "old-1", status: "completed", display_name: "Seedream 5.0 Pro", result_url: "https://cdn.example/x.png" },
  { id: "new-1", status: "completed", display_name: "Nano Banana Pro", result_url: "https://cdn.example/y.png" },
] });
await h.clock.advance("10s");
assert.ok(h.calls.speak.some((m) => m.includes("Your Nano Banana Pro image is ready!")), "celebrates completion");
assert.ok(h.calls.react.includes("celebrating"), "celebrating reaction fires");

// Expired token — status warns, no crash.
h.net.mock(JOBS, { status: 401, json: {} });
await h.clock.advance("10s");
const lastStatus = h.calls.status[h.calls.status.length - 1];
assert.ok(String(lastStatus?.text || "").includes("token expired"), "warns on expired token");

h.expectNoErrors();
await h.stop();

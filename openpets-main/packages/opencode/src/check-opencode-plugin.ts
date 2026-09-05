import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { OpenPetsClient, OpenPetsReaction } from "@open-pets/client";

import plugin, { openPetsOpenCodePluginId } from "./plugin.js";
import { classifyOpenCodeBusEvent, classifyOpenCodeToolReaction, createOpenPetsOpenCodeHooks, getDefaultOpenCodeThrottlePath, isReactionExcluded, shouldIgnoreOpenPetsTool } from "./opencode-plugin-runtime.js";

assert.equal(plugin.id, openPetsOpenCodePluginId);
assert.equal(typeof plugin.server, "function");
const packagePlugin = await import("@open-pets/opencode/server");
assert.equal(packagePlugin.default.id, openPetsOpenCodePluginId);
assert.equal(typeof packagePlugin.default.server, "function");

assert.equal(classifyOpenCodeToolReaction("edit", {}), "editing");
assert.equal(classifyOpenCodeToolReaction("apply_patch", {}), "editing");
assert.equal(classifyOpenCodeToolReaction("bash", { command: "pnpm test" }), "testing");
assert.equal(classifyOpenCodeToolReaction("shell", { command: "ls" }), undefined);
assert.equal(classifyOpenCodeToolReaction("read", {}), undefined);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_status"), true);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_say"), true);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_react"), true);
assert.equal(shouldIgnoreOpenPetsTool("openpets_status"), true);
assert.deepEqual(classifyOpenCodeBusEvent({ type: "permission.asked" }), { reaction: "waiting", speechCategory: "permission" });
assert.equal(classifyOpenCodeBusEvent({ type: "permission.asked", properties: { permission: "openpets_openpets_say" } }), undefined);
assert.equal(classifyOpenCodeBusEvent({ payload: { type: "permission.asked", properties: { patterns: ["openpets_openpets_react"] } } }), undefined);
assert.deepEqual(classifyOpenCodeBusEvent({ type: "session.error" }), { reaction: "error", speechCategory: "error" });
assert.deepEqual(classifyOpenCodeBusEvent({ type: "session.status", properties: { status: { type: "idle" } } }), { reaction: "success" });
assert.ok(getDefaultOpenCodeThrottlePath().includes("opencode-hook-throttle.json"));

assert.throws(() => createOpenPetsOpenCodeHooks({ pet: "bad/pet" }));

const dir = mkdtempSync(join(tmpdir(), "openpets-opencode-plugin-"));
try {
  const calls: Array<{ readonly kind: string; readonly value: string; readonly leaseId?: string; readonly requestedPetId?: string }> = [];
  let releaseBlockedReact: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { releaseBlockedReact = resolve; });
  const client: OpenPetsClient = {
    hello: async () => ({}),
    status: async () => ({ ok: true, appRunning: true }),
    listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
    installPet: async () => { throw new Error("unused"); },
    installLocalPet: async () => { throw new Error("unused"); },
    acquireLease: async (options?: { readonly requestedPetId?: string }) => {
      calls.push({ kind: "lease", value: "acquire", requestedPetId: options?.requestedPetId });
      return { leaseId: "lease-fixer", requestedPetId: options?.requestedPetId, targetKind: "explicit", actualTargetPetId: options?.requestedPetId ?? "builtin", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true };
    },
    heartbeatLease: async () => ({ leaseId: "lease-fixer", expiresAt: Date.now() + 15_000 }),
    releaseLease: async () => ({ released: true }),
    react: async (reaction: OpenPetsReaction, options?: { readonly leaseId?: string }) => {
      calls.push({ kind: "react", value: reaction, leaseId: options?.leaseId });
      await blocked;
    },
    say: async (message: string, options?: { readonly leaseId?: string }) => {
      calls.push({ kind: "say", value: message, leaseId: options?.leaseId });
    },
    showMedia: async () => ({ ok: true, shown: true }),
  };

  const scheduled: Array<() => Promise<void>> = [];
  const hooks = createOpenPetsOpenCodeHooks({ pet: "fixer", clientFactory: () => client, schedule: (work) => { scheduled.push(work); }, throttlePath: join(dir, "opencode-hook-throttle.json"), now: () => 100_000, random: () => 0 });
  hooks["chat.message"]({}, { message: { text: "do not use this prompt" } });
  assert.equal(scheduled.length, 1);
  const thinkingWork = scheduled.shift();
  const thinkingPromise = thinkingWork?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls[0], { kind: "lease", value: "acquire", requestedPetId: "fixer" });
  assert.deepEqual(calls[1], { kind: "react", value: "thinking", leaseId: "lease-fixer" });
  releaseBlockedReact?.();
  await thinkingPromise;
  releaseBlockedReact = undefined;

  hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "pnpm test -- --secret" } });
  assert.equal(scheduled.length, 1);
  const work = scheduled.shift();
  const promise = work?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), { kind: "react", value: "testing", leaseId: "lease-fixer" });
  await promise;

  hooks["tool.execute.before"]({ tool: "shell" }, { args: { command: "ls" } });
  assert.equal(scheduled.length, 0);
  hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "pnpm test" } });
  assert.equal(scheduled.length, 1);
  const beforeDuplicateTesting = calls.length;
  await scheduled.shift()?.();
  assert.equal(calls.length, beforeDuplicateTesting, "duplicate testing reaction should be throttled without lease/client work");

  const beforeIgnored = scheduled.length;
  hooks["tool.execute.before"]({ tool: "openpets_openpets_say" }, { args: {} });
  assert.equal(scheduled.length, beforeIgnored);

  hooks.event({ event: { type: "permission.asked", properties: { prompt: "never speak this" } } });
  assert.equal(scheduled.length, 1);
  await scheduled.shift()?.();
  assert.deepEqual(calls.at(-1), { kind: "say", value: "Approval needed", leaseId: "lease-fixer" });

  hooks.event({ event: { type: "session.status", properties: { status: { type: "idle" } } } });
  assert.equal(scheduled.length, 1);
  await scheduled.shift()?.();
  assert.deepEqual(calls.at(-1), { kind: "react", value: "success", leaseId: "lease-fixer" });

  const errors: string[] = [];
  const failingHooks = createOpenPetsOpenCodeHooks({ clientFactory: () => { throw new Error("api_key=secret /tmp/path"); }, schedule: (work) => { void work(); }, debug: true, debugLog: (message) => errors.push(message), throttlePath: join(dir, "fail-throttle.json"), now: () => 200_000 });
  assert.doesNotThrow(() => failingHooks.event({ event: { type: "session.error" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(errors.join("\n"), /<redacted>|<path>/);

  const throwingSchedule = createOpenPetsOpenCodeHooks({ schedule: () => { throw new Error("schedule failed"); }, debug: true, debugLog: (message) => errors.push(message) });
  assert.doesNotThrow(() => throwingSchedule.event({ event: { type: "session.error" } }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const loaded = await plugin.server({}, { pet: "fixer" });
assert.equal(typeof loaded.event, "function");
assert.equal(typeof loaded["chat.message"], "function");
assert.equal(typeof loaded["tool.execute.before"], "function");

// --- excludeReactions tests ---

// isReactionExcluded: basic Set check
assert.equal(isReactionExcluded("success", new Set(["success", "thinking"])), true);
assert.equal(isReactionExcluded("error", new Set(["success", "thinking"])), false);
assert.equal(isReactionExcluded("success", new Set()), false);

// Excluded reaction (success) is NOT sent to client when session.status: idle fires
{
  const dir2 = mkdtempSync(join(tmpdir(), "openpets-opencode-exclude-"));
  try {
    const excludeCalls: string[] = [];
    const excludeClient: OpenPetsClient = {
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
      installPet: async () => { throw new Error("unused"); },
      installLocalPet: async () => { throw new Error("unused"); },
      acquireLease: async () => ({ leaseId: "lease-ex", targetKind: "explicit", actualTargetPetId: "fixer", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true }),
      heartbeatLease: async () => ({ leaseId: "lease-ex", expiresAt: Date.now() + 15_000 }),
      releaseLease: async () => ({ released: true }),
      react: async (reaction: OpenPetsReaction) => { excludeCalls.push(reaction); },
      say: async (message: string) => { excludeCalls.push(`say:${message}`); },
      showMedia: async () => ({ ok: true, shown: true }),
    };
    const scheduled2: Array<() => Promise<void>> = [];
    const hooks2 = createOpenPetsOpenCodeHooks({
      pet: "fixer",
      excludeReactions: ["success", "thinking"],
      clientFactory: () => excludeClient,
      schedule: (work) => { scheduled2.push(work); },
      throttlePath: join(dir2, "throttle.json"),
      now: () => 300_000,
    });

    // session.status idle → success → should be excluded, nothing scheduled
    hooks2.event({ event: { type: "session.status", properties: { status: { type: "idle" } } } });
    assert.equal(scheduled2.length, 0, "excluded success reaction must not schedule any work");

    // chat.message → thinking → should be excluded
    hooks2["chat.message"]({}, {});
    assert.equal(scheduled2.length, 0, "excluded thinking reaction must not schedule any work");

    // session.error → error → NOT excluded, should schedule (with speech)
    hooks2.event({ event: { type: "session.error" } });
    assert.equal(scheduled2.length, 1, "non-excluded error reaction should schedule");
    await scheduled2.shift()?.();
    assert.ok(excludeCalls.at(-1)?.startsWith("say:"), "non-excluded error reaction should reach client via say");

    // tool.execute.before with edit → editing → NOT excluded, should schedule
    hooks2["tool.execute.before"]({ tool: "edit" }, { args: {} });
    assert.equal(scheduled2.length, 1, "non-excluded editing reaction should schedule");
    await scheduled2.shift()?.();
    assert.equal(excludeCalls.at(-1), "editing", "non-excluded editing reaction should reach client");

    assert.equal(excludeCalls.includes("success"), false, "success must never have been sent");
    assert.equal(excludeCalls.includes("thinking"), false, "thinking must never have been sent");
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
}

// Empty excludeReactions array has no effect (current behavior preserved)
{
  const dir3 = mkdtempSync(join(tmpdir(), "openpets-opencode-empty-exclude-"));
  try {
    const emptyExcludeCalls: string[] = [];
    const emptyExcludeClient: OpenPetsClient = {
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
      installPet: async () => { throw new Error("unused"); },
      installLocalPet: async () => { throw new Error("unused"); },
      acquireLease: async () => ({ leaseId: "lease-empty", targetKind: "explicit", actualTargetPetId: "fixer", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true }),
      heartbeatLease: async () => ({ leaseId: "lease-empty", expiresAt: Date.now() + 15_000 }),
      releaseLease: async () => ({ released: true }),
      react: async (reaction: OpenPetsReaction) => { emptyExcludeCalls.push(reaction); },
      say: async () => {},
      showMedia: async () => ({ ok: true, shown: true }),
    };
    const scheduled3: Array<() => Promise<void>> = [];
    const hooks3 = createOpenPetsOpenCodeHooks({
      pet: "fixer",
      excludeReactions: [],
      clientFactory: () => emptyExcludeClient,
      schedule: (work) => { scheduled3.push(work); },
      throttlePath: join(dir3, "throttle.json"),
      now: () => 400_000,
    });
    hooks3.event({ event: { type: "session.status", properties: { status: { type: "idle" } } } });
    assert.equal(scheduled3.length, 1, "empty excludeReactions should not block success");
    await scheduled3.shift()?.();
    assert.equal(emptyExcludeCalls.at(-1), "success");
  } finally {
    rmSync(dir3, { recursive: true, force: true });
  }
}

// Invalid reaction strings are ignored without discarding recognized exclusions.
{
  const scheduled4: Array<() => Promise<void>> = [];
  const hooks4 = createOpenPetsOpenCodeHooks({
    excludeReactions: ["success", "not-a-real-reaction" as OpenPetsReaction, 42 as unknown as OpenPetsReaction],
    schedule: (work) => { scheduled4.push(work); },
    throttlePath: join(dir, "invalid-throttle.json"),
    now: () => 500_000,
  });
  hooks4.event({ event: { type: "session.status", properties: { status: { type: "idle" } } } });
  assert.equal(scheduled4.length, 0, "recognized exclusions remain active when invalid values are present");
}

// Classification is unaffected by filter (filter is in run(), not classify*)
assert.deepEqual(classifyOpenCodeBusEvent({ type: "session.status", properties: { status: { type: "idle" } } }), { reaction: "success" });
assert.deepEqual(classifyOpenCodeToolReaction("edit", {}), "editing");

console.error("OpenCode plugin validation passed.");

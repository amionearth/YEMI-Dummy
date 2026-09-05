import assert from "node:assert/strict";

import { allowedReactions } from "@open-pets/client";

import extension from "./extension.js";
import { classifyPiEvent, classifyPiToolExecutionStart, createOpenPetsPiExtension, createOpenPetsPiRuntime, getPiOpenPetsHelp, normalizePiEvent, parseOpenPetsCommand, shouldIgnoreOpenPetsTool, validateManualSpeech, type OpenPetsPiExtensionApi } from "./runtime.js";

assert.equal(typeof extension, "function");
assert.equal(typeof getPiOpenPetsHelp(), "string");
assert.deepEqual(normalizePiEvent({ type: "agent_start" }), { type: "agent_start", payload: { type: "agent_start" } });
assert.deepEqual(normalizePiEvent({ type: "agent_start", payload: { reason: "startup" } }), { type: "agent_start", payload: { reason: "startup" } });

assert.deepEqual(classifyPiEvent({ type: "session_start", prompt: "secret" }), { reaction: "waving" });
assert.deepEqual(classifyPiEvent({ type: "agent_start" }), { reaction: "thinking" });
assert.deepEqual(classifyPiEvent({ type: "turn_start" }), { reaction: "working" });
assert.deepEqual(classifyPiEvent({ type: "session_shutdown" }), { reaction: "idle" });
assert.deepEqual(classifyPiEvent({ type: "agent_end" }), { reaction: "success", clearError: true });
assert.deepEqual(classifyPiEvent({ type: "tool_execution_end", isError: true, result: "SECRET_STACK" }), { reaction: "error", speech: "error", markError: true });
assert.equal(classifyPiEvent({ type: "tool_execution_end", isError: false, result: "SECRET_STACK" }), undefined);
assert.equal(classifyPiEvent({ type: "input", text: "do not inspect" }), undefined);
assert.equal(classifyPiEvent({ type: "message_update", message: "do not inspect" }), undefined);
assert.equal(classifyPiEvent({ type: "tool_result", content: "do not inspect" }), undefined);

assert.equal(classifyPiToolExecutionStart("edit", {}), "editing");
assert.equal(classifyPiToolExecutionStart("apply_patch", {}), "editing");
assert.equal(classifyPiToolExecutionStart("bash", { command: "pnpm test -- --secret token=abc" }), "testing");
assert.equal(classifyPiToolExecutionStart("bash", { command: "ls" }), "running");
assert.equal(classifyPiToolExecutionStart("read", {}), "working");
assert.equal(classifyPiToolExecutionStart("openpets_status", {}), undefined);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_say"), true);

assert.deepEqual(parseOpenPetsCommand(""), { kind: "help" });
assert.deepEqual(parseOpenPetsCommand("status"), { kind: "status" });
assert.deepEqual(parseOpenPetsCommand("test"), { kind: "test" });
assert.deepEqual(parseOpenPetsCommand("react success"), { kind: "react", reaction: "success" });
assert.deepEqual(parseOpenPetsCommand("say Ready"), { kind: "say", message: "Ready" });
for (const reaction of allowedReactions) assert.deepEqual(parseOpenPetsCommand(`react ${reaction}`), { kind: "react", reaction });
assert.throws(() => parseOpenPetsCommand("react nope"), /Invalid OpenPets reaction/);
assert.throws(() => parseOpenPetsCommand("status extra"), /Usage/);

assert.equal(validateManualSpeech("  Ready  "), "Ready");
for (const unsafe of [
  "",
  "line one\nline two",
  "x".repeat(141),
  "const token = 1",
  "https://example.com",
  "/Users/alvin/secret.txt",
  "../secret.txt",
  "token=abc123",
  "-----BEGIN PRIVATE KEY-----abc",
]) {
  assert.throws(() => validateManualSpeech(unsafe));
}

{
  const calls: string[] = [];
  const scheduled: Array<() => Promise<void>> = [];
  const runtime = createOpenPetsPiRuntime({
    now: () => 1_000,
    random: () => 0,
    schedule: (work) => { scheduled.push(work); },
    clientFactory: () => ({
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, defaultPetId: "builtin", pets: [] }),
      installPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
      installLocalPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
      acquireLease: async () => { throw new Error("no leases in pi mvp"); },
      heartbeatLease: async () => ({ leaseId: "x", expiresAt: 0 }),
      releaseLease: async () => ({ released: true }),
      react: async (reaction) => { calls.push(`react:${reaction}`); },
      say: async (message, options) => { calls.push(`say:${message}:${options?.reaction ?? "none"}`); },
      showMedia: async () => ({ ok: true, shown: true }),
    }),
  });

  runtime.handleEvent({ type: "tool_execution_start", toolName: "bash", args: { command: "pnpm test /Users/alvin/private" }, prompt: "PRIVATE_PROMPT" });
  assert.equal(calls.length, 0, "automatic handler must schedule without blocking");
  assert.equal(scheduled.length, 1);
  await scheduled.shift()?.();
  assert.deepEqual(calls, ["react:testing"]);

  runtime.handleEvent({ type: "tool_execution_end", isError: true, result: "STACK /Users/alvin/private token=abc" });
  await scheduled.shift()?.();
  assert.equal(calls[1], "say:Something failed:error");
  assert.ok(!calls.join("\n").includes("/Users/alvin/private"));
  assert.ok(!calls.join("\n").includes("token=abc"));

  runtime.handleEvent({ type: "agent_end" });
  assert.equal(scheduled.length, 0, "recent errors suppress success overwrite");
}

{
  const events: string[] = [];
  let commandHandler: ((args: string, ctx?: unknown) => unknown) | undefined;
  const handlers = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
  const calls: string[] = [];
  const api: OpenPetsPiExtensionApi = {
    on: (eventName, handler) => { events.push(eventName); handlers.set(eventName, handler); },
    registerCommand: (_name, command) => { commandHandler = command.handler; },
  };
  const scheduled: Array<() => Promise<void>> = [];
  const runtime = createOpenPetsPiExtension(api, {
    schedule: (work) => { scheduled.push(work); },
    clientFactory: () => ({
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, defaultPetId: "builtin", pets: [] }),
      installPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
      installLocalPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
      acquireLease: async () => { throw new Error("no leases in pi mvp"); },
      heartbeatLease: async () => ({ leaseId: "x", expiresAt: 0 }),
      releaseLease: async () => ({ released: true }),
      react: async (reaction) => { calls.push(`react:${reaction}`); },
      say: async (message) => { calls.push(`say:${message}`); },
      showMedia: async () => ({ ok: true, shown: true }),
    }),
  });
  assert.equal(typeof runtime.handleEvent, "function");
  assert.ok(events.includes("session_start"));
  assert.ok(events.includes("tool_execution_start"));
  assert.equal(typeof commandHandler, "function");
  handlers.get("agent_start")?.({ reason: "payload lacks type", prompt: "PRIVATE_PROMPT" });
  await scheduled.shift()?.();
  assert.deepEqual(calls, ["react:thinking"]);
}

{
  const debugLogs: string[] = [];
  const runtime = createOpenPetsPiRuntime({
    debug: true,
    debugLog: (message) => debugLogs.push(message),
    clientFactory: () => ({
      hello: async () => ({}),
      status: async () => ({ ok: false, appRunning: false, unavailableReason: "/Users/alvin/private.sock" }),
      listPets: async () => ({ ok: true, defaultPetId: "builtin", pets: [] }),
      installPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
      installLocalPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
      acquireLease: async () => { throw new Error("no leases in pi mvp"); },
      heartbeatLease: async () => ({ leaseId: "x", expiresAt: 0 }),
      releaseLease: async () => ({ released: true }),
      react: async () => { throw Object.assign(new Error("/Users/alvin/private token=abc"), { code: "ENOENT /Users/alvin/private" }); },
      say: async () => { throw new Error("should not speak"); },
      showMedia: async () => ({ ok: true, shown: true }),
    }),
  });
  runtime.handleEvent({ type: "agent_start", prompt: "PRIVATE_PROMPT" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(debugLogs.some((entry) => entry.includes("ENOENT")));
  assert.ok(!debugLogs.join("\n").includes("/Users/alvin/private"));
  assert.ok(!debugLogs.join("\n").includes("token=abc"));
}

console.log("Pi integration package checks passed.");

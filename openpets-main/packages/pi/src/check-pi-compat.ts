import assert from "node:assert/strict";

import extension from "./extension.js";
import { createOpenPetsPiExtension, type OpenPetsPiExtensionApi } from "./runtime.js";

const handlers = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
let commandHandler: ((args: string, ctx?: unknown) => unknown) | undefined;
const notifications: string[] = [];
const calls: string[] = [];

const api: OpenPetsPiExtensionApi = {
  on(eventName, handler) {
    handlers.set(eventName, handler);
  },
  registerCommand(name, command) {
    assert.equal(name, "openpets");
    commandHandler = command.handler;
  },
};

const scheduled: Array<() => Promise<void>> = [];
const runtime = createOpenPetsPiExtension(api, {
  now: () => Date.now(),
  random: () => 0,
  schedule: (work) => { scheduled.push(work); },
  clientFactory: () => ({
    hello: async () => ({}),
    status: async () => ({ ok: true, appRunning: true }),
    listPets: async () => ({ ok: true, defaultPetId: "builtin", pets: [] }),
    installPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
    installLocalPet: async () => ({ ok: true, petId: "x", displayName: "X", installed: true }),
    acquireLease: async () => { throw new Error("leases disabled"); },
    heartbeatLease: async () => ({ leaseId: "x", expiresAt: 0 }),
    releaseLease: async () => ({ released: true }),
    react: async (reaction) => { calls.push(`react:${reaction}`); },
    say: async (message, options) => { calls.push(`say:${message}:${options?.reaction ?? "none"}`); },
    showMedia: async () => ({ ok: true, shown: true }),
  }),
});

assert.equal(typeof extension, "function");
assert.equal(typeof runtime.handleEvent, "function");
assert.equal(typeof commandHandler, "function");
for (const eventName of ["session_start", "session_shutdown", "agent_start", "agent_end", "turn_start", "tool_execution_start", "tool_execution_end"]) {
  assert.equal(typeof handlers.get(eventName), "function", `${eventName} must be subscribed`);
}

handlers.get("session_start")?.({ reason: "startup", prompt: "PRIVATE_PROMPT" });
handlers.get("tool_execution_start")?.({ toolName: "bash", args: { command: "pnpm test /Users/alvin/private token=abc" } });
handlers.get("tool_execution_end")?.({ isError: true, result: "STACK /Users/alvin/private token=abc" });
assert.equal(calls.length, 0, "Pi event callbacks must not block on OpenPets IPC");
while (scheduled.length) await scheduled.shift()?.();

assert.deepEqual(calls.slice(0, 3), ["react:waving", "react:testing", "say:Something failed:error"]);
assert.ok(!calls.join("\n").includes("/Users/alvin/private"));
assert.ok(!calls.join("\n").includes("token=abc"));

await commandHandler?.("status", { ui: { notify: (message: string) => notifications.push(message) } });
await commandHandler?.("test", { ui: { notify: (message: string) => notifications.push(message) } });
assert.ok(notifications.includes("OpenPets is connected."));
assert.ok(calls.includes("say:Pi connected:waving"));

console.log("Pi compatibility smoke checks passed.");

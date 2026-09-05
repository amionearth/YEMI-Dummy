/**
 * Unit tests for Phase 2 Screen Recording permission detection in
 * confinement-poller.ts.
 *
 * Tests:
 *   (a) 'granted' → no notification.
 *   (b-granted) 'not-determined' → NO notification (avoid double-prompt;
 *       get-windows already raised the native macOS SR dialog).
 *   (b-denied) 'denied'/'restricted' → notification fired exactly ONCE across
 *       multiple poll ticks (one-time module-level guard).
 *   (c) Notification action callback invokes promptScreenPermission.
 *   (d) findTerminal throw caught, does not propagate, still triggers
 *       notification when status is 'denied'.
 *   (e) Module-level guard persists across lease IDs (no re-fire).
 */
import assert from "node:assert/strict";

import {
  resolveAndSubscribe,
  _resetScreenPermissionNotificationGuard,
  type ConfinementPollerDeps,
} from "../src/confinement-poller.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ConfinementPollerDeps> = {}): ConfinementPollerDeps {
  return {
    findTerminal: async () => null,
    subscribe: (_id, _pid, _cb) => () => { /* noop */ },
    setIdentity: () => { /* noop */ },
    applyUpdate: () => { /* noop */ },
    isAlive: () => true,
    onDead: () => { /* noop */ },
    getScreenPermissionStatus: () => "granted",
    notifyScreenPermission: () => { /* noop */ },
    promptScreenPermission: () => { /* noop */ },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) No notification when SR permission is 'granted'
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const notifyCalls = { n: 0 };

  const deps = makeDeps({
    findTerminal: async () => null,
    getScreenPermissionStatus: () => "granted",
    notifyScreenPermission: () => { notifyCalls.n++; },
  });

  await resolveAndSubscribe("lease-sr-a", 1, deps, new Map());

  assert.equal(notifyCalls.n, 0, "(a) no notification when permission is 'granted'");
}

// ---------------------------------------------------------------------------
// (b-nodprompt) 'not-determined' → NO notification (native macOS prompt handles it)
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const notifyCalls = { n: 0 };

  const deps = makeDeps({
    findTerminal: async () => null,
    getScreenPermissionStatus: () => "not-determined",
    notifyScreenPermission: () => { notifyCalls.n++; },
  });

  await resolveAndSubscribe("lease-sr-b-nd1", 2, deps, new Map());
  await resolveAndSubscribe("lease-sr-b-nd2", 2, deps, new Map());

  assert.equal(notifyCalls.n, 0, "(b-nodprompt) no notification for 'not-determined' — avoid double-prompt");
}

// ---------------------------------------------------------------------------
// (b-denied) 'denied'/'restricted' → notification fired exactly ONCE
// ---------------------------------------------------------------------------
for (const status of ["denied", "restricted"] as const) {
  _resetScreenPermissionNotificationGuard();

  const notifyCalls = { n: 0 };

  const deps = makeDeps({
    findTerminal: async () => null,
    getScreenPermissionStatus: () => status,
    notifyScreenPermission: () => { notifyCalls.n++; },
  });

  // Three calls with fresh subscribed maps to exercise the module-level guard.
  await resolveAndSubscribe(`lease-sr-bd-${status}-1`, 2, deps, new Map());
  await resolveAndSubscribe(`lease-sr-bd-${status}-2`, 2, deps, new Map());
  await resolveAndSubscribe(`lease-sr-bd-${status}-3`, 2, deps, new Map());

  assert.equal(
    notifyCalls.n,
    1,
    `(b-denied) notification fired exactly once for '${status}', not ${notifyCalls.n} times`,
  );
}

// ---------------------------------------------------------------------------
// (c) Notification action callback invokes promptScreenPermission
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const promptCalls = { n: 0 };
  let capturedAction: (() => void) | undefined;

  const deps = makeDeps({
    findTerminal: async () => null,
    getScreenPermissionStatus: () => "denied",
    notifyScreenPermission: (onAction) => { capturedAction = onAction; },
    promptScreenPermission: () => { promptCalls.n++; },
  });

  await resolveAndSubscribe("lease-sr-c", 3, deps, new Map());

  assert.ok(capturedAction !== undefined, "(c) notifyScreenPermission was called with an action callback");
  capturedAction();
  assert.equal(promptCalls.n, 1, "(c) promptScreenPermission invoked when notification action fires");
}

// ---------------------------------------------------------------------------
// (d) findTerminal throw is caught, does not propagate, still triggers
//     notification when status is 'denied'
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const notifyCalls = { n: 0 };

  const deps = makeDeps({
    findTerminal: async () => { throw new Error("get-windows exited with code 1"); },
    getScreenPermissionStatus: () => "denied",
    notifyScreenPermission: () => { notifyCalls.n++; },
  });

  let threw = false;
  try {
    await resolveAndSubscribe("lease-sr-d", 4, deps, new Map());
  } catch {
    threw = true;
  }

  assert.equal(threw, false, "(d) findTerminal throw must not propagate from resolveAndSubscribe");
  assert.equal(notifyCalls.n, 1, "(d) notification fires after findTerminal throw when status is 'denied'");
}

// ---------------------------------------------------------------------------
// (e) Module-level guard persists across lease IDs — no re-fire
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const notifyCalls = { n: 0 };

  const deniedDeps = makeDeps({
    findTerminal: async () => null,
    getScreenPermissionStatus: () => "denied",
    notifyScreenPermission: () => { notifyCalls.n++; },
  });

  await resolveAndSubscribe("lease-sr-e1", 5, deniedDeps, new Map());
  assert.equal(notifyCalls.n, 1, "(e) notification fired once for denied");

  await resolveAndSubscribe("lease-sr-e2", 5, deniedDeps, new Map());
  assert.equal(notifyCalls.n, 1, "(e) second denied call does not re-fire (module guard)");
}

console.log("confinement-permission validation passed.");

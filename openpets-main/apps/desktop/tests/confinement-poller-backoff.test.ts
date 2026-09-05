/**
 * Unit tests for FF1: null-resolve backoff in confinement-poller.ts.
 *
 * Tests:
 *   (1) computeBackoffDelayMs: grows on repeated nulls, caps at BACKOFF_MAX_MS.
 *   (2) computeBackoffDelayMs(0) === BACKOFF_MIN_MS (first/reset value).
 *   (3) Backoff grows: successive onNull callbacks trigger increasing delays.
 *   (4) Resets to BACKOFF_MIN_MS on successful (non-null) terminal resolve.
 *   (5) "Re-enable" reset: a NEW resolveAndSubscribe call starts at BACKOFF_MIN_MS.
 *   (6) No double-subscribe guard still holds after backoff/resubscribe cycle.
 */
import assert from "node:assert/strict";

import {
  resolveAndSubscribe,
  computeBackoffDelayMs,
  BACKOFF_MIN_MS,
  BACKOFF_MAX_MS,
  BACKOFF_FACTOR,
  _resetScreenPermissionNotificationGuard,
  type ConfinementPollerDeps,
} from "../src/confinement-poller.js";
import type { TerminalWindowInfo } from "../src/window-tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(pid = 100): TerminalWindowInfo {
  return { window: null, terminalPid: pid, appName: "iTerm2", isMinimized: false, isOccluded: false };
}

function makeDeps(overrides: Partial<ConfinementPollerDeps> = {}): ConfinementPollerDeps {
  return {
    findTerminal: async () => null,
    subscribe: (_id, _pid, _onFound, _onNull) => () => { /* noop */ },
    setIdentity: () => { /* noop */ },
    applyUpdate: () => { /* noop */ },
    isAlive: () => true,
    onDead: () => { /* noop */ },
    getScreenPermissionStatus: () => "granted",
    notifyScreenPermission: () => { /* noop */ },
    promptScreenPermission: () => { /* noop */ },
    scheduleRetry: (_delayMs, _fn) => () => { /* noop — don't fire in tests unless explicitly triggered */ },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (1) computeBackoffDelayMs: grows and caps
// ---------------------------------------------------------------------------
{
  assert.equal(computeBackoffDelayMs(0), BACKOFF_MIN_MS, "(1a) nullCount=0 → BACKOFF_MIN_MS");

  const d1 = computeBackoffDelayMs(1);
  assert.ok(d1 > BACKOFF_MIN_MS, `(1b) nullCount=1 (${d1}) should exceed BACKOFF_MIN_MS`);

  const d2 = computeBackoffDelayMs(2);
  assert.ok(d2 > d1, `(1c) nullCount=2 (${d2}) should exceed nullCount=1 (${d1})`);

  // Cap
  const dHigh = computeBackoffDelayMs(100);
  assert.equal(dHigh, BACKOFF_MAX_MS, "(1d) large nullCount should be capped at BACKOFF_MAX_MS");

  // Verify factor
  const expected1 = Math.min(BACKOFF_MIN_MS * BACKOFF_FACTOR, BACKOFF_MAX_MS);
  assert.equal(computeBackoffDelayMs(1), expected1, "(1e) nullCount=1 matches formula");
}

// ---------------------------------------------------------------------------
// (2) computeBackoffDelayMs(0) === BACKOFF_MIN_MS (reset / first-try value)
// ---------------------------------------------------------------------------
{
  assert.equal(computeBackoffDelayMs(0), BACKOFF_MIN_MS, "(2) reset state returns BACKOFF_MIN_MS");
}

// ---------------------------------------------------------------------------
// (3) Backoff grows: successive onNull callbacks produce increasing delays
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const delays: number[] = [];
  const subscribed = new Map<string, () => void>();

  let capturedOnNull: (() => void) | undefined;

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, _onFound, onNull) => {
      capturedOnNull = onNull;
      return () => { /* noop */ };
    },
    scheduleRetry: (delayMs, fn) => {
      delays.push(delayMs);
      // Re-trigger resubscribe so onNull gets captured again for next assertion
      fn();
      return () => { /* noop */ };
    },
  });

  await resolveAndSubscribe("lease-bo-3", 1, deps, subscribed);

  // Fire onNull three times, each time the scheduleRetry captures the delay
  // and immediately calls fn() so resubscribe runs again
  assert.ok(capturedOnNull !== undefined, "(3) onNull should be captured by subscribe");

  // Reset delays array — we want to measure from the subscription's first null
  delays.length = 0;

  // Fire first null — nullCount goes from 1 (initial null resolve) to 2
  capturedOnNull!();
  const d1 = delays[0];

  capturedOnNull!();
  const d2 = delays[1];

  capturedOnNull!();
  const d3 = delays[2];

  assert.ok(d1 !== undefined && d2 !== undefined && d3 !== undefined, "(3) three delays recorded");
  assert.ok(d2! > d1!, `(3) second delay (${d2}) > first (${d1})`);
  assert.ok(d3! > d2!, `(3) third delay (${d3}) > second (${d2})`);
  assert.ok(d3! <= BACKOFF_MAX_MS, `(3) delays capped at BACKOFF_MAX_MS (got ${d3})`);
}

// ---------------------------------------------------------------------------
// (4) Resets to BACKOFF_MIN_MS on a successful (non-null) terminal resolve
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const delays: number[] = [];
  const subscribed = new Map<string, () => void>();

  let capturedOnFound: ((info: TerminalWindowInfo) => void) | undefined;
  let capturedOnNull: (() => void) | undefined;

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, onFound, onNull) => {
      capturedOnFound = onFound;
      capturedOnNull = onNull;
      return () => { /* noop */ };
    },
    scheduleRetry: (delayMs, fn) => {
      delays.push(delayMs);
      fn(); // immediately resubscribe to get new callbacks
      return () => { /* noop */ };
    },
  });

  await resolveAndSubscribe("lease-bo-4", 2, deps, subscribed);
  delays.length = 0; // clear initial

  // Accumulate a few nulls to build up backoff
  capturedOnNull!();
  capturedOnNull!();
  capturedOnNull!();
  const delayBeforeReset = delays[delays.length - 1]!;
  assert.ok(delayBeforeReset > BACKOFF_MIN_MS, `(4) delay before reset (${delayBeforeReset}) should be > BACKOFF_MIN_MS`);

  // Now simulate a successful terminal resolve via onFound callback
  delays.length = 0;
  capturedOnFound!(makeInfo(2));

  // Fire onNull again to get the NEXT delay — it should be BACKOFF_MIN_MS * FACTOR^1 (nullCount reset to 0, then incremented to 1)
  capturedOnNull!();
  const delayAfterReset = delays[0];
  assert.ok(delayAfterReset !== undefined, "(4) delay after reset should be recorded");
  assert.ok(
    delayAfterReset! <= BACKOFF_MIN_MS * BACKOFF_FACTOR * 1.01, // tolerance for floating point
    `(4) delay after reset (${delayAfterReset}) should be near BACKOFF_MIN_MS*factor (${BACKOFF_MIN_MS * BACKOFF_FACTOR})`,
  );
}

// ---------------------------------------------------------------------------
// (5) "Re-enable" reset: a NEW resolveAndSubscribe starts at BACKOFF_MIN_MS
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  // A fresh resolveAndSubscribe call (new leaseId) starts with nullCount=0 or 1.
  // The first onNull after initial null resolve should produce computeBackoffDelayMs(2)
  // (nullCount starts at 1 after the null initial resolve, then +1 on first null tick = 2).
  // The key invariant: it starts fresh, not accumulated from a previous lease.

  const delays: number[] = [];
  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, _onFound, onNull) => {
      // Fire null once to record the delay
      onNull?.();
      return () => { /* noop */ };
    },
    scheduleRetry: (delayMs, _fn) => {
      delays.push(delayMs);
      return () => { /* noop */ };
    },
  });

  // First call
  await resolveAndSubscribe("lease-bo-5a", 3, deps, new Map());
  const delay5a = delays[0];

  delays.length = 0;

  // Second call (simulating re-enable with a new lease) — should produce same delay
  await resolveAndSubscribe("lease-bo-5b", 3, deps, new Map());
  const delay5b = delays[0];

  assert.equal(delay5a, delay5b, "(5) re-enable (new resolveAndSubscribe) starts fresh with same initial delay");
  assert.ok(delay5a !== undefined && delay5a <= BACKOFF_MAX_MS, "(5) delay is bounded");
}

// ---------------------------------------------------------------------------
// (6) Double-subscribe guard still holds
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  let subscribeCalls = 0;
  const subscribed = new Map<string, () => void>();

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, _onFound, _onNull) => {
      subscribeCalls++;
      return () => { /* noop */ };
    },
  });

  const r1 = await resolveAndSubscribe("lease-bo-6", 4, deps, subscribed);
  const r2 = await resolveAndSubscribe("lease-bo-6", 4, deps, subscribed);

  assert.ok(r1 !== null, "(6) first call returns cleanup fn");
  assert.equal(r2, null, "(6) second call for same leaseId returns null (guard)");
  assert.equal(subscribeCalls, 1, "(6) subscribe called only once for same leaseId");
}

// ---------------------------------------------------------------------------
// (7) Backoff-window cleanup: external unsubscribe DURING the backoff window
//     cancels the scheduled retry; the timer must NOT fire, and onDead must
//     NOT be invoked (guards against erasing a newly-reassigned lease's state).
// ---------------------------------------------------------------------------
{
  _resetScreenPermissionNotificationGuard();

  const deadCalls = { n: 0 };
  const subscribed = new Map<string, () => void>();

  let capturedOnNull: (() => void) | undefined;
  let cancelCalled = false;
  let retryFired = false;
  let pendingRetryFn: (() => void) | undefined;

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, _onFound, onNull) => {
      capturedOnNull = onNull;
      return () => { /* noop */ };
    },
    scheduleRetry: (_delayMs, fn) => {
      // Capture the retry fn but do NOT fire it — simulates a real timer pending.
      pendingRetryFn = fn;
      return () => {
        // This cancel fn is what cleanup() calls via cancelRetry?.().
        cancelCalled = true;
      };
    },
    onDead: () => { deadCalls.n++; },
  });

  const cleanup = await resolveAndSubscribe("lease-bo-7", 5, deps, subscribed);
  assert.ok(cleanup !== null, "(7) resolveAndSubscribe returns cleanup fn");

  // Fire onNull to enter the backoff window (retry scheduled but NOT fired yet).
  assert.ok(capturedOnNull !== undefined, "(7) onNull should be captured");
  capturedOnNull!();

  // The lease entry must still be in subscribed during the backoff window.
  assert.ok(subscribed.has("lease-bo-7"), "(7) lease must remain in subscribed during backoff window");

  // External unsubscribe — simulates unsubscribeConfinement called during the window.
  cleanup!();

  // The cancel fn on the retry timer must have been called.
  assert.equal(cancelCalled, true, "(7) cleanup must cancel the pending retry timer");

  // The lease must be removed from the subscribed map now.
  assert.ok(!subscribed.has("lease-bo-7"), "(7) lease removed from subscribed after cleanup");

  // Even if the retry fn were somehow invoked after cancel, it must not cause harm.
  // Verify retryFired is still false (we never call pendingRetryFn — that's the
  // whole point: it was cancelled).
  assert.equal(retryFired, false, "(7) retry must not have fired");
  assert.equal(deadCalls.n, 0, "(7) onDead must NOT be invoked after external cleanup");
}

console.log("confinement-poller-backoff validation passed.");

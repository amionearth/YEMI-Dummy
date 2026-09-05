/**
 * Unit tests for the window-tracker poller re-entrancy latch (FIX WT-M1).
 *
 * createLatchedTick is exported from window-tracker.ts for this purpose.
 * It wraps an injectable async worker with a latch so that a second tick
 * fired while the first is still in flight is a no-op.
 */
import assert from "node:assert/strict";

import { createLatchedTick } from "../src/window-tracker-latch.js";

// ---------------------------------------------------------------------------
// T1: second tick skipped while first is in-flight
// ---------------------------------------------------------------------------
{
  let calls = 0;
  let resolve!: () => void;
  // slow worker: hangs until manually resolved
  const slowWorker = (): Promise<void> => new Promise<void>((res) => {
    calls++;
    resolve = res;
  });

  const tick = createLatchedTick(slowWorker);

  // First tick starts
  tick();
  assert.equal(calls, 1, "T1: first tick should invoke worker");

  // Second tick while first is in-flight → must be skipped
  tick();
  assert.equal(calls, 1, "T1: second tick must be skipped while first is in-flight");

  // Third tick also skipped
  tick();
  assert.equal(calls, 1, "T1: third tick must also be skipped");

  // Resolve the first tick
  resolve();
  // Yield to the microtask queue so the finally() handler runs
  await new Promise<void>((res) => setImmediate(res));

  // Now the latch is released — a new tick should go through
  tick();
  assert.equal(calls, 2, "T1: tick after first resolves must invoke worker again");

  // Clean up
  resolve?.();
  await new Promise<void>((res) => setImmediate(res));

  console.log("T1 (re-entrancy: second tick skipped while first in-flight): PASS");
}

// ---------------------------------------------------------------------------
// T2: latch resets after worker resolves — ticks resume normally
// ---------------------------------------------------------------------------
{
  let calls = 0;
  const fastWorker = (): Promise<void> => {
    calls++;
    return Promise.resolve();
  };

  const tick = createLatchedTick(fastWorker);

  // Fire once, let it resolve
  tick();
  await new Promise<void>((res) => setImmediate(res));

  assert.equal(calls, 1, "T2: first tick should complete");

  // Fire again — latch should have reset
  tick();
  await new Promise<void>((res) => setImmediate(res));

  assert.equal(calls, 2, "T2: second tick should execute after first resolved");

  // Fire a third
  tick();
  await new Promise<void>((res) => setImmediate(res));

  assert.equal(calls, 3, "T2: third tick should execute after second resolved");

  console.log("T2 (re-entrancy: latch resets after worker resolves): PASS");
}

// ---------------------------------------------------------------------------
// T3: latch resets even when worker rejects (finally semantics)
// ---------------------------------------------------------------------------
{
  let calls = 0;
  let rejectFn!: (e: Error) => void;
  const failingWorker = (): Promise<void> => new Promise<void>((_, rej) => {
    calls++;
    rejectFn = rej;
  });

  const tick = createLatchedTick(failingWorker);

  // Start first tick
  tick();
  assert.equal(calls, 1);

  // Second tick skipped while first is in-flight
  tick();
  assert.equal(calls, 1, "T3: second tick skipped while failing worker is in-flight");

  // Reject the first tick (simulates listWindows error / spawn failure)
  rejectFn(new Error("simulated poller error"));
  await new Promise<void>((res) => setImmediate(res));

  // Latch must have reset despite rejection
  tick();
  assert.equal(calls, 2, "T3: tick after worker rejection must re-enter (latch reset by finally)");

  rejectFn(new Error("cleanup"));
  await new Promise<void>((res) => setImmediate(res));

  console.log("T3 (re-entrancy: latch resets after worker rejects): PASS");
}

console.log("\nAll window-tracker-reentry tests passed.");

/**
 * window-tracker-latch.ts — pure re-entrancy latch helper (no Electron/I/O).
 *
 * Extracted from window-tracker.ts so it can be unit-tested without an
 * Electron process context. Re-exported from window-tracker.ts for consumers.
 */

/**
 * Creates a latch-guarded async tick function from an injectable async worker.
 *
 * If the previous invocation of `worker` has not yet resolved, the new tick
 * is a no-op — preventing poller re-entrancy when `worker` takes longer than
 * the poll interval (e.g. slow listWindows / PowerShell calls on Windows).
 *
 * The latch is released in a `finally` block so it resets on both resolve and
 * reject, keeping the poller alive across transient errors.
 *
 * @internal Also exported from window-tracker.ts for consumers.
 */
export function createLatchedTick(worker: () => Promise<void>): () => void {
  let inFlight = false;
  return (): void => {
    if (inFlight) return;
    inFlight = true;
    // .catch(() => {}) suppresses unhandled rejection — ticks are fire-and-forget;
    // pollAll already has its own internal error handling.
    worker().finally(() => { inFlight = false; }).catch(() => {});
  };
}

/**
 * confinement-poller.ts
 *
 * Pure "resolve then always-subscribe" logic for confinement window tracking.
 * Extracted from local-ipc.ts so it can be unit-tested without Electron deps.
 *
 * Phase 2: Screen Recording permission detection.
 *   - When findTerminal returns null, query getScreenPermissionStatus().
 *   - If not 'granted' or 'not-determined', fire a ONE-TIME actionable
 *     notification (module-level guard prevents repeat across poll ticks).
 *
 * FF1 — Null-resolve backoff:
 *   - On consecutive null resolves (terminal not found), the re-subscribe
 *     interval grows exponentially (500 ms → up to 5 000 ms) via
 *     computeBackoffDelayMs.  A successful resolve resets it to BACKOFF_MIN_MS.
 *   - The self-heal subscription is ALWAYS kept: after each backoff period the
 *     poller re-subscribes so a reappearing terminal is detected.
 */

import type { TerminalWindowInfo } from "./window-tracker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfinementPollerDeps {
  findTerminal: (clientPid: number) => Promise<TerminalWindowInfo | null>;
  /**
   * Subscribe to ~500 ms window-tracking updates.
   * `onFound` fires when the terminal IS visible.
   * `onNull`  (optional) fires when the terminal is NOT found on a tick —
   *           used to drive backoff without blocking the fast-path.
   */
  subscribe: (
    id: string,
    clientPid: number,
    onFound: (info: TerminalWindowInfo) => void,
    onNull?: () => void,
  ) => () => void;
  setIdentity: (info: TerminalWindowInfo) => void;
  applyUpdate: (info: TerminalWindowInfo) => void;
  isAlive: () => boolean;
  onDead: () => void;
  /** Phase 2: reads SR permission without prompting (READ-ONLY). */
  getScreenPermissionStatus: () => string;
  /**
   * Phase 2: fires the one-time "SR permission needed" notification.
   * Receives a callback to invoke when the user clicks the notification action.
   */
  notifyScreenPermission: (onAction: () => void) => void;
  /** Phase 2: opens the macOS Screen Recording System Settings pane. */
  promptScreenPermission: () => void;
  /**
   * FF1: schedule a one-shot callback after `delayMs` milliseconds.
   * Returns a cancellation function.
   * Defaults to `setTimeout` when not provided — inject in tests for
   * deterministic timing control.
   */
  scheduleRetry?: (delayMs: number, fn: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// Module-level one-time guard
// ---------------------------------------------------------------------------

let screenPermissionNotificationShown = false;

/** Reset the one-time notification guard. For testing only. */
export function _resetScreenPermissionNotificationGuard(): void {
  screenPermissionNotificationShown = false;
}

// ---------------------------------------------------------------------------
// FF1 — Backoff schedule (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 5_000;
export const BACKOFF_FACTOR = 1.5;

/**
 * Returns the retry delay for `nullCount` consecutive null resolves.
 * Grows geometrically from `minMs` by `factor` per miss, capped at `maxMs`.
 *
 * computeBackoffDelayMs(0) === BACKOFF_MIN_MS   (reset / immediate-retry value)
 */
export function computeBackoffDelayMs(
  nullCount: number,
  minMs = BACKOFF_MIN_MS,
  maxMs = BACKOFF_MAX_MS,
  factor = BACKOFF_FACTOR,
): number {
  return Math.min(minMs * Math.pow(factor, nullCount), maxMs);
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve the terminal identity for a client PID, then ALWAYS
 * subscribe to the 500 ms poller — even when the first resolve returns null —
 * so a transient first-miss self-heals on a later tick.
 *
 * FF1: consecutive null ticks back off the resubscribe interval up to
 * BACKOFF_MAX_MS.  A successful tick resets it to BACKOFF_MIN_MS.
 *
 * Returns a cleanup/unsubscribe function, or null if already subscribed
 * (double-subscribe guard).
 */
export async function resolveAndSubscribe(
  leaseId: string,
  clientPid: number,
  deps: ConfinementPollerDeps,
  subscribed: Map<string, () => void>,
): Promise<(() => void) | null> {
  // Double-subscribe guard: never subscribe twice for the same lease.
  if (subscribed.has(leaseId)) return null;

  // Resolve production scheduleRetry default.
  const scheduleRetry = deps.scheduleRetry ?? ((delayMs, fn) => {
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
  });

  // Initial find — seed state before starting the subscription loop.
  let termInfo: TerminalWindowInfo | null;
  try {
    termInfo = await deps.findTerminal(clientPid);
  } catch {
    termInfo = null;
  }

  if (termInfo) {
    deps.setIdentity(termInfo);
    deps.applyUpdate(termInfo);
  } else {
    handleNullResolve(deps);
  }

  // Mutable backoff state — lives in the closure for this lease.
  // nullCount starts at 1 when the initial resolve was null (already one miss).
  let nullCount = termInfo ? 0 : 1;
  let cancelRetry: (() => void) | null = null;
  let currentUnsub: (() => void) | null = null;

  function cleanup(): void {
    cancelRetry?.();
    cancelRetry = null;
    currentUnsub?.();
    currentUnsub = null;
    subscribed.delete(leaseId);
  }

  function resubscribe(): void {
    // Subscribe to the 500ms poller for ongoing tracking.
    // Do NOT check isAlive here — the callbacks below handle it so tests that
    // flip isAlive after subscribing can still exercise the dead-lease path.
    currentUnsub = deps.subscribe(
      leaseId,
      clientPid,
      (updated) => {
        // Terminal FOUND: reset backoff, apply update.
        nullCount = 0;
        cancelRetry?.(); cancelRetry = null;

        if (!deps.isAlive()) {
          cleanup();
          deps.onDead();
          return;
        }
        deps.setIdentity(updated);
        deps.applyUpdate(updated);
      },
      () => {
        // Terminal NOT FOUND this tick: back off, unsubscribe, retry later.
        // NOTE: do NOT call subscribed.delete(leaseId) here. The map entry must
        // remain live during the backoff window so an external unsubscribeConfinement
        // can still reach cleanup() and cancel the pending timer. cleanup() owns
        // the sole subscribed.delete(leaseId) call.
        nullCount++;
        handleNullResolve(deps);

        // Tear down only the current 500ms subscription; do NOT remove the
        // outer cleanup from subscribed — it stays reachable for external cancel.
        currentUnsub?.(); currentUnsub = null;

        if (!deps.isAlive()) {
          deps.onDead();
          return;
        }

        const delay = computeBackoffDelayMs(nullCount);
        cancelRetry = scheduleRetry(delay, () => {
          cancelRetry = null;
          if (!deps.isAlive()) {
            deps.onDead();
            return;
          }
          resubscribe();
        });
      },
    );

    subscribed.set(leaseId, cleanup);
  }

  resubscribe();

  return cleanup;
}

/**
 * Checks SR permission on a null resolve and fires the one-time notification
 * for authoritative denials ('denied'/'restricted').
 * 'not-determined' is skipped — the native macOS SR prompt already handles it.
 */
function handleNullResolve(deps: ConfinementPollerDeps): void {
  const permStatus = deps.getScreenPermissionStatus();
  if (
    permStatus !== "granted" &&
    permStatus !== "not-determined" &&
    !screenPermissionNotificationShown
  ) {
    screenPermissionNotificationShown = true;
    deps.notifyScreenPermission(() => deps.promptScreenPermission());
  }
}

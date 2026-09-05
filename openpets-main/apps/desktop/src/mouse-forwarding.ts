/**
 * Pure, dependency-free mouse-forwarding decision logic.
 *
 * This logic is extracted out of `pet-window.ts` (which imports Electron and so
 * cannot be loaded by the plain-Node `node:test` runner) so the exact production
 * predicates can be unit-tested directly instead of through a hand-rolled copy.
 * `pet-window.ts` reads the live platform and delegates here, guaranteeing the
 * tests and production never drift.
 */

/**
 * Whether a click-through pet window can still receive *forwarded* mouse events
 * (`setIgnoreMouseEvents(true, { forward: true })`).
 *
 * On Linux, Electron does not forward mouse events to ignored windows at all, so
 * pet windows there are kept interactive instead (see `setPassthrough`).
 */
export function canForwardMouseEvents(platform: NodeJS.Platform | string): boolean {
  return platform === "darwin" || platform === "win32";
}

/**
 * Whether the cursor-probe watchdog should run for a click-through pet window.
 *
 * Forwarded mouse events are the *only* way a click-through pet learns that the
 * cursor is over it, and the compositor can silently stop delivering them:
 *   - Windows: Chromium's forwarded mouse tracking goes stale after rapid pet
 *     HTML reloads and fullscreen sweeps.
 *   - macOS: the WindowServer stops delivering forwarded moves after Space
 *     switches, display sleep, and fullscreen transitions.
 *
 * When that happens the renderer's hit-test never fires, passthrough is never
 * lifted, and the pet becomes permanently unclickable and undraggable until the
 * app restarts. The watchdog re-arms forwarding from the main process using
 * `screen.getCursorScreenPoint()`, which keeps working even when event
 * forwarding is dead.
 *
 * The watchdog therefore has to cover *every* platform that depends on forwarded
 * events — it is exactly `canForwardMouseEvents`. Guarding it on Windows alone
 * leaves macOS pets stuck.
 */
export function shouldWatchForwardedMouseEvents(platform: NodeJS.Platform | string): boolean {
  return canForwardMouseEvents(platform);
}

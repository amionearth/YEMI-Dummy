/**
 * Confinement Manager
 *
 * Tracks which agent pets should be confined to their terminal window and
 * provides the clamping logic used by the motion systems.
 *
 * Decision D2: Only explicit-lease (session-bound) agent pets are confined.
 * Default pet always uses full work-area free-roam.
 *
 * Decision D1: The pet roams the full interior of the terminal window.
 * When the terminal is minimized or occluded the pet uses full work-area
 * free-roam (same as the default pet).
 */

import type { WindowBounds } from "./window-tracker.js";
import type { Point, WindowSize } from "./display.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfinementState {
  /** Terminal window bounds in screen coordinates, or null for free-roam. */
  readonly terminalBounds: WindowBounds | null;
  /** True when free-roaming because terminal is minimized/off-screen. */
  readonly terminalMinimized: boolean;
  /** True when free-roaming because terminal is occluded by other windows. */
  readonly terminalOccluded: boolean;
  /** PID of the terminal (for focus action). */
  readonly terminalOwnerPid: number;
  /** Human-readable app name. */
  readonly appName: string;
}

// ---------------------------------------------------------------------------
// Singleton state: petId → latest ConfinementState
// ---------------------------------------------------------------------------

const confinementStates = new Map<string, ConfinementState>();

// ---------------------------------------------------------------------------
// Global confinement enable/disable toggle
// ---------------------------------------------------------------------------

/** Module-level flag: when false, getEffectiveConfinementBounds always returns
 *  null so all pets free-roam. Injected via setConfinementEnabled(); never read
 *  from app-state directly (avoids an import cycle). Default true = confined. */
let confinementEnabled = true;

/**
 * Set the global confinement toggle. Call this on startup (from the initial
 * app-state load) and whenever the petConfinementEnabled preference changes.
 * The single chokepoint is getEffectiveConfinementBounds which checks this flag.
 */
export function setConfinementEnabled(enabled: boolean): void {
  confinementEnabled = enabled;
}

/**
 * Returns whether confinement is currently enabled.
 */
export function isConfinementEnabled(): boolean {
  return confinementEnabled;
}

/**
 * Update (or create) the confinement state for a pet.
 * Called by the window-tracker polling callback.
 */
export function setConfinementState(petId: string, state: ConfinementState): void {
  confinementStates.set(petId, state);
}

/**
 * Remove confinement state when a pet's lease is released.
 */
export function clearConfinementState(petId: string): void {
  confinementStates.delete(petId);
}

/**
 * Retrieve the current confinement state for a pet, or null if not tracked.
 */
export function getConfinementState(petId: string): ConfinementState | null {
  return confinementStates.get(petId) ?? null;
}

/**
 * Returns true if any pet is currently in confined mode (terminal visible &
 * unoccluded). Used to gate the window-tracker polling.
 */
export function hasActiveConfinement(): boolean {
  for (const state of confinementStates.values()) {
    if (state.terminalBounds !== null) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Clamp helper
// ---------------------------------------------------------------------------

function clampInRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a pet window position to the given terminal bounds.
 *
 * The pet may wander anywhere inside the terminal window. The bottom edge
 * acts as a resting ledge (pet bottom aligns with terminal bottom).
 */
export function clampToTerminalBounds(position: Point, petSize: WindowSize, bounds: WindowBounds): Point {
  const minX = bounds.x;
  const maxX = bounds.x + Math.max(0, bounds.width - petSize.width);
  const minY = bounds.y;
  const maxY = bounds.y + Math.max(0, bounds.height - petSize.height);

  return {
    x: clampInRange(Math.round(position.x), minX, maxX),
    y: clampInRange(Math.round(position.y), minY, maxY),
  };
}

/**
 * Return the effective confinement bounds for a pet at the current moment:
 * - terminal bounds when terminal is visible and not occluded
 * - null (free-roam) otherwise
 */
export function getEffectiveConfinementBounds(petId: string): WindowBounds | null {
  // Global disable: free-roam for all pets regardless of tracked terminal state.
  if (!confinementEnabled) return null;
  const state = confinementStates.get(petId);
  if (!state) return null; // not a confined pet
  if (state.terminalMinimized || state.terminalOccluded) return null; // free-roam
  return state.terminalBounds; // may still be null if unresolved
}

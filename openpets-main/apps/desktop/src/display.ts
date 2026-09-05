import { createRequire } from "node:module";
import type { Rectangle } from "electron";

import { deriveDisplayKey } from "./app-state-core.js";

// `electron` is loaded lazily (via createRequire, inside getScreen()) rather
// than imported at module scope: this module is pulled into the plugin runtime
// graph and the unit-test suite, which run under plain Node where the
// `electron` shim has no named `screen` export. createRequire restores a
// working `require` in this ESM module so the lazy load succeeds at runtime.
const require = createRequire(import.meta.url);

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Derive a stable string key for a display from its bounds.
 * Display IDs can change across reboots on some platforms, so we key on
 * physical geometry instead: `"${x},${y},${width}x${height}"`.
 */
export function getDisplayKey(bounds: Rectangle): string {
  return deriveDisplayKey(bounds);
}

/**
 * Return the display key for the display that the centre of a window position
 * falls on (using Electron's nearest-point logic).
 */
export function getDisplayKeyForPosition(position: Point, size: WindowSize = defaultPetWindowSize): string {
  const centre = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
  const display = getScreen().getDisplayNearestPoint(centre);
  return getDisplayKey(display.bounds);
}

/**
 * Return display keys for all currently connected displays, mapped to their
 * work-area rectangles so callers can choose a position on a given display.
 */
export function getAllDisplayKeys(): string[] {
  return getScreen().getAllDisplays().map((display) => getDisplayKey(display.bounds));
}

export const defaultPetWindowSize: WindowSize = {
  width: 340,
  height: 420,
};

export const defaultPetWindowMargin = 24;

/**
 * Minimum overlap (in pixels) along each axis for a pet to be considered
 * "on" a display.  Rejects hair-thin slivers without requiring full coverage.
 * Based on ~33% of the smallest pet dimension (420*0.33 ≈ 138).  The value
 * is intentionally modest so that deliberate cross-seam transit is allowed
 * as soon as a meaningful portion of the pet has crossed.
 */
const MIN_VISIBLE_PX = 100;

// ---------------------------------------------------------------------------
// Testability seam — allows unit tests to inject a mock screen implementation
// without requiring a running Electron process.
// Same pattern as setConfinementEnabled() in confinement-manager.ts.
// ---------------------------------------------------------------------------

/**
 * Minimal screen interface.  Typed explicitly so that unit tests can provide
 * plain objects without depending on the full Electron types package.
 */
export interface ScreenImpl {
  getAllDisplays(): DisplayInfo[];
  getPrimaryDisplay(): DisplayInfo;
  getDisplayNearestPoint(point: { x: number; y: number }): DisplayInfo;
}

export interface DisplayInfo {
  bounds: Rectangle;
  workArea: Rectangle;
}

// Lazily loaded — avoids a hard electron import at module-load time so that
// unit tests can call _setScreenForTesting() without requiring Electron.
let _screen: ScreenImpl | null = null;

function getScreen(): ScreenImpl {
  if (!_screen) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { screen } = require("electron") as { screen: ScreenImpl };
    _screen = screen;
  }
  return _screen;
}

/**
 * Replace the screen implementation used by this module.
 * ONLY call this from unit tests.  Pass `null` to restore the real electron screen.
 */
export function _setScreenForTesting(impl: ScreenImpl | null): void {
  _screen = impl;
  _cachedDisplays = null; // bust the cache when the impl changes
}

/**
 * Cached list of displays.  Invalidated by `invalidateDisplayCache()` which
 * should be called whenever a display topology event fires (added / removed /
 * metrics-changed).  Caching avoids N×getAllDisplays() calls inside the 50 ms
 * motion tick when multiple pets are active.
 */
let _cachedDisplays: DisplayInfo[] | null = null;

/** Called by display-topology event handlers to bust the cache. */
export function invalidateDisplayCache(): void {
  _cachedDisplays = null;
}

function getAllDisplaysCached(): DisplayInfo[] {
  if (!_cachedDisplays) {
    _cachedDisplays = getScreen().getAllDisplays();
  }
  return _cachedDisplays;
}

export function getDefaultPetInitialPosition(size: WindowSize = defaultPetWindowSize): Point {
  const { workArea } = getScreen().getPrimaryDisplay();

  return {
    x: Math.round(workArea.x + workArea.width - size.width - defaultPetWindowMargin),
    y: Math.round(workArea.y + workArea.height - size.height - defaultPetWindowMargin),
  };
}

/**
 * Returns true when the pet rect overlaps at least one display work area by
 * at least `minOverlap` pixels on BOTH axes.
 *
 * This is the "is the pet still visible somewhere?" test used by the permissive-
 * containment policy.  Using bottom-center as the primary anchor is accurate
 * because the visible sprite/hit-box sits at the bottom of the transparent
 * 340×420 window (petBottom ≈ 22 px from the window bottom edge).
 *
 * @param position   Top-left corner of the pet window (global virtual-desktop coords).
 * @param width      Pet window width.
 * @param height     Pet window height.
 * @param minOverlap Minimum pixel overlap on each axis (default: MIN_VISIBLE_PX).
 */
export function isOnAnyDisplay(
  position: Point,
  width: number,
  height: number,
  minOverlap: number = MIN_VISIBLE_PX,
): boolean {
  // Bottom-center anchor: the visible sprite lives at the bottom of the window.
  const anchorX = position.x + width / 2;
  const anchorY = position.y + height;

  for (const display of getAllDisplaysCached()) {
    const wa = display.workArea;
    // Does the anchor point lie inside this display's work area?
    if (
      anchorX >= wa.x &&
      anchorX <= wa.x + wa.width &&
      anchorY >= wa.y &&
      anchorY <= wa.y + wa.height
    ) {
      return true;
    }
    // Fallback: is there sufficient rect overlap on both axes?
    const overlapX = Math.min(position.x + width, wa.x + wa.width) - Math.max(position.x, wa.x);
    const overlapY = Math.min(position.y + height, wa.y + wa.height) - Math.max(position.y, wa.y);
    if (overlapX >= minOverlap && overlapY >= minOverlap) {
      return true;
    }
  }
  return false;
}

/**
 * Permissive containment clamp.
 *
 * If the pet is still visible on at least one display (anchor or overlap test),
 * the position is returned verbatim (rounded to integers).  This allows free
 * transit across shared display seams.
 *
 * If the pet has moved fully off all displays, it snaps to the work area of the
 * display nearest to its bottom-center anchor — the same logic as today but
 * triggered only when the pet is genuinely off-screen.
 *
 * Wide physical gaps between displays (where no display work area exists) act
 * as walls: the pet sticks at the last edge it reached and cannot teleport
 * across.  This is the accepted limitation; it is documented in docs/pets.md.
 */
export function clampToNearestDisplayIfOffscreen(
  position: Point,
  size: WindowSize = defaultPetWindowSize,
): Point {
  if (isOnAnyDisplay(position, size.width, size.height)) {
    // Pet is visible — leave it alone.
    return { x: Math.round(position.x), y: Math.round(position.y) };
  }

  // Pet is fully off-screen.  Snap to nearest display using bottom-center anchor.
  const anchor = {
    x: Math.round(position.x + size.width / 2),
    y: Math.round(position.y + size.height),
  };
  const { workArea } = getScreen().getDisplayNearestPoint(anchor);
  return clampIntoWorkArea(position, size, workArea);
}

/**
 * Clamps a position into a given work area rectangle.
 * Shared primitive used by both clampToVisibleWorkArea and
 * clampToNearestDisplayIfOffscreen.
 */
function clampIntoWorkArea(
  position: Point,
  size: WindowSize,
  workArea: { x: number; y: number; width: number; height: number },
): Point {
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);

  return {
    x: clamp(Math.round(position.x), minX, maxX),
    y: clamp(Math.round(position.y), minY, maxY),
  };
}

export function clampToVisibleWorkArea(position: Point, size: WindowSize = defaultPetWindowSize): Point {
  // Clamp to the display the pet currently lives on (the one nearest its centre).
  // Note: this function is the LEGACY single-display clamp, kept for when
  // cross-display roaming is disabled via the petCrossDisplayEnabled flag.
  // When cross-display roaming is ON, call clampToNearestDisplayIfOffscreen instead.
  const centre = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
  const { workArea } = getScreen().getDisplayNearestPoint(centre);
  return clampIntoWorkArea(position, size, workArea);
}

// ---------------------------------------------------------------------------
// Cross-display roaming flag — mirrors petConfinementEnabled/setConfinementEnabled
// pattern in confinement-manager.ts.  Default false (dormant/off by default;
// enabled explicitly via the petCrossDisplayEnabled preference).
// ---------------------------------------------------------------------------

let _crossDisplayRoamingEnabled = false;

/**
 * Called by windows.ts when the petCrossDisplayEnabled preference changes.
 * Same injected-setter pattern as confinement-manager.ts to avoid import cycles.
 */
export function setCrossDisplayRoamingEnabled(enabled: boolean): void {
  _crossDisplayRoamingEnabled = enabled;
}

/** Returns whether cross-display roaming is currently enabled. */
export function isCrossDisplayRoamingEnabled(): boolean {
  return _crossDisplayRoamingEnabled;
}


function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

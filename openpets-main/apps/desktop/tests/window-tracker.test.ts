/**
 * Unit tests for isWindowOccluded in window-tracker.ts.
 *
 * isWindowOccluded is pure (no I/O, no Electron) so it can be tested directly.
 *
 * Cases:
 *   (1) Target not in allWindows (gone) → occluded.
 *   (2) No foreground windows → not occluded.
 *   (3) Single window ~60% coverage → NOT occluded.
 *   (4) Single window ≥90% coverage → occluded.
 *   (5) THE BUG CASE: two separate non-overlapping windows each ~60% → NOT
 *       occluded (additive accumulation is gone; only single-window ≥90% rule).
 *   (6) Own-process window fully covering target → excluded → NOT occluded.
 *   (7) Window behind (higher CGWindowList index) the target → not a foreground
 *       occluder → not occluded.
 */
import assert from "node:assert/strict";

import { isWindowOccluded, type OcclusionWindow } from "../src/window-occlusion.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;

function makeWindow(
  pid: number,
  x: number,
  y: number,
  w: number,
  h: number,
): OcclusionWindow {
  return {
    id: nextId++,
    ownerPid: pid,
    bounds: { x, y, width: w, height: h },
  };
}

const OWN_PID = 999;
const OTHER_PID = 1;

// target: 100×100 at (0,0), area=10000
const target = makeWindow(OTHER_PID, 0, 0, 100, 100);

// ---------------------------------------------------------------------------
// (1) Target not in allWindows → occluded (window gone)
// ---------------------------------------------------------------------------
{
  const result = isWindowOccluded(target, [], OWN_PID);
  assert.equal(result, true, "(1) window not in list → occluded");
}

// ---------------------------------------------------------------------------
// (2) No foreground windows (target is front-most) → not occluded
// ---------------------------------------------------------------------------
{
  const result = isWindowOccluded(target, [target], OWN_PID);
  assert.equal(result, false, "(2) no foreground windows → not occluded");
}

// ---------------------------------------------------------------------------
// (3) Single window ~60% coverage (60×100=6000/10000) → NOT occluded
// ---------------------------------------------------------------------------
{
  const partial = makeWindow(OTHER_PID, 0, 0, 60, 100); // 6000 / 10000 = 60%
  // partial is in front of target
  const windows = [partial, target];
  const result = isWindowOccluded(target, windows, OWN_PID);
  assert.equal(result, false, "(3) single window 60% → not occluded");
}

// ---------------------------------------------------------------------------
// (4) Single window ≥90% coverage (90×100=9000/10000) → occluded
// ---------------------------------------------------------------------------
{
  const big = makeWindow(OTHER_PID, 0, 0, 90, 100); // 9000 / 10000 = 90%
  const windows = [big, target];
  const result = isWindowOccluded(target, windows, OWN_PID);
  assert.equal(result, true, "(4) single window 90% → occluded");
}

// ---------------------------------------------------------------------------
// (5) THE BUG CASE: two non-overlapping windows each ~60% → NOT occluded
//     Old code: 6000 + 6000 = 12000 >= 9000 → falsely reported occluded.
//     New code: no single window ≥90% → not occluded.
// ---------------------------------------------------------------------------
{
  // Left half: 60×100 at (0,0) = 60% of target
  const left = makeWindow(OTHER_PID, 0, 0, 60, 100);
  // Right portion: 60×100 at (40,0) — overlaps last 20px with left, but
  // individually only covers 60% of target. Together additive = 120%, but
  // no single window >= 90%.
  const right = makeWindow(OTHER_PID, 40, 0, 60, 100);
  // Both are in front of target
  const windows = [left, right, target];
  const result = isWindowOccluded(target, windows, OWN_PID);
  assert.equal(result, false, "(5) two ~60% windows → NOT occluded (no additive accumulation)");
}

// ---------------------------------------------------------------------------
// (6) Own-process window fully covering target → excluded → NOT occluded
// ---------------------------------------------------------------------------
{
  // A window with OWN_PID that would cover 100% if counted
  const ownPetWindow = makeWindow(OWN_PID, 0, 0, 100, 100); // 100% coverage
  const windows = [ownPetWindow, target];
  const result = isWindowOccluded(target, windows, OWN_PID);
  assert.equal(result, false, "(6) own-process window excluded → not occluded");
}

// ---------------------------------------------------------------------------
// (7) Window BEHIND target (higher list index) → not a foreground occluder
// ---------------------------------------------------------------------------
{
  const behind = makeWindow(OTHER_PID, 0, 0, 100, 100); // 100% if counted
  // target is in front of behind (lower index)
  const windows = [target, behind];
  const result = isWindowOccluded(target, windows, OWN_PID);
  assert.equal(result, false, "(7) window behind target → not an occluder");
}

// ---------------------------------------------------------------------------
// (8) Exactly 90% coverage by a single window → occluded (boundary)
// ---------------------------------------------------------------------------
{
  const exact90 = makeWindow(OTHER_PID, 0, 0, 100, 90); // 9000 / 10000 = 90%
  const windows = [exact90, target];
  const result = isWindowOccluded(target, windows, OWN_PID);
  assert.equal(result, true, "(8) exactly 90% by one window → occluded (inclusive boundary)");
}

console.log("window-tracker occlusion validation passed.");

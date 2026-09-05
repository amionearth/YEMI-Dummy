/**
 * Unit tests for cross-display helpers in display.ts.
 *
 * Tests `isOnAnyDisplay` and `clampToNearestDisplayIfOffscreen` —
 * the permissive-containment policy that allows pets to roam across
 * display seams — plus a legacy regression check for `clampToVisibleWorkArea`.
 *
 * No Electron process is required.  A `ScreenImpl` mock is injected via
 * `_setScreenForTesting()` before each logical group of assertions.
 */

import assert from "node:assert/strict";

import {
  _setScreenForTesting,
  clampToNearestDisplayIfOffscreen,
  clampToVisibleWorkArea,
  invalidateDisplayCache,
  isOnAnyDisplay,
} from "../src/display.js";

// ---------------------------------------------------------------------------
// Helper — build a ScreenImpl from plain work-area rectangles.
//
// `getDisplayNearestPoint` does a genuine nearest-centroid search so the mock
// behaves exactly like the real Electron implementation.
// ---------------------------------------------------------------------------

interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function makeScreen(workAreas: WorkArea[]) {
  const displays = workAreas.map((wa) => ({ bounds: wa, workArea: wa }));

  function getDisplayNearestPoint(pt: { x: number; y: number }) {
    let best = displays[0];
    let bestDist = Infinity;
    for (const d of displays) {
      const cx = d.workArea.x + d.workArea.width / 2;
      const cy = d.workArea.y + d.workArea.height / 2;
      const dist = Math.hypot(pt.x - cx, pt.y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getDisplayNearestPoint,
  };
}

// Two side-by-side 1920×1080 displays (left at x=0, right at x=1920).
const DUAL = makeScreen([
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: 0, width: 1920, height: 1080 },
]);

// Two displays with a 200-px gap (right starts at x=2120).
const DUAL_GAP = makeScreen([
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 2120, y: 0, width: 1920, height: 1080 },
]);

// Display above primary at negative y.
const NEGATIVE_Y = makeScreen([
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 0, y: -1080, width: 1920, height: 1080 },
]);

// Pet window dimensions used throughout.
const PW = 340;
const PH = 420;

// ---------------------------------------------------------------------------
// isOnAnyDisplay
// ---------------------------------------------------------------------------

// Fully on display 1.
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  assert.equal(isOnAnyDisplay({ x: 100, y: 100 }, PW, PH), true, "fully on display 1");
}

// Centred on display 1.
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  assert.equal(isOnAnyDisplay({ x: 790, y: 330 }, PW, PH), true, "centred on display 1");
}

// Fully off to the right (beyond display 2).
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  assert.equal(isOnAnyDisplay({ x: 4000, y: 100 }, PW, PH), false, "off right of display 2");
}

// Fully off above primary (single display).
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  assert.equal(isOnAnyDisplay({ x: 100, y: -1000 }, PW, PH), false, "off above single display");
}

// Straddles seam between display 1 and display 2 (bottom-center anchor on display 2).
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  // Pet placed so left half is on display 1, right half on display 2.
  // Bottom-center = { x: 1920 + (PW/2)/2, y: 600 } — in workArea of display 2? No.
  // Place it so the bottom-center anchor is clearly in display 2 workArea.
  // x = 1750 -> pet spans [1750, 2090], bottom-center x = 1920 (exact seam).
  // Use x = 1760 so anchor = 1760 + 170 = 1930 → inside display 2 workArea.
  assert.equal(isOnAnyDisplay({ x: 1760, y: 600 }, PW, PH), true, "straddles seam — anchor on display 2");
}

// Fully on display 2.
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  assert.equal(isOnAnyDisplay({ x: 2100, y: 100 }, PW, PH), true, "fully on display 2");
}

// Small rect (10×10) in the 200-px gap — neither overlap nor anchor on either display.
{
  _setScreenForTesting(DUAL_GAP);
  invalidateDisplayCache();
  // Gap is x ∈ [1920, 2120).  A 10×10 rect at x=1950 has no display coverage.
  assert.equal(isOnAnyDisplay({ x: 1950, y: 500 }, 10, 10, 5), false, "10×10 rect in gap");
}

// Negative coords — display above primary; pet fully on upper display.
{
  _setScreenForTesting(NEGATIVE_Y);
  invalidateDisplayCache();
  assert.equal(isOnAnyDisplay({ x: 100, y: -900 }, PW, PH), true, "negative coords — on upper display");
}

// 1-px sliver overlap — below MIN_VISIBLE_PX (100) threshold.
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  // Pet starts at x = 1920 - 1 → only 1px overlapX with display.
  // Bottom-center anchor = x=1920-1+PW/2 = x=2089, outside workArea → anchor test fails.
  // overlapX = 1 < 100 → overlap test fails.
  assert.equal(isOnAnyDisplay({ x: 1919, y: 100 }, PW, PH), false, "1px sliver off right");
}

// Overlap exactly meets custom minOverlap threshold.
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  // overlapX = 50, overlapY = PH, with minOverlap=50 → should return true.
  assert.equal(isOnAnyDisplay({ x: 1870, y: 100 }, PW, PH, 50), true, "overlap exactly meets custom threshold");
}

// ---------------------------------------------------------------------------
// clampToNearestDisplayIfOffscreen
// ---------------------------------------------------------------------------

// Pet entirely on display 1 — position unchanged.
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  const pos = { x: 200, y: 200 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  assert.deepEqual(result, { x: 200, y: 200 }, "on display 1 — unchanged");
}

// Pet straddling seam — position unchanged (transit allowed).
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  const pos = { x: 1780, y: 300 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  assert.deepEqual(result, { x: 1780, y: 300 }, "straddling seam — unchanged");
}

// Pet fully off right of display 2 — snaps to right edge of display 2.
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  const pos = { x: 4000, y: 300 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  // display 2 workArea: x=1920, width=1920 → maxX = 1920 + 1920 - 340 = 3500.
  assert.equal(result.x, 3500, "off right — snaps to right edge of display 2");
  assert.equal(result.y, 300, "off right — y unchanged");
}

// Pet fully off above — snaps to top of display.
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  const pos = { x: 100, y: -1000 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  assert.equal(result.y, 0, "off above — snaps to y=0");
}

// Pet off beyond display 2 in dual setup — snaps to nearest (display 2).
{
  _setScreenForTesting(DUAL);
  invalidateDisplayCache();
  const pos = { x: 4200, y: 300 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  // Display 2 right edge for pet: 1920 + 1920 - 340 = 3500.
  assert.equal(result.x, 3500, "far right — snaps to display 2 right edge");
}

// Negative coords — pet off left of negative-y display snaps to that display.
{
  _setScreenForTesting(NEGATIVE_Y);
  invalidateDisplayCache();
  // Pet way above both displays.
  const pos = { x: 100, y: -3000 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  // Upper display workArea: y=-1080, height=1080 → minY=-1080, maxY=-1080+1080-420=-420.
  assert.equal(result.y, -1080, "negative coords — snaps to top of upper display");
}

// Result coordinates are integers.
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  const pos = { x: 100.7, y: 100.3 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: PW, height: PH });
  assert.ok(Number.isInteger(result.x), "x is integer");
  assert.ok(Number.isInteger(result.y), "y is integer");
}

// ---------------------------------------------------------------------------
// clampToVisibleWorkArea — legacy regression
// ---------------------------------------------------------------------------

// Off-screen pet snaps to nearest display.
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  const result = clampToVisibleWorkArea({ x: 3000, y: 200 }, { width: PW, height: PH });
  assert.equal(result.x, 1920 - PW, "legacy clamp — off-screen x snapped");
}

// On-screen pet unchanged.
{
  _setScreenForTesting(makeScreen([{ x: 0, y: 0, width: 1920, height: 1080 }]));
  invalidateDisplayCache();
  const result = clampToVisibleWorkArea({ x: 100, y: 100 }, { width: PW, height: PH });
  assert.deepEqual(result, { x: 100, y: 100 }, "legacy clamp — on-screen unchanged");
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

_setScreenForTesting(null);

console.error("display.test.ts: all display tests passed.");

/**
 * Unit tests for gravity floor logic in pet-motion-engine.
 *
 * Tests the pure `computeGravityFloor` helper which is the SSOT for which
 * y-coordinate constitutes the "floor" during gravity physics.
 *
 * Bug being guarded: a confined pet must fall to the terminal bottom, not the
 * screen work-area bottom.
 */

import assert from "node:assert/strict";

import { computeGravityFloor } from "../src/pet-motion-engine.js";

// Confined: floor = terminal bottom (y + height - petHeight), NOT screen bottom
assert.equal(computeGravityFloor({ y: 100, height: 400 }, 0, 900, 80), 420, "confined: floor = terminal bottom 420, not screen bottom 820");

// Confined at y=0
assert.equal(computeGravityFloor({ y: 0, height: 300 }, 0, 900, 80), 220, "confined at y=0: floor = 300 - 80 = 220");

// Degenerate: terminal taller than screen — still uses terminal bounds
assert.equal(computeGravityFloor({ y: 50, height: 1000 }, 0, 900, 80), 970, "degenerate tall terminal: floor from terminal bounds");

// Invariant: confined floor <= work-area floor when terminal bottom is above screen bottom
assert.ok(
  computeGravityFloor({ y: 200, height: 500 }, 0, 1080, 80) <= computeGravityFloor(null, 0, 1080, 80),
  "confined floor must not exceed the free-roam (work-area) floor",
);

// Unconfined: floor = work-area bottom
assert.equal(computeGravityFloor(null, 0, 900, 80), 820, "unconfined: floor = work-area bottom 820");

// Unconfined with non-zero workAreaY (e.g. macOS menu bar)
assert.equal(computeGravityFloor(null, 25, 875, 80), 820, "unconfined with workAreaY offset: 25 + 875 - 80 = 820");

console.log("pet-motion-gravity tests passed.");

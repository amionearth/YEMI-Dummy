/**
 * Unit tests for window-tracker-ppid.ts — pure PPID logic (no Electron deps).
 *
 * Tests:
 *   (1)  _parseWin32ChainOutput: empty stdout → empty map.
 *   (2)  _parseWin32ChainOutput: "41,40,39" with startPid=42 →
 *          Map { 42→41, 41→40, 40→39 }.
 *   (3)  _parseWin32ChainOutput: single ancestor → Map { start→parent }.
 *   (4)  _parseWin32ChainOutput: whitespace / trailing comma is tolerated.
 *   (5)  _parseWin32ChainOutput: non-numeric entries are ignored gracefully.
 *   (6)  isWin32MinimizedBounds: x ≤ -30000 → true (off-screen minimized).
 *   (7)  isWin32MinimizedBounds: y ≤ -30000 → true.
 *   (8)  isWin32MinimizedBounds: normal coords → false.
 *   (9)  isWin32MinimizedBounds: exactly -30000 on both axes → true (boundary).
 *   (10) getParentPidWin32: calls exec once, parses chain, returns parent.
 *   (11) getParentPidWin32: caching — second call within TTL does NOT spawn again.
 *   (12) getParentPidWin32: exec error → returns null.
 *   (13) getParentPidWin32: empty/no-ancestor stdout → returns null for root.
 *   (14) getParentPidWin32: chain populated — mid-chain pid served from cache.
 */

import assert from "node:assert/strict";

import {
  _parseWin32ChainOutput,
  isWin32MinimizedBounds,
  getParentPidWin32,
  _setExecFnForTesting,
  _clearWin32CacheForTesting,
} from "../src/window-tracker-ppid.js";

// ---------------------------------------------------------------------------
// (1) Empty stdout → empty map
// ---------------------------------------------------------------------------
{
  const m = _parseWin32ChainOutput("", 42);
  assert.equal(m.size, 0, "(1) empty stdout → empty map");
}

// ---------------------------------------------------------------------------
// (2) Canonical three-hop chain
// ---------------------------------------------------------------------------
{
  const m = _parseWin32ChainOutput("41,40,39", 42);
  assert.equal(m.size, 3, "(2) three entries");
  assert.equal(m.get(42), 41, "(2) 42 → 41");
  assert.equal(m.get(41), 40, "(2) 41 → 40");
  assert.equal(m.get(40), 39, "(2) 40 → 39");
}

// ---------------------------------------------------------------------------
// (3) Single ancestor
// ---------------------------------------------------------------------------
{
  const m = _parseWin32ChainOutput("10", 20);
  assert.equal(m.size, 1, "(3) one entry");
  assert.equal(m.get(20), 10, "(3) 20 → 10");
}

// ---------------------------------------------------------------------------
// (4) Whitespace tolerance
// ---------------------------------------------------------------------------
{
  const m = _parseWin32ChainOutput("  41 , 40 , 39 \r\n", 42);
  assert.equal(m.get(42), 41, "(4) whitespace trimmed");
  assert.equal(m.get(41), 40, "(4) mid entry");
}

// ---------------------------------------------------------------------------
// (5) Non-numeric / zero entries are dropped
// ---------------------------------------------------------------------------
{
  const m = _parseWin32ChainOutput("41,abc,0,39", 42);
  // "abc" and "0" are invalid; result chain: 42→41, 41→39
  assert.equal(m.get(42), 41, "(5) first valid entry");
  // After filtering, parts = [41, 39]; chain = [42, 41, 39]
  assert.equal(m.get(41), 39, "(5) non-numeric skipped, next valid used");
  assert.equal(m.has(42), true, "(5) start pid present");
}

// ---------------------------------------------------------------------------
// (6) isWin32MinimizedBounds: x ≤ -30000
// ---------------------------------------------------------------------------
assert.equal(isWin32MinimizedBounds(-30001, 0), true, "(6) x=-30001 → minimized");
assert.equal(isWin32MinimizedBounds(-32000, -32000), true, "(6) typical Windows off-screen coords");

// ---------------------------------------------------------------------------
// (7) isWin32MinimizedBounds: y ≤ -30000
// ---------------------------------------------------------------------------
assert.equal(isWin32MinimizedBounds(0, -30001), true, "(7) y=-30001 → minimized");

// ---------------------------------------------------------------------------
// (8) Normal on-screen coordinates
// ---------------------------------------------------------------------------
assert.equal(isWin32MinimizedBounds(0, 0), false, "(8) origin → not minimized");
assert.equal(isWin32MinimizedBounds(1920, 1080), false, "(8) normal coords → not minimized");
assert.equal(isWin32MinimizedBounds(-29999, 0), false, "(8) x=-29999 → not minimized");

// ---------------------------------------------------------------------------
// (9) Boundary: exactly -30000
// ---------------------------------------------------------------------------
assert.equal(isWin32MinimizedBounds(-30000, 0), true, "(9) x=-30000 → minimized (inclusive)");
assert.equal(isWin32MinimizedBounds(0, -30000), true, "(9) y=-30000 → minimized (inclusive)");

// ---------------------------------------------------------------------------
// (10) getParentPidWin32: calls exec once, parses chain, returns parent
// ---------------------------------------------------------------------------
{
  _clearWin32CacheForTesting();

  let spawnCount = 0;
  _setExecFnForTesting(async (_cmd, _args) => {
    spawnCount++;
    return { stdout: "41,40,39\n" };
  });

  const parent = await getParentPidWin32(42);
  assert.equal(parent, 41, "(10) returns immediate parent of startPid");
  assert.equal(spawnCount, 1, "(10) exec called exactly once");

  _setExecFnForTesting(null);
  _clearWin32CacheForTesting();
}

// ---------------------------------------------------------------------------
// (11) Caching — second call within TTL does NOT spawn again
// ---------------------------------------------------------------------------
{
  _clearWin32CacheForTesting();

  let spawnCount = 0;
  _setExecFnForTesting(async (_cmd, _args) => {
    spawnCount++;
    return { stdout: "41,40,39\n" };
  });

  // First call: fetches chain (spawn #1)
  const p1 = await getParentPidWin32(42);
  assert.equal(p1, 41, "(11) first call returns parent");
  assert.equal(spawnCount, 1, "(11) one spawn on first call");

  // Second call for same pid within TTL: served from cache
  const p2 = await getParentPidWin32(42);
  assert.equal(p2, 41, "(11) second call returns same parent");
  assert.equal(spawnCount, 1, "(11) no additional spawn — cache hit");

  // Mid-chain pid also served from cache (no extra spawn)
  const p3 = await getParentPidWin32(41);
  assert.equal(p3, 40, "(11) mid-chain pid served from cache");
  assert.equal(spawnCount, 1, "(11) still no additional spawn for mid-chain");

  _setExecFnForTesting(null);
  _clearWin32CacheForTesting();
}

// ---------------------------------------------------------------------------
// (12) exec error → returns null
// ---------------------------------------------------------------------------
{
  _clearWin32CacheForTesting();

  _setExecFnForTesting(async (_cmd, _args) => {
    throw new Error("powershell.exe spawn failed");
  });

  const parent = await getParentPidWin32(99);
  assert.equal(parent, null, "(12) exec error → null");

  _setExecFnForTesting(null);
  _clearWin32CacheForTesting();
}

// ---------------------------------------------------------------------------
// (13) Empty / no-ancestor stdout → startPid has no cached parent
// ---------------------------------------------------------------------------
{
  _clearWin32CacheForTesting();

  _setExecFnForTesting(async (_cmd, _args) => {
    return { stdout: "\n" }; // powershell returned nothing
  });

  const parent = await getParentPidWin32(100);
  assert.equal(parent, null, "(13) empty stdout → null (no ancestor)");

  _setExecFnForTesting(null);
  _clearWin32CacheForTesting();
}

// ---------------------------------------------------------------------------
// (14) Chain populated from startPid — deep pid served from cache on next call
// ---------------------------------------------------------------------------
{
  _clearWin32CacheForTesting();

  let spawnCount = 0;
  _setExecFnForTesting(async (_cmd, _args) => {
    spawnCount++;
    return { stdout: "201,202,203\n" };
  });

  // Fetch chain starting from 200 → populates 200→201, 201→202, 202→203
  await getParentPidWin32(200);
  assert.equal(spawnCount, 1, "(14) one spawn from startPid");

  // Now query deep ancestor pid=202 — should be in cache, no extra spawn
  const deepParent = await getParentPidWin32(202);
  assert.equal(deepParent, 203, "(14) deep chain pid served from cache");
  assert.equal(spawnCount, 1, "(14) no extra spawn for cached deep pid");

  _setExecFnForTesting(null);
  _clearWin32CacheForTesting();
}

console.log("window-tracker-ppid win32 validation passed.");

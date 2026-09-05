/**
 * Unit tests for findTerminalPidInChain in window-chain.ts.
 *
 * All tests inject a fake process tree via the `getParent` parameter so no
 * real OS process-tree lookup is needed and tests run in plain Node.
 *
 * Cases:
 *   (1) Multi-hop chain: client → shell → terminal → window owner found.
 *   (2) Single-hop chain: client is a direct child of the terminal process.
 *   (3) Depth cap: chain longer than maxDepth returns null (no OOB loop).
 *   (4) Reparent-to-init break: ppid === 1 breaks early, returns null.
 *   (5) Cycle guard: a ppid loop does not spin indefinitely.
 *   (6) Terminal window not in windows list: entire chain returns null.
 *   (7) Returns correct appName from the matched window.
 */
import assert from "node:assert/strict";

import { findTerminalPidInChain, type ChainWindow } from "../src/window-chain.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake parent-PID table from { child: parent } pairs. */
function makeTree(edges: Record<number, number>): (pid: number) => Promise<number | null> {
  return async (pid) => edges[pid] ?? null;
}

function makeWindow(ownerPid: number, ownerName = `proc-${ownerPid}`): ChainWindow {
  return { ownerPid, ownerName };
}

// ---------------------------------------------------------------------------
// (1) Multi-hop chain resolves to terminal window owner
// ---------------------------------------------------------------------------
{
  // Process tree: 42 (mcp client) → 41 (bash) → 40 (iTerm2 helper) → 39 (iTerm2 window)
  const tree = makeTree({ 42: 41, 41: 40, 40: 39 });
  const windows = [makeWindow(39, "iTerm2")];
  const result = await findTerminalPidInChain(42, windows, 10, tree);
  assert.ok(result !== null, "(1) should find terminal via multi-hop chain");
  assert.equal(result.pid, 39, "(1) should return terminal PID 39");
  assert.equal(result.appName, "iTerm2", "(1) should return correct appName");
}

// ---------------------------------------------------------------------------
// (2) Single-hop: client is direct child of terminal process
// ---------------------------------------------------------------------------
{
  const tree = makeTree({ 10: 9 });
  const windows = [makeWindow(9, "Alacritty")];
  const result = await findTerminalPidInChain(10, windows, 10, tree);
  assert.ok(result !== null, "(2) single-hop should resolve");
  assert.equal(result.pid, 9, "(2) terminal PID 9");
  assert.equal(result.appName, "Alacritty", "(2) correct appName");
}

// ---------------------------------------------------------------------------
// (3) Depth cap: chain longer than maxDepth returns null
// ---------------------------------------------------------------------------
{
  // Chain: 100 → 99 → 98 → 97 → 96 → terminal at 95 (but maxDepth=3 stops at 97)
  const tree = makeTree({ 100: 99, 99: 98, 98: 97, 97: 96, 96: 95 });
  const windows = [makeWindow(95, "WezTerm")];
  const result = await findTerminalPidInChain(100, windows, 3, tree);
  assert.equal(result, null, "(3) depth cap should return null before reaching terminal");
}

// ---------------------------------------------------------------------------
// (4) Reparent-to-init: ppid === 1 breaks the walk early
// ---------------------------------------------------------------------------
{
  // Chain: 50 → 1 (init/launchd) — should break and return null
  const tree = makeTree({ 50: 1 });
  const windows = [makeWindow(1, "launchd")]; // even if "window" exists at pid 1
  const result = await findTerminalPidInChain(50, windows, 10, tree);
  assert.equal(result, null, "(4) ppid=1 should break walk and return null");
}

// ---------------------------------------------------------------------------
// (5) Cycle guard: ppid loop does not spin indefinitely
// ---------------------------------------------------------------------------
{
  // Shell reparenting loop: 200 → 201 → 202 → 201 (cycle back to 201)
  const tree = makeTree({ 200: 201, 201: 202, 202: 201 });
  const windows = [makeWindow(999, "terminal")]; // terminal never in chain
  const result = await findTerminalPidInChain(200, windows, 10, tree);
  assert.equal(result, null, "(5) cycle guard must break loop and return null");
}

// ---------------------------------------------------------------------------
// (6) Terminal window not in windows list — entire chain returns null
// ---------------------------------------------------------------------------
{
  const tree = makeTree({ 60: 61, 61: 62 });
  // Window list has a DIFFERENT pid (62 is in chain but listed under pid 999)
  const windows = [makeWindow(999, "NotReachable")];
  const result = await findTerminalPidInChain(60, windows, 10, tree);
  assert.equal(result, null, "(6) should return null when no chain pid matches windows");
}

// ---------------------------------------------------------------------------
// (7) appName fallback when window is not in the list (win === undefined)
// ---------------------------------------------------------------------------
{
  // Two windows exist but neither matches the terminal PID found in PPID chain.
  // We construct a scenario where the window PID IS in windowPids (via the Set)
  // but NOT in the windows array when searched with .find() — impossible with
  // the current implementation since the Set is built from the same array.
  // Instead, test the "ownerName present" path to verify it's returned as-is.
  const tree = makeTree({ 70: 71 });
  const windows: ChainWindow[] = [{ ownerPid: 71, ownerName: "WezTerm" }];
  const result = await findTerminalPidInChain(70, windows, 10, tree);
  assert.ok(result !== null, "(7) should find terminal");
  assert.equal(result.appName, "WezTerm", "(7) ownerName returned as-is");
}

// ---------------------------------------------------------------------------
// (8) Null ppid breaks early
// ---------------------------------------------------------------------------
{
  // getParent returns null immediately
  const tree = makeTree({});
  const windows = [makeWindow(80, "terminal")];
  const result = await findTerminalPidInChain(80, windows, 10, tree);
  // clientPid itself is not walked — we look UP from clientPid, not at it
  assert.equal(result, null, "(8) null ppid on first hop returns null");
}

// ---------------------------------------------------------------------------
// (9) clientPid excluded from terminal resolution — cycle back to clientPid
//     via a middleman must NOT return clientPid even if it owns a window.
//     Without visited.add(clientPid) pre-seeding, windowPids.has(clientPid)
//     would match and wrongly confine the pet to the agent's own window.
// ---------------------------------------------------------------------------
{
  // clientPid = 300 owns a visible window.
  // Chain: 300 → 301 → 300 (cycle back).
  // The real terminal would be 999 but is unreachable; result must be null.
  const tree = makeTree({ 300: 301, 301: 300 });
  const windows = [makeWindow(300, "AgentWindow"), makeWindow(999, "Terminal")];
  const result = await findTerminalPidInChain(300, windows, 10, tree);
  assert.equal(result, null, "(9) clientPid owning a window must NOT be returned as the terminal");
}

// ---------------------------------------------------------------------------
// (10) Regression: normal multi-hop chain still resolves after clientPid
//      is pre-seeded in visited (should not affect valid forward traversal).
// ---------------------------------------------------------------------------
{
  // 400 (client) → 401 (shell) → 402 (terminal window owner)
  const tree = makeTree({ 400: 401, 401: 402 });
  const windows = [makeWindow(402, "Ghostty")];
  const result = await findTerminalPidInChain(400, windows, 10, tree);
  assert.ok(result !== null, "(10) normal chain still resolves after clientPid pre-seed");
  assert.equal(result.pid, 402, "(10) correct terminal PID returned");
  assert.equal(result.appName, "Ghostty", "(10) correct appName returned");
}

console.log("window-tracker-chain validation passed.");

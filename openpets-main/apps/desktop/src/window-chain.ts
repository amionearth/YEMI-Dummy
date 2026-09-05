/**
 * window-chain.ts
 *
 * Pure PPID-chain walk logic extracted from window-tracker.ts so it can be
 * unit-tested without pulling in the Electron-dependent logger chain.
 *
 * No imports — intentionally side-effect-free.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainWindow {
  readonly ownerPid: number;
  readonly ownerName: string;
}

// ---------------------------------------------------------------------------
// PPID chain walk
// ---------------------------------------------------------------------------

/**
 * Walk up the PPID chain from `clientPid` until we find a PID that owns a
 * window in `windows`. Returns { pid, appName } or null.
 *
 * @param clientPid  Starting PID (the MCP client process).
 * @param windows    List of on-screen windows to match against.
 * @param maxDepth   Maximum hops before giving up (default 10).
 * @param getParent  Injectable parent-PID lookup. Tests pass a fake process
 *                   tree; production callers use the real PPID resolver.
 */
export async function findTerminalPidInChain(
  clientPid: number,
  windows: ChainWindow[],
  maxDepth = 10,
  getParent: (pid: number) => Promise<number | null> = async () => null,
): Promise<{ pid: number; appName: string } | null> {
  const windowPids = new Set(windows.map((w) => w.ownerPid));
  // Pre-seed visited with clientPid so that a chain clientPid → X → clientPid
  // cannot resolve back to clientPid (the agent process itself is never a
  // valid terminal emulator, even if it happens to own a visible window).
  const visited = new Set<number>([clientPid]);
  let current = clientPid;

  for (let depth = 0; depth < maxDepth; depth++) {
    const ppid = await getParent(current);
    if (ppid === null || ppid <= 1) break;
    // Cycle guard: a PPID loop (e.g. shell reparented to itself after launchd
    // adoption) must not spin indefinitely.
    if (visited.has(ppid)) break;
    visited.add(ppid);

    if (windowPids.has(ppid)) {
      const win = windows.find((w) => w.ownerPid === ppid);
      return { pid: ppid, appName: win?.ownerName ?? "unknown" };
    }
    current = ppid;
  }

  return null;
}

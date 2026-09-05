/**
 * window-tracker-ppid.ts
 *
 * Platform-specific parent-PID lookup logic, extracted from window-tracker.ts
 * so it can be unit-tested without Electron dependencies (same pattern as
 * window-chain.ts and window-occlusion.ts).
 *
 * Platforms:
 *   - macOS  : `ps -p <pid> -o ppid=`  (one spawn per cache miss, 10 s TTL)
 *   - win32  : PowerShell Get-CimInstance — ONE spawn from the client PID
 *              walks up to maxDepth=10 ancestors and emits a comma-joined chain.
 *              All pids in that chain are cached so window-chain's per-step
 *              getParent() calls are served from memory (no extra spawns).
 *              TTL 5 s.
 *   - linux  : /proc/<pid>/status `PPid:` line via sync readFileSync. 10 s TTL.
 *   - other  : returns null.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Testability seam — inject a mock executor (e.g. to simulate PowerShell output)
// ---------------------------------------------------------------------------

type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

let _execFnOverride: ExecFn | null = null;

/** @internal — inject a stub executor for unit tests only. */
export function _setExecFnForTesting(fn: ExecFn | null): void {
  _execFnOverride = fn;
}

function getExecFn(): ExecFn {
  return _execFnOverride ?? ((cmd, args) => execFileAsync(cmd, args));
}

// ---------------------------------------------------------------------------
// macOS PPID — `ps -p <pid> -o ppid=`  (10 s cache per pid)
// ---------------------------------------------------------------------------

const ppidCache = new Map<number, number>();
const ppidCacheExpiry = new Map<number, number>();
const ppidCacheTtlMs = 10_000;

async function getParentPidMacos(pid: number): Promise<number | null> {
  const now = Date.now();
  const expiry = ppidCacheExpiry.get(pid);
  if (expiry !== undefined && now < expiry) return ppidCache.get(pid) ?? null;

  try {
    const { stdout } = await getExecFn()("ps", ["-p", String(pid), "-o", "ppid="]);
    const ppid = parseInt(stdout.trim(), 10);
    if (Number.isFinite(ppid) && ppid > 0) {
      ppidCache.set(pid, ppid);
      ppidCacheExpiry.set(pid, now + ppidCacheTtlMs);
      return ppid;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// win32 ancestor chain — ONE PowerShell call per cache miss for the start pid,
// populating the full chain so subsequent per-step lookups are cache hits.
// ---------------------------------------------------------------------------

/** @internal Cache for win32 parent-PID entries (pid → parent pid). */
const win32ParentCache = new Map<number, number>();
const win32ParentCacheExpiry = new Map<number, number>();
const win32CacheTtlMs = 5_000;

/** @internal — reset win32 cache between unit tests. */
export function _clearWin32CacheForTesting(): void {
  win32ParentCache.clear();
  win32ParentCacheExpiry.clear();
}

/**
 * Pure parser: converts PowerShell ancestor-chain stdout to a pid→parent map.
 * stdout example: "41,40,39"  startPid: 42  →  Map { 42→41, 41→40, 40→39 }
 * @internal exported for unit tests.
 */
export function _parseWin32ChainOutput(stdout: string, startPid: number): Map<number, number> {
  const parts = stdout
    .trim()
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const parentOf = new Map<number, number>();
  const chain = [startPid, ...parts];
  for (let i = 0; i < chain.length - 1; i++) {
    parentOf.set(chain[i]!, chain[i + 1]!);
  }
  return parentOf;
}

/**
 * Walk the full ancestor chain from startPid in ONE PowerShell call.
 * Uses Get-CimInstance (not deprecated wmic) up to 10 ancestors.
 * Populates win32ParentCache for each pid in the chain so the per-step
 * getParent() calls from window-chain are served from memory.
 */
async function fetchWin32AncestorChain(startPid: number): Promise<void> {
  // Single-line PowerShell script: walk PPID chain up to 10 hops,
  // emit comma-joined ancestor PID list.
  const script =
    `$cur=${startPid};$anc=@();` +
    `for($i=0;$i -lt 10;$i++){` +
    `$r=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cur) -ErrorAction SilentlyContinue;` +
    `if(-not $r){break};` +
    `$pp=[int]$r.ParentProcessId;` +
    `if($pp -le 0){break};` +
    `$anc+=$pp;$cur=$pp};` +
    `$anc -join ','`;

  try {
    const { stdout } = await getExecFn()("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    const parentOf = _parseWin32ChainOutput(stdout, startPid);
    const expiry = Date.now() + win32CacheTtlMs;
    for (const [pid, parent] of parentOf) {
      win32ParentCache.set(pid, parent);
      win32ParentCacheExpiry.set(pid, expiry);
    }
  } catch {
    // On error leave the cache empty; getParentPidWin32 returns null.
  }
}

/**
 * win32 parent-PID lookup.
 * First call for a given pid fetches the full ancestor chain via one PowerShell
 * invocation and caches all entries. Subsequent per-step calls from
 * window-chain.findTerminalPidInChain are served from the in-memory cache.
 */
export async function getParentPidWin32(pid: number): Promise<number | null> {
  const now = Date.now();
  const expiry = win32ParentCacheExpiry.get(pid);
  if (expiry !== undefined && now < expiry) return win32ParentCache.get(pid) ?? null;
  await fetchWin32AncestorChain(pid);
  return win32ParentCache.get(pid) ?? null;
}

// ---------------------------------------------------------------------------
// Linux — /proc/<pid>/status  (sync read, best-effort, 10 s cache)
// ---------------------------------------------------------------------------

const linuxPpidCache = new Map<number, number>();
const linuxPpidCacheExpiry = new Map<number, number>();
const linuxCacheTtlMs = 10_000;

export function getParentPidLinux(pid: number): number | null {
  const now = Date.now();
  const expiry = linuxPpidCacheExpiry.get(pid);
  if (expiry !== undefined && now < expiry) return linuxPpidCache.get(pid) ?? null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = /^PPid:\s*(\d+)/m.exec(status);
    if (!match) return null;
    const ppid = parseInt(match[1]!, 10);
    if (!Number.isFinite(ppid) || ppid <= 0) return null;
    linuxPpidCache.set(pid, ppid);
    linuxPpidCacheExpiry.set(pid, now + linuxCacheTtlMs);
    return ppid;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Platform dispatcher
// ---------------------------------------------------------------------------

/**
 * Return the parent PID of `pid` using the OS-appropriate method.
 * Returns null on unsupported platforms or on error.
 */
export async function getParentPid(pid: number): Promise<number | null> {
  if (process.platform === "darwin") return getParentPidMacos(pid);
  if (process.platform === "win32") return getParentPidWin32(pid);
  if (process.platform === "linux") {
    // getParentPidLinux is synchronous; wrap in a promise for uniform signature.
    return Promise.resolve(getParentPidLinux(pid));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Windows minimized-window bounds heuristic
// ---------------------------------------------------------------------------

/**
 * On Windows, `get-windows` does not filter IsIconic (minimized) windows.
 * Windows parks minimized windows at off-screen coordinates
 * (typically x = -32000, y = -32000). Treat any window at ≤ -30000 as
 * minimized/hidden so the rest of the confinement logic behaves identically
 * to macOS (where get-windows already excludes minimized windows).
 *
 * @internal exported for unit tests.
 */
export function isWin32MinimizedBounds(x: number, y: number): boolean {
  return x <= -30000 || y <= -30000;
}

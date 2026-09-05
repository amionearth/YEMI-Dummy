/**
 * window-occlusion.ts
 *
 * Pure occlusion math extracted from window-tracker.ts so it can be unit-tested
 * without pulling in the Electron-dependent logger chain.
 *
 * No imports — this module is intentionally side-effect-free.
 */

// ---------------------------------------------------------------------------
// Types (mirrored from window-tracker so this module is self-contained)
// ---------------------------------------------------------------------------

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OcclusionWindow {
  readonly id: number;
  readonly ownerPid: number;
  readonly bounds: WindowBounds;
}

// ---------------------------------------------------------------------------
// Occlusion detection
// ---------------------------------------------------------------------------

function boundsOverlap(a: WindowBounds, b: WindowBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Returns true if `target` is substantially covered by a SINGLE foreground
 * window that appears in front of it (lower CGWindowList index = front).
 *
 * Rules:
 * - Only considers windows in front of `target` in z-order.
 * - Excludes windows owned by `ownProcessId` (e.g. OpenPets' own always-on-top
 *   pet window) so the pet overlay never falsely occludes its own terminal.
 * - A single occluder must cover ≥ 90% of the target area to trigger.
 *   Additive accumulation across separate windows is intentionally NOT used:
 *   two ~60% windows are NOT occluding; only one window ≥ 90% is.
 */
export function isWindowOccluded(
  target: OcclusionWindow,
  allWindows: OcclusionWindow[],
  ownProcessId: number,
): boolean {
  const targetIdx = allWindows.findIndex((w) => w.id === target.id);
  if (targetIdx === -1) return true; // window gone — treat as occluded

  const targetArea = target.bounds.width * target.bounds.height;
  if (targetArea <= 0) return true;

  // Only windows in front of target, excluding own-process windows.
  const foreground = allWindows
    .slice(0, targetIdx)
    .filter((w) => w.ownerPid !== ownProcessId);

  for (const w of foreground) {
    if (!boundsOverlap(w.bounds, target.bounds)) continue;
    const ix = Math.max(target.bounds.x, w.bounds.x);
    const iy = Math.max(target.bounds.y, w.bounds.y);
    const iw = Math.min(target.bounds.x + target.bounds.width, w.bounds.x + w.bounds.width) - ix;
    const ih = Math.min(target.bounds.y + target.bounds.height, w.bounds.y + w.bounds.height) - iy;
    if (iw > 0 && ih > 0 && (iw * ih) / targetArea >= 0.9) return true;
  }

  return false;
}

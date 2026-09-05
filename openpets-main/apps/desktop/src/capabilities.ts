/**
 * Capabilities — Central probe for OS-level permissions and feature support.
 *
 * The window-confinement and terminal-focus features require specific macOS
 * permissions. This module provides a single place to query capability status
 * so the rest of the app can degrade gracefully.
 *
 * Graceful-degradation contract (from approved plan):
 * - Screen Recording: required for `get-windows` on macOS only. When denied,
 *   get-windows throws (exit 1) and confinement tracking falls back to
 *   free-roam. The confinement poller surfaces a one-time notification.
 * - Accessibility (AXRaise/focus): required only for "Focus session window"
 *   context-menu action on macOS. When absent, confinement tracking still
 *   works; only the focus button is degraded.
 * - Windows: confinement is fully supported. No Screen Recording concept.
 *   Focus action is not yet implemented (LOW priority).
 * - Linux: best-effort confinement via /proc and get-windows (X11).
 * - Other: confinement is a no-op. Free-roam applies.
 */

import { systemPreferences } from "electron";

import { debug } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfinementCapabilities {
  /** Platform supports window-bounds tracking at all. */
  readonly supported: boolean;
  /** Whether window-bounds polling is available (no permission needed). */
  readonly trackingAvailable: boolean;
  /** Whether the focus-session-window action can work. */
  readonly focusActionAvailable: boolean;
  /** Reason focusActionAvailable is false, if any. */
  readonly focusUnavailableReason?: "not_macos" | "accessibility_denied";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe current capability status for the window-confinement feature.
 * This is synchronous — no side-effects, no permission prompts.
 */
export function probeConfinementCapabilities(): ConfinementCapabilities {
  // Windows: get-windows works without any special permission.
  // Focus action is not yet implemented for win32 (LOW priority).
  if (process.platform === "win32") {
    debug("capabilities", "confinement probed — win32");
    return {
      supported: true,
      trackingAvailable: true,
      focusActionAvailable: false,
      focusUnavailableReason: "not_macos",
    };
  }

  // Linux: best-effort (X11 via get-windows + /proc PPID).
  // Focus action not implemented.
  if (process.platform === "linux") {
    debug("capabilities", "confinement probed — linux (best-effort)");
    return {
      supported: true,
      trackingAvailable: true,
      focusActionAvailable: false,
      focusUnavailableReason: "not_macos",
    };
  }

  if (process.platform !== "darwin") {
    debug("capabilities", "confinement unsupported — non-macOS/win32/linux");
    return {
      supported: false,
      trackingAvailable: false,
      focusActionAvailable: false,
      focusUnavailableReason: "not_macos",
    };
  }

  // macOS: bounds + owner PID always available; Accessibility needed for focus.
  const trackingAvailable = true;
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);

  debug("capabilities", "confinement capabilities probed", {
    trackingAvailable,
    focusActionAvailable: trusted,
  });

  return {
    supported: true,
    trackingAvailable,
    focusActionAvailable: trusted,
    focusUnavailableReason: trusted ? undefined : "accessibility_denied",
  };
}

/**
 * Returns true if the window-confinement tracking system should be active.
 * Supported on macOS, Windows, and Linux (best-effort).
 */
export function isConfinementSupported(): boolean {
  return (
    process.platform === "darwin" ||
    process.platform === "win32" ||
    process.platform === "linux"
  );
}

/**
 * Returns true if the "Focus session window" context-menu action can succeed
 * at this moment (Accessibility permission is currently granted).
 *
 * NOTE: The focus action itself handles the one-time Accessibility permission
 * prompt in terminal-focus.ts. This helper is for optional UI hints only.
 * Currently only supported on macOS.
 */
export function isFocusActionAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

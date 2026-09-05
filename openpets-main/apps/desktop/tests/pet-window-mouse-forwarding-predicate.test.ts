import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canForwardMouseEvents, shouldWatchForwardedMouseEvents } from "../src/mouse-forwarding.js";

// ─── real-function predicate tests ───────────────────────────────────────────
// These exercise the REAL production predicates — the pure, Electron-free core
// that pet-window.ts delegates to for its passthrough/watchdog decisions — so
// the test and production logic cannot drift. The Electron-bound runtime wiring
// (setIgnoreMouseEvents, the 750ms cursor probe, the timer bookkeeping) lives in
// pet-window.ts's installMousePassthroughAndDrag().

describe("canForwardMouseEvents", () => {
  it("reports forwarding support on the platforms Electron forwards on", () => {
    assert.equal(canForwardMouseEvents("darwin"), true);
    assert.equal(canForwardMouseEvents("win32"), true);
  });

  it("reports no forwarding support on Linux, where ignored windows get no events", () => {
    assert.equal(canForwardMouseEvents("linux"), false);
  });
});

describe("shouldWatchForwardedMouseEvents", () => {
  // Regression guard: the watchdog used to be win32-only while forwarding was
  // used on darwin too. When macOS's WindowServer stopped delivering forwarded
  // mousemove events (Space switch, display sleep, fullscreen transition), the
  // renderer hit-test never fired, passthrough was never lifted, and the pet
  // stayed unclickable and undraggable until the app restarted.
  it("watches macOS, where the WindowServer can silently stop forwarding events", () => {
    assert.equal(shouldWatchForwardedMouseEvents("darwin"), true);
  });

  it("keeps watching Windows, where forwarded mouse tracking goes stale", () => {
    assert.equal(shouldWatchForwardedMouseEvents("win32"), true);
  });

  it("does not watch Linux, where pet windows stay interactive instead", () => {
    assert.equal(shouldWatchForwardedMouseEvents("linux"), false);
  });

  it("watches exactly the platforms that depend on forwarded mouse events", () => {
    // The invariant the fix restores: a platform that relies on forwarded events
    // to detect hover MUST have a recovery path when those events stop arriving.
    for (const platform of ["darwin", "win32", "linux", "freebsd"]) {
      assert.equal(shouldWatchForwardedMouseEvents(platform), canForwardMouseEvents(platform), platform);
    }
  });
});

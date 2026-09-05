import assert from "node:assert/strict";

import {
  clearConfinementState,
  getEffectiveConfinementBounds,
  isConfinementEnabled,
  setConfinementEnabled,
  setConfinementState,
} from "../src/confinement-manager.js";

// Reset to known state before each logical block (module is a singleton).
// Re-enable after each block that disables.

// --- isConfinementEnabled / setConfinementEnabled ---

// Default is true.
assert.equal(isConfinementEnabled(), true, "default: confinement enabled");

setConfinementEnabled(false);
assert.equal(isConfinementEnabled(), false, "setter: disable");

setConfinementEnabled(true);
assert.equal(isConfinementEnabled(), true, "setter: re-enable");

// --- getEffectiveConfinementBounds: returns null when globally disabled ---
{
  const petId = "test-pet-disabled";
  const bounds = { x: 100, y: 200, width: 800, height: 600 };
  setConfinementState(petId, {
    terminalBounds: bounds,
    terminalMinimized: false,
    terminalOccluded: false,
    terminalOwnerPid: 1234,
    appName: "TestTerminal",
  });

  // Sanity: enabled → returns bounds
  setConfinementEnabled(true);
  assert.deepEqual(getEffectiveConfinementBounds(petId), bounds, "enabled: returns terminal bounds");

  // Disabled → returns null (free-roam)
  setConfinementEnabled(false);
  assert.equal(getEffectiveConfinementBounds(petId), null, "disabled: returns null immediately");

  // Re-enable: bounds resume
  setConfinementEnabled(true);
  assert.deepEqual(getEffectiveConfinementBounds(petId), bounds, "re-enabled: bounds resume");

  clearConfinementState(petId);
}

// --- getEffectiveConfinementBounds: returns null for untracked pet (enabled) ---
{
  setConfinementEnabled(true);
  assert.equal(getEffectiveConfinementBounds("nonexistent-pet"), null, "untracked pet: null when enabled");
}

// --- getEffectiveConfinementBounds: returns null when minimized (enabled) ---
{
  const petId = "test-pet-minimized";
  setConfinementState(petId, {
    terminalBounds: { x: 0, y: 0, width: 400, height: 300 },
    terminalMinimized: true,
    terminalOccluded: false,
    terminalOwnerPid: 42,
    appName: "Mini",
  });
  setConfinementEnabled(true);
  assert.equal(getEffectiveConfinementBounds(petId), null, "minimized terminal: null (free-roam) when enabled");
  clearConfinementState(petId);
}

// --- getEffectiveConfinementBounds: returns null when occluded (enabled) ---
{
  const petId = "test-pet-occluded";
  setConfinementState(petId, {
    terminalBounds: { x: 0, y: 0, width: 400, height: 300 },
    terminalMinimized: false,
    terminalOccluded: true,
    terminalOwnerPid: 42,
    appName: "Occluded",
  });
  setConfinementEnabled(true);
  assert.equal(getEffectiveConfinementBounds(petId), null, "occluded terminal: null when enabled");
  clearConfinementState(petId);
}

// Restore module-level default for any subsequent tests in the same process.
setConfinementEnabled(true);

console.error("confinement-manager validation passed.");

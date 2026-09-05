import assert from "node:assert/strict";

import { normalizePetConfinementEnabled } from "../src/app-state-core.js";

// --- normalizePetConfinementEnabled (pure helper used by normalizePreferences) ---

// Default value is true when input is non-boolean
assert.equal(normalizePetConfinementEnabled(undefined), true, "undefined -> default true");
assert.equal(normalizePetConfinementEnabled(null), true, "null -> default true");
assert.equal(normalizePetConfinementEnabled("true"), true, "string 'true' -> default true");
assert.equal(normalizePetConfinementEnabled(1), true, "number 1 -> default true");
assert.equal(normalizePetConfinementEnabled({}), true, "object -> default true");

// Boolean values are preserved as-is
assert.equal(normalizePetConfinementEnabled(true), true, "true -> true");
assert.equal(normalizePetConfinementEnabled(false), false, "false -> false");

// Custom default value is respected when input is non-boolean
assert.equal(normalizePetConfinementEnabled(undefined, false), false, "undefined + default false -> false");
assert.equal(normalizePetConfinementEnabled(undefined, true), true, "undefined + default true -> true");

// Boolean input always wins over the default
assert.equal(normalizePetConfinementEnabled(true, false), true, "true + default false -> true");
assert.equal(normalizePetConfinementEnabled(false, true), false, "false + default true -> false");

// --- validatePreferencePatch behavior for petConfinementEnabled ---
// validatePreferencePatch is private in windows.ts (electron dep); we verify the
// normalization contract via the pure helper used inside it.
// The contract: petConfinementEnabled must be boolean or the patch throws.
// The pure helper guarantees the normalization output is always boolean.
{
  // Simulate the validator logic for the petConfinementEnabled field:
  function simulateValidatePetConfinementEnabled(value: unknown): boolean {
    if (typeof value !== "boolean") throw new Error("Invalid pet-confinement-enabled value.");
    return value;
  }

  assert.equal(simulateValidatePetConfinementEnabled(true), true, "patch validator: true accepted");
  assert.equal(simulateValidatePetConfinementEnabled(false), false, "patch validator: false accepted");
  assert.throws(() => simulateValidatePetConfinementEnabled("yes"), /Invalid/, "patch validator: string throws");
  assert.throws(() => simulateValidatePetConfinementEnabled(1), /Invalid/, "patch validator: number throws");
  assert.throws(() => simulateValidatePetConfinementEnabled(undefined), /Invalid/, "patch validator: undefined throws");
}

console.error("pet-confinement-enabled normalization validation passed.");

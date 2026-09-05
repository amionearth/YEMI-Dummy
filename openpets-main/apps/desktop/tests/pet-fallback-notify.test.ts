import assert from "node:assert/strict";

import { shouldWarnFallback } from "../src/pet-fallback-notify.js";

// --- shouldWarnFallback pure-logic tests ---

// (a) Fires for explicit requested pet with pet_not_installed
{
  const warned = new Set<string>();
  assert.equal(
    shouldWarnFallback("my-pet", "pet_not_installed", warned),
    true,
    "should warn when pet is not installed",
  );
}

// (a) Also fires for invalid_pet_id and pet_broken
{
  const warned = new Set<string>();
  assert.equal(shouldWarnFallback("my-pet", "invalid_pet_id", warned), true, "should warn for invalid_pet_id");
  assert.equal(shouldWarnFallback("my-pet", "pet_broken", warned), true, "should warn for pet_broken");
}

// (b) Does NOT fire when no pet was requested (requestedPetId is falsy)
{
  const warned = new Set<string>();
  assert.equal(shouldWarnFallback(undefined, "pet_not_installed", warned), false, "should not warn with no requestedPetId");
  assert.equal(shouldWarnFallback("", "pet_not_installed", warned), false, "should not warn with empty requestedPetId");
}

// (c) Does NOT fire twice for the same requestedPetId (dedup)
{
  const warned = new Set<string>(["my-pet"]);
  assert.equal(
    shouldWarnFallback("my-pet", "pet_not_installed", warned),
    false,
    "should not warn again for already-warned petId",
  );
}

// (d) Does NOT fire when targetKind is explicit success (no fallback reason)
{
  const warned = new Set<string>();
  assert.equal(shouldWarnFallback("my-pet", undefined, warned), false, "should not warn when fallbackReason is undefined");
  assert.equal(shouldWarnFallback("my-pet", "default_broken_fallback_builtin", warned), false, "should not warn for default_broken_fallback_builtin");
}

// (e) Different petIds are independent in the dedup set
{
  const warned = new Set<string>(["pet-a"]);
  assert.equal(shouldWarnFallback("pet-b", "pet_not_installed", warned), true, "different petId not in warned set should warn");
}

console.log("pet-fallback-notify validation passed.");

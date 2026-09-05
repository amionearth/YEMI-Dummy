import assert from "node:assert/strict";

import { normalizePetPoolOrder } from "../src/pet-pool.js";

// --- normalizePetPoolOrder ---

// Returns undefined for non-array
assert.equal(normalizePetPoolOrder(undefined), undefined, "undefined input -> undefined");
assert.equal(normalizePetPoolOrder(null), undefined, "null -> undefined");
assert.equal(normalizePetPoolOrder("fox"), undefined, "string -> undefined");
assert.equal(normalizePetPoolOrder(42), undefined, "number -> undefined");

// Returns undefined for empty array
assert.equal(normalizePetPoolOrder([]), undefined, "empty array -> undefined");

// Filters out blank / non-string entries
assert.equal(normalizePetPoolOrder([""]), undefined, "only blank -> undefined");
assert.equal(normalizePetPoolOrder([null, undefined, 5]), undefined, "only non-strings -> undefined");

// Keeps valid pet IDs
assert.deepEqual(normalizePetPoolOrder(["fox"]), ["fox"], "single valid id");
assert.deepEqual(normalizePetPoolOrder(["fox", "azure"]), ["fox", "azure"], "two valid ids");

// Removes duplicates while preserving order
assert.deepEqual(normalizePetPoolOrder(["fox", "azure", "fox"]), ["fox", "azure"], "dedup preserves first occurrence");

// Trims whitespace before ID check
assert.deepEqual(normalizePetPoolOrder(["  fox  "]), ["fox"], "trims whitespace");

// Rejects IDs that fail assertSafePetId (e.g. slashes, dots)
assert.equal(normalizePetPoolOrder(["../bad-pet"]), undefined, "unsafe id filtered");
assert.equal(normalizePetPoolOrder(["bad/pet"]), undefined, "slash in id filtered");

// Mixed valid + invalid
assert.deepEqual(normalizePetPoolOrder(["fox", "../bad", "azure"]), ["fox", "azure"], "mixed keeps valid only");

// Large list is preserved in order
const large = ["a", "b", "c", "d", "e"].map((x) => `pet-${x}`);
assert.deepEqual(normalizePetPoolOrder(large), large, "preserves order for valid list");

// C6: length cap — input with more than 64 valid IDs returns exactly 64
{
  const manyIds = Array.from({ length: 80 }, (_, i) => `pet-${String(i).padStart(3, "0")}`);
  const result = normalizePetPoolOrder(manyIds);
  assert.ok(Array.isArray(result), "C6: result is an array");
  assert.equal((result as string[]).length, 64, "C6: exactly 64 entries returned for >64 input");
  assert.deepEqual(result, manyIds.slice(0, 64), "C6: first 64 entries preserved in order");
}

// C6: exactly 64 valid ids → all 64 returned (boundary)
{
  const exactly64 = Array.from({ length: 64 }, (_, i) => `pet-${String(i).padStart(3, "0")}`);
  const result = normalizePetPoolOrder(exactly64);
  assert.equal((result as string[]).length, 64, "C6: exactly-64 input -> 64 returned");
}

console.error("pet-pool-order (pet-pool) validation passed.");

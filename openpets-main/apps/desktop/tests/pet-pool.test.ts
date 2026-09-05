import assert from "node:assert/strict";

import { LeaseManager } from "../src/lease-manager.js";
import { getEligiblePoolPetIds, resolvePoolAssignment } from "../src/pet-pool.js";

// Helpers
function makeCount(counts: Record<string, number> = {}) {
  return (petId: string) => counts[petId] ?? 0;
}

// --- resolvePoolAssignment ---

// Pool disabled (undefined / empty) -> null
assert.equal(resolvePoolAssignment({ orderedPool: undefined, eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() }), null, "no pool -> null");
assert.equal(resolvePoolAssignment({ orderedPool: [], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() }), null, "empty pool -> null");

// No eligible pets -> null
assert.equal(resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: [], countActiveExplicit: makeCount() }), null, "no eligible pets -> null");

// Basic sequential: first free slot returned
{
  const result = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(result?.petId, "fox", "first free slot is fox");
}

// First slot occupied -> second returned
{
  const result = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 1 }) });
  assert.equal(result?.petId, "azure", "fox occupied -> azure returned");
}

// All pool slots occupied -> exhausted -> null (caller falls back to default)
{
  const result = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 1, azure: 1 }) });
  assert.equal(result, null, "all pool slots occupied -> null (default fallback)");
}

// Pool entry not in eligible (e.g. not installed) -> skipped
{
  const result = resolvePoolAssignment({ orderedPool: ["not-installed", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(result?.petId, "azure", "not-installed slot skipped, falls to azure");
}

// Single slot pool, slot free
{
  const result = resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(result?.petId, "fox", "single slot pool returns fox");
}

// Single slot pool, slot occupied -> exhausted -> null (default fallback)
{
  const result = resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 2 }) });
  assert.equal(result, null, "single occupied slot -> null (default fallback)");
}

// A free eligible pet that is NOT in the ordered pool is never assigned;
// exhausted ordered pool -> null (default) even when other eligible pets are free.
{
  const result = resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 1 }) });
  assert.equal(result, null, "exhausted pool -> null even when non-pool pet (azure) is free");
}

// --- getEligiblePoolPetIds (updated: now excludes defaultPetId too) ---

const installed = [
  { id: "built-in", builtIn: true, broken: false },
  { id: "fox", builtIn: false, broken: false },
  { id: "azure", builtIn: false, broken: false },
  { id: "broken-pet", builtIn: false, broken: true },
];

// With no default pet to exclude (using built-in as default, already excluded)
const eligible = getEligiblePoolPetIds(installed, "built-in", "built-in");
assert.deepEqual(eligible, ["fox", "azure"], "excludes built-in and broken pets");

// All built-in or broken
const eligible2 = getEligiblePoolPetIds([{ id: "built-in", builtIn: true, broken: false }], "built-in", "built-in");
assert.deepEqual(eligible2, [], "empty when only built-in");

// CHANGE 3: default pet is also excluded
{
  const result = getEligiblePoolPetIds(installed, "built-in", "fox");
  assert.deepEqual(result, ["azure"], "excludes default pet (fox) in addition to built-in and broken");
}

// CHANGE 3: all installed are either built-in, default, or broken → empty
{
  const result = getEligiblePoolPetIds(installed, "built-in", "azure");
  assert.deepEqual(result, ["fox"], "only non-default, non-builtin, non-broken pets eligible");
}

// --- C1: explicit requestedPetId bypasses the pool ---
// The gating decision lives in resolveLeaseTarget (local-ipc.ts) which we cannot
// import directly (electron deps). We verify the invariant via LeaseManager with a
// resolver that models the new CHANGE 2 gating: pool is consulted ONLY when
// !requestedPetId; explicit default/built-in requests bypass pool entirely.
{
  const DEFAULT_PET = "my-default";
  let poolConsulted = false;

  function modeledResolver(requestedPetId: string | undefined) {
    if (!requestedPetId) {
      // Only here do we consult the pool.
      poolConsulted = true;
      return { targetKind: "explicit" as const, actualPetId: "fox" }; // simulated pool result
    }
    // Explicit request for default or built-in → return default, no pool.
    if (requestedPetId === DEFAULT_PET || requestedPetId === "builtin") {
      return { targetKind: "default" as const, actualPetId: DEFAULT_PET };
    }
    return { targetKind: "explicit" as const, actualPetId: requestedPetId };
  }

  const mgr = new LeaseManager({ resolveTarget: modeledResolver, getDefaultPetId: () => DEFAULT_PET });

  // C1a: explicit default pet request → targetKind "default", pool not consulted
  poolConsulted = false;
  const l1 = mgr.acquire(DEFAULT_PET);
  assert.equal(l1.targetKind, "default", "C1a: requestedPetId===defaultPetId -> targetKind default");
  assert.equal(poolConsulted, false, "C1a: pool not consulted for explicit default-pet request");

  // C1b: no pet requested → pool IS consulted, result is explicit
  poolConsulted = false;
  const l2 = mgr.acquire(undefined);
  assert.equal(l2.targetKind, "explicit", "C1b: no requestedPetId -> pool consulted, got explicit");
  assert.equal(poolConsulted, true, "C1b: pool consulted when no requestedPetId");

  // C1c: explicit installed non-default pet → pool not consulted, targetKind explicit
  poolConsulted = false;
  const l3 = mgr.acquire("installed-fox");
  assert.equal(l3.targetKind, "explicit", "C1c: explicit installed pet -> explicit targetKind");
  assert.equal(poolConsulted, false, "C1c: pool not consulted for explicit non-default pet request");
}

// --- C2: sequential assignments get distinct slots (no double-assignment) ---
// Simulates: first call assigns fox (count was 0), then fox count becomes 1,
// second call returns azure (proves synchronous register→query works correctly).
{
  let foxCount = 0;
  function countMock(petId: string) {
    return petId === "fox" ? foxCount : 0;
  }

  const r1 = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: countMock });
  assert.equal(r1?.petId, "fox", "C2: first assignment is fox (slot 0 free)");

  // Simulate fox is now registered (lease count updated after first assignment).
  foxCount = 1;
  const r2 = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: countMock });
  assert.equal(r2?.petId, "azure", "C2: second assignment is azure (distinct slot, fox now occupied)");
  assert.notEqual(r1?.petId, r2?.petId, "C2: two sequential assignments are distinct");
}

// --- C3: petPoolEnabled=false → pool not consulted, legacy default behavior ---
// The petPoolEnabled gate is in tryResolveFromPool (local-ipc.ts, not importable).
// We test the equivalent contract: when the gate prevents tryResolveFromPool from
// calling resolvePoolAssignment, the lease returns targetKind "default".
// The pure side of the gate: when orderedPool is undefined, resolvePoolAssignment
// returns null (same effect as the petPoolEnabled=false early-return).
{
  // Gate disabled path: resolvePoolAssignment receives undefined pool (as if petPoolEnabled=false)
  const gated = resolvePoolAssignment({ orderedPool: undefined, eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(gated, null, "C3: pool disabled (undefined) -> resolvePoolAssignment returns null");

  // Also verify via LeaseManager: when resolver respects petPoolEnabled=false,
  // result is targetKind "default".
  const mgrC3 = new LeaseManager({
    resolveTarget: (_requestedPetId) => ({ targetKind: "default" as const, actualPetId: "my-default" }),
    getDefaultPetId: () => "my-default",
  });
  const lc3 = mgrC3.acquire(undefined);
  assert.equal(lc3.targetKind, "default", "C3: petPoolEnabled=false → targetKind default (pool bypassed)");
}

// --- C4: exhausted ordered pool returns null (caller uses default, no random) ---
{
  const r = resolvePoolAssignment({
    orderedPool: ["azure"],
    eligiblePetIds: ["fox", "azure"],
    countActiveExplicit: makeCount({ azure: 1 }),
  });
  assert.equal(r, null, "C4: all pool slots occupied -> null (default fallback, no random)");
}

// --- C5: successful pool assignment maps to targetKind "explicit" ---
// resolvePoolAssignment returns { petId } and the caller (tryResolveFromPool →
// resolveLeaseTarget) wraps it as { targetKind: "explicit", actualPetId: petId }.
// We verify the mapping via LeaseManager with a pool-style resolver.
{
  const mgrC5 = new LeaseManager({
    resolveTarget: (requestedPetId) => {
      if (!requestedPetId) {
        // Simulates: tryResolveFromPool returns { petId: "fox" }
        const poolResult = resolvePoolAssignment({
          orderedPool: ["fox"],
          eligiblePetIds: ["fox"],
          countActiveExplicit: makeCount(),
        });
        if (poolResult) return { targetKind: "explicit" as const, actualPetId: poolResult.petId };
      }
      return { targetKind: "default" as const, actualPetId: "my-default" };
    },
    getDefaultPetId: () => "my-default",
  });

  const lc5 = mgrC5.acquire(undefined);
  assert.equal(lc5.targetKind, "explicit", "C5: pool assignment maps to targetKind 'explicit'");
  assert.equal(lc5.actualTargetPetId, "fox", "C5: actualTargetPetId is the resolved pool pet");
  assert.equal(lc5.usingDefaultPet, false, "C5: usingDefaultPet is false for pool assignment");
}

console.error("pet-pool validation passed.");

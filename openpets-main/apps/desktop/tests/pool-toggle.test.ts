/**
 * Tests for pool-toggle behavior: getExplicitLeaseSnapshots() and related logic.
 * dispatchPoolToggle() itself depends on local-ipc.ts which has Electron imports,
 * so we test the LeaseManager layer directly here and validate all invariants.
 */
import assert from "node:assert/strict";

import { LeaseManager } from "../src/lease-manager.js";

// --- Shared helpers ---
function makeManager(overrides: {
  onFirstExplicitLease?: (petId: string) => void;
  onLastExplicitLease?: (petId: string) => void;
  now?: () => number;
} = {}) {
  let clock = 1_000;
  const now = overrides.now ?? (() => clock);
  const manager = new LeaseManager({
    ttlMs: 10_000,
    now,
    resolveTarget: (requestedPetId) => {
      if (!requestedPetId) return { targetKind: "default", actualPetId: "builtin" };
      return { targetKind: "explicit", actualPetId: requestedPetId };
    },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onFirstExplicitLease: overrides.onFirstExplicitLease ?? (() => {}),
    onLastExplicitLease: overrides.onLastExplicitLease ?? (() => {}),
  });
  return { manager, getClock: () => clock, setClock: (v: number) => { clock = v; } };
}

// --- getExplicitLeaseSnapshots: returns only non-expired explicit leases ---
{
  const { manager } = makeManager();

  // Empty initially.
  assert.equal(manager.getExplicitLeaseSnapshots().length, 0, "Should be empty with no leases.");

  // Default lease not included.
  const defaultLease = manager.acquire();
  assert.equal(manager.getExplicitLeaseSnapshots().length, 0, "Default lease should not appear in explicit snapshots.");
  manager.release(defaultLease.leaseId);

  // Explicit lease included.
  const lease1 = manager.acquire("snoopy", 1234);
  const snapshots = manager.getExplicitLeaseSnapshots();
  assert.equal(snapshots.length, 1, "One explicit lease should appear.");
  assert.equal(snapshots[0].targetKind, "explicit", "Snapshot targetKind should be explicit.");
  assert.equal(snapshots[0].clientPid, 1234, "Snapshot should carry clientPid.");
  assert.equal(snapshots[0].leaseId, lease1.leaseId, "Snapshot leaseId should match.");

  // Multiple explicit leases.
  const lease2 = manager.acquire("rex", 5678);
  assert.equal(manager.getExplicitLeaseSnapshots().length, 2, "Two explicit leases should appear.");

  manager.release(lease1.leaseId);
  assert.equal(manager.getExplicitLeaseSnapshots().length, 1, "After release, one snapshot remains.");

  manager.release(lease2.leaseId);
  assert.equal(manager.getExplicitLeaseSnapshots().length, 0, "After all releases, no snapshots.");
}

// --- getExplicitLeaseSnapshots: expired leases are excluded ---
{
  let clock = 1_000;
  const { manager, setClock } = makeManager({ now: () => clock });

  const lease = manager.acquire("buddy", 9999);
  assert.equal(manager.getExplicitLeaseSnapshots().length, 1, "Non-expired lease should be visible.");

  // Advance past TTL (10_000 ms).
  clock += 15_000;
  assert.equal(manager.getExplicitLeaseSnapshots().length, 0, "Expired lease should not appear in snapshots.");

  manager.release(lease.leaseId); // Cleanup.
}

// --- getExplicitLeaseSnapshots: clientPid is preserved ---
{
  const { manager } = makeManager();
  const lease = manager.acquire("kitty", 42);
  const snapshots = manager.getExplicitLeaseSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].clientPid, 42, "clientPid should be 42.");
  manager.release(lease.leaseId);
}

// --- Pool toggle flow simulation using LeaseManager directly ---
// Simulate the despawn part of dispatchPoolToggle(false):
// release all explicit leases and collect their PIDs.
{
  const closed: string[] = [];
  const { manager } = makeManager({
    onLastExplicitLease: (petId) => closed.push(petId),
  });

  const lease1 = manager.acquire("snoopy", 100);
  const lease2 = manager.acquire("rex", 200);
  assert.equal(manager.getExplicitLeaseSnapshots().length, 2, "Two leases before toggle-off.");

  // Simulate dispatchPoolToggle(false) logic:
  const snapshots = manager.getExplicitLeaseSnapshots();
  const collectedPids: number[] = [];
  for (const s of snapshots) {
    if (s.clientPid && s.clientPid > 0) collectedPids.push(s.clientPid);
    manager.release(s.leaseId);
  }

  assert.deepEqual(collectedPids.sort((a, b) => a - b), [100, 200], "Both PIDs collected during toggle-off.");
  assert.equal(manager.getExplicitLeaseSnapshots().length, 0, "All leases released after toggle-off.");
  assert.equal(closed.length, 2, "onLastExplicitLease fired for both pets.");
}

// --- Re-enable: simulate respawn for alive PIDs ---
{
  const opened: string[] = [];
  const { manager } = makeManager({
    onFirstExplicitLease: (petId) => opened.push(petId),
  });

  // Simulate re-acquire for a "surviving" PID (pool is re-enabled, resolveTarget gives pool pet).
  manager.acquire(undefined, 100); // acquire with pid=100 — default lease (pool off).
  assert.equal(opened.length, 0, "Default acquire does not fire onFirstExplicitLease.");

  // Simulate explicit pool acquire (pool now on, resolveTarget would return explicit).
  // We test with an explicit petId as a stand-in for pool-resolved pet.
  manager.acquire("snoopy", 100);
  assert.equal(opened.length, 1, "Re-acquire fires onFirstExplicitLease.");
  assert.equal(opened[0], "snoopy");
}

console.log("pool-toggle tests passed.");

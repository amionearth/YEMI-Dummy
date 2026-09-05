import assert from "node:assert/strict";

import { LeaseManager } from "../src/lease-manager.js";

let now = 1_000;
const opened: string[] = [];
const closed: string[] = [];
const manager = new LeaseManager({
  ttlMs: 100,
  now: () => now,
  resolveTarget: (requestedPetId) => {
    if (!requestedPetId) return { targetKind: "default", actualPetId: "builtin" };
    if (requestedPetId === "missing") return { targetKind: "default", actualPetId: "builtin", fallbackReason: "pet_not_installed" };
    return { targetKind: "explicit", actualPetId: requestedPetId };
  },
  getDefaultPetId: () => "builtin",
  getPetDisplayName: (petId) => petId,
  onFirstExplicitLease: (petId) => opened.push(petId),
  onLastExplicitLease: (petId) => closed.push(petId),
});

const defaultLease = manager.acquire();
assert.equal(defaultLease.usingDefaultPet, true, "Default lease did not target default.");
assert.equal(defaultLease.targetKind, "default", "Default lease targetKind should be 'default'.");
manager.release(defaultLease.leaseId);
assert.equal(closed.length, 0, "Default release closed a temp pet.");

const first = manager.acquire("snoopy");
const second = manager.acquire("snoopy");
assert.equal(opened.join(","), "snoopy", "Explicit pet did not open once for multiple leases.");
manager.release(first.leaseId);
assert.equal(closed.length, 0, "Explicit pet closed before final lease release.");
manager.release(first.leaseId);
manager.release(second.leaseId);
assert.equal(closed.join(","), "snoopy", "Explicit pet did not close after final release.");

const missing = manager.acquire("missing");
assert.equal(missing.fallbackReason, "pet_not_installed", "Missing pet did not fall back to default.");
assert.equal(missing.usingDefaultPet, true, "Missing pet should use default.");
manager.release(missing.leaseId);

const expiring = manager.acquire("tux");
now += 50;
manager.heartbeat(expiring.leaseId);
now += 75;
assert.equal(manager.cleanupExpired().length, 0, "Heartbeat did not extend lease.");
now += 50;
assert.equal(manager.cleanupExpired().length, 1, "Expired lease was not cleaned up.");

const expiredBeforeHeartbeat = manager.acquire("dobby");
now += 200;
assert.throws(() => manager.heartbeat(expiredBeforeHeartbeat.leaseId));
assert.equal(manager.get(expiredBeforeHeartbeat.leaseId), null, "Expired lease was still readable before cleanup.");

console.log("Lease manager validation passed.");

// --- checkPidLiveness tests ---

{
  // Test 1: no leases with clientPid — no-op, returns empty array
  const pidManager = new LeaseManager({
    ttlMs: 60_000,
    now: () => 1_000,
    resolveTarget: (id) => id ? { targetKind: "explicit", actualPetId: id } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
  });
  const result = pidManager.checkPidLiveness();
  assert.equal(result.length, 0, "checkPidLiveness with no leases should return empty array.");
  console.log("checkPidLiveness: no leases — PASS");
}

{
  // Test 2: lease with current process PID — alive, not released
  const pidManager = new LeaseManager({
    ttlMs: 60_000,
    now: () => 1_000,
    resolveTarget: (id) => id ? { targetKind: "explicit", actualPetId: id } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
  });
  const lease = pidManager.acquire("fido", process.pid);
  const result = pidManager.checkPidLiveness();
  assert.equal(result.length, 0, "checkPidLiveness should not release alive process.");
  // Lease should still be accessible
  assert.notEqual(pidManager.get(lease.leaseId), null, "Alive lease should remain active.");
  console.log("checkPidLiveness: alive PID — PASS");
}

{
  // Test 3: lease with dead/invalid PID — released, onLastExplicitLease fires
  const pidClosed: string[] = [];
  const pidManager = new LeaseManager({
    ttlMs: 60_000,
    now: () => 1_000,
    resolveTarget: (id) => id ? { targetKind: "explicit", actualPetId: id } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLastExplicitLease: (petId) => pidClosed.push(petId),
  });
  const deadPid = 999_999_999;
  const lease = pidManager.acquire("rex", deadPid);
  const result = pidManager.checkPidLiveness();
  assert.equal(result.length, 1, "checkPidLiveness should release dead PID lease.");
  assert.equal(result[0].actualTargetPetId, "rex", "Released lease should have correct pet ID.");
  assert.equal(pidManager.get(lease.leaseId), null, "Dead PID lease should no longer be active.");
  assert.equal(pidClosed.join(","), "rex", "onLastExplicitLease should fire after dead PID lease release.");
  console.log("checkPidLiveness: dead PID — PASS");
}

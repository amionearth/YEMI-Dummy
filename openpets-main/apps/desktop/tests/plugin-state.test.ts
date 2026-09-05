import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initializePluginState, openPetsPluginStateFileName, PluginStateStore, type PluginStateRecord } from "../src/plugin-state.js";

const missingDir = tempDir();
const missingStore = initializePluginState({ userDataPath: missingDir });
assert.deepEqual(missingStore.snapshot(), { version: 1, plugins: {} });
assert.equal(existsSync(join(missingDir, openPetsPluginStateFileName)), true);

const corruptDir = tempDir();
const corruptPath = join(corruptDir, openPetsPluginStateFileName);
writeFileSync(corruptPath, "{not json", "utf8");
const corruptStore = initializePluginState({ userDataPath: corruptDir });
assert.deepEqual(corruptStore.listRecords(), []);
assert.deepEqual(JSON.parse(readFileSync(corruptPath, "utf8")) as unknown, { version: 1, plugins: {} });

const malformedRecordDir = tempDir();
const malformedRecordPath = join(malformedRecordDir, openPetsPluginStateFileName);
writeFileSync(
  malformedRecordPath,
  JSON.stringify({
    version: 1,
    plugins: {
      invalid: { ...makeRecord({ id: "invalid" }), config: [] },
      valid: makeRecord({ id: "valid" }),
    },
  }),
  "utf8",
);
const malformedRecordStore = initializePluginState({ userDataPath: malformedRecordDir });
assert.deepEqual(malformedRecordStore.listRecords().map((record) => record.id), ["valid"]);

const statePath = join(tempDir(), "custom-plugin-state.json");
const store = initializePluginState({ statePath });
const firstRecord = makeRecord({ approvedPermissions: ["timer", "pet:speak"] });
store.upsertRecord(firstRecord);

const reloadedStore = new PluginStateStore({ statePath });
reloadedStore.read();
assert.deepEqual(reloadedStore.getRecord("stretch-reminder"), {
  ...firstRecord,
  approvedPermissions: ["pet:speak", "timer"],
});

const secondRecord = makeRecord({ id: "water-reminder", version: "2.0.0", source: "local", approvedPermissions: ["pet:reaction"] });
reloadedStore.upsertRecord(secondRecord);
assert.deepEqual(reloadedStore.listRecords().map((record) => record.id), ["stretch-reminder", "water-reminder"]);
reloadedStore.removeRecord("water-reminder");
assert.equal(reloadedStore.getRecord("water-reminder"), undefined);

assert.equal(reloadedStore.setEnabled("stretch-reminder", false).enabled, false);
assert.equal(reloadedStore.setEnabled("stretch-reminder", true).enabled, true);

assert.deepEqual(reloadedStore.updateConfig("stretch-reminder", { intervalMinutes: 10, message: "Move" }).config, {
  intervalMinutes: 10,
  message: "Move",
});
assert.deepEqual(reloadedStore.updateConfig("stretch-reminder", { message: "Stretch" }).config, {
  intervalMinutes: 10,
  message: "Stretch",
});

assert.equal(reloadedStore.setBrokenReason("stretch-reminder", "Manifest missing").brokenReason, "Manifest missing");
assert.equal(reloadedStore.clearBrokenReason("stretch-reminder").brokenReason, undefined);

assert.throws(() => reloadedStore.upsertRecord(makeRecord({ id: "bad-dupe", approvedPermissions: ["timer", "timer"] })), /Duplicate plugin permission/);
assert.throws(
  () => reloadedStore.upsertRecord(makeRecord({ id: "bad-invalid", approvedPermissions: ["timer", "bad" as "timer"] })),
  /Invalid plugin permission/,
);

const uninitializedStore = new PluginStateStore({ statePath: join(tempDir(), "uninitialized.json") });
assert.throws(() => uninitializedStore.snapshot(), /not been initialized/);
assert.throws(() => uninitializedStore.listRecords(), /not been initialized/);
assert.throws(() => uninitializedStore.getRecord("stretch-reminder"), /not been initialized/);
assert.throws(() => uninitializedStore.setEnabled("stretch-reminder", true), /not been initialized/);

assert.throws(() => reloadedStore.setEnabled("missing-plugin", true), /Plugin is not installed/);
assert.throws(() => reloadedStore.updateConfig("missing-plugin", { ok: true }), /Plugin is not installed/);
assert.throws(() => reloadedStore.setBrokenReason("missing-plugin", "broken"), /Plugin is not installed/);
assert.throws(() => reloadedStore.clearBrokenReason("missing-plugin"), /Plugin is not installed/);

for (const badValue of [undefined, Number.NaN, Infinity, -Infinity, BigInt(1), new Date(), new Map(), new Set(), () => true, Symbol("bad")]) {
  assert.throws(() => reloadedStore.updateConfig("stretch-reminder", { badValue }), /JSON-compatible/);
}
assert.throws(() => reloadedStore.updateConfig("stretch-reminder", { nested: { badValue: Number.NaN } }), /JSON-compatible/);
assert.throws(() => reloadedStore.updateConfig("stretch-reminder", { list: ["ok", undefined] }), /JSON-compatible/);
assert.throws(() => reloadedStore.upsertRecord(makeRecord({ id: "bad-config-date", config: { when: new Date() } })), /JSON-compatible/);
assert.throws(() => reloadedStore.upsertRecord(makeRecord({ id: "bad-config-bigint", config: { count: BigInt(1) } })), /JSON-compatible/);

reloadedStore.upsertRecord(makeRecord({ id: "clone-check", config: { nested: { message: "original" }, items: ["a"] } }));
const snapshot = reloadedStore.snapshot();
(snapshot.plugins["clone-check"].config.nested as { message: string }).message = "changed";
(snapshot.plugins["clone-check"].config.items as string[]).push("b");
assert.deepEqual(reloadedStore.getRecord("clone-check")?.config, { nested: { message: "original" }, items: ["a"] });
const listedRecord = reloadedStore.listRecords().find((record) => record.id === "clone-check");
assert.ok(listedRecord);
(listedRecord.config.nested as { message: string }).message = "listed change";
assert.deepEqual(reloadedStore.getRecord("clone-check")?.config, { nested: { message: "original" }, items: ["a"] });
const fetchedRecord = reloadedStore.getRecord("clone-check");
assert.ok(fetchedRecord);
(fetchedRecord.config.nested as { message: string }).message = "fetched change";
assert.deepEqual(reloadedStore.getRecord("clone-check")?.config, { nested: { message: "original" }, items: ["a"] });

const updateStorePath = join(tempDir(), "update-plugin-state.json");
const updateStore = initializePluginState({ statePath: updateStorePath });
updateStore.upsertRecord(
  makeRecord({
    id: "update-check",
    update: { availableVersion: "1.1.0", checkedAt: "2026-05-18T00:00:00.000Z", catalogUrl: "https://example.test/catalog.json" },
  }),
);
updateStore.upsertRecord(makeRecord({ id: "update-normalized", update: { availableVersion: "", checkedAt: "   ", catalogUrl: undefined } }));
const updateReload = new PluginStateStore({ statePath: updateStorePath });
updateReload.read();
assert.deepEqual(updateReload.getRecord("update-check")?.update, {
  availableVersion: "1.1.0",
  checkedAt: "2026-05-18T00:00:00.000Z",
  catalogUrl: "https://example.test/catalog.json",
});
assert.equal(updateReload.getRecord("update-normalized")?.update, undefined);

const orderingStore = initializePluginState({ statePath: join(tempDir(), "ordering-plugin-state.json") });
orderingStore.upsertRecord(makeRecord({ id: "order-a", approvedPermissions: ["timer", "pet:reaction", "pet:speak"] }));
orderingStore.upsertRecord(makeRecord({ id: "order-b", approvedPermissions: ["pet:reaction", "pet:speak", "timer"] }));
assert.deepEqual(orderingStore.getRecord("order-a")?.approvedPermissions, ["pet:speak", "pet:reaction", "timer"]);
assert.deepEqual(orderingStore.getRecord("order-b")?.approvedPermissions, ["pet:speak", "pet:reaction", "timer"]);

console.error("Plugin state validation passed.");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "openpets-plugin-state-"));
}

function makeRecord(patch: Partial<PluginStateRecord> = {}): PluginStateRecord {
  const id = patch.id ?? "stretch-reminder";
  return Object.fromEntries(Object.entries({
    id,
    version: patch.version ?? "1.0.0",
    manifestPath: patch.manifestPath ?? `/tmp/${id}/openpets.plugin.json`,
    installPath: patch.installPath ?? `/tmp/${id}`,
    source: patch.source ?? "catalog",
    enabled: patch.enabled ?? true,
    approvedPermissions: patch.approvedPermissions ?? ["pet:speak", "timer"],
    config: patch.config ?? {},
    brokenReason: patch.brokenReason,
    update: patch.update,
  }).filter(([, value]) => value !== undefined)) as unknown as PluginStateRecord;
}

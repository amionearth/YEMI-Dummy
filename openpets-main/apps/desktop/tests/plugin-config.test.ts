import assert from "node:assert/strict";

import { getEffectivePluginConfig, getPluginDefaultConfig, resolvePluginNumericConfig, resolvePluginStringConfig, validatePluginConfigReplacement } from "../src/plugin-config.js";
import type { OpenPetsPluginManifest } from "../src/plugin-manifest.js";

const base = manifest();

assert.deepEqual(getPluginDefaultConfig(base), { enabled: true, intervalMinutes: 10, message: "Stretch", mood: "calm" });

assertInvalidReplacement({ message: null }, "invalid_config_value");
assertInvalidReplacement({ message: ["x"] }, "invalid_config_value");
assertInvalidReplacement({ message: { text: "x" } }, "invalid_config_value");
assertInvalidReplacement({ missing: true }, "unknown_config_key");
assertInvalidReplacement({ intervalMinutes: Number.POSITIVE_INFINITY }, "invalid_config_value");
assertInvalidReplacement({ mood: "unknown" }, "invalid_select_value");
assertInvalidReplacement(new Date(), "invalid_config");
assertInvalidReplacement(new Map(), "invalid_config");
assertInvalidReplacement([], "invalid_config");
const soundManifest = manifest({ configSchema: { sound: { type: "sound" } } });
assert.equal(validatePluginConfigReplacement(soundManifest, { sound: "alert" }).ok, true);
assert.equal(validatePluginConfigReplacement(soundManifest, { sound: { kind: "user-sound", id: "a".repeat(32), name: "Ding" } }).ok, true);
assert.equal(validatePluginConfigReplacement(soundManifest, { sound: { kind: "user-sound", id: "../secret" } }).ok, false);
assert.equal(validatePluginConfigReplacement(soundManifest, { sound: { kind: "user-sound", id: "not-a-hash" } }).ok, false);
assert.equal(validatePluginConfigReplacement(soundManifest, { sound: "/tmp/ding.wav" }).ok, false);
assert.deepEqual(validatePluginConfigReplacement(base, { message: "Move", details: "Now", intervalMinutes: 12, enabled: false, mood: "active" }), {
  ok: true,
  config: { details: "Now", enabled: false, intervalMinutes: 12, message: "Move", mood: "active" },
  errors: [],
});

assert.deepEqual(getEffectivePluginConfig(base, { stale: { old: true }, message: "Hydrate" }), {
  ok: true,
  config: { enabled: true, intervalMinutes: 10, message: "Hydrate", mood: "calm" },
  errors: [],
});
const invalidPersisted = getEffectivePluginConfig(base, { intervalMinutes: "10" });
assert.equal(invalidPersisted.ok, false);
assert.equal(invalidPersisted.errors[0]?.code, "invalid_config_value");

assert.equal(resolvePluginNumericConfig(base, {}, "intervalMinutes", { min: 5 }), 10);
assert.equal(resolvePluginNumericConfig(base, { intervalMinutes: 7, stale: true }, "intervalMinutes", { min: 5 }), 7);
assert.throws(() => resolvePluginNumericConfig(base, { intervalMinutes: 4 }, "intervalMinutes", { min: 5 }), /at least 5/);
assert.throws(() => resolvePluginNumericConfig(manifest({ configSchema: { intervalMinutes: { type: "number" } } }), {}, "intervalMinutes", { min: 5 }), /must resolve to an integer/);
assert.throws(() => resolvePluginNumericConfig(base, { intervalMinutes: 6.5 }, "intervalMinutes", { min: 5 }), /must resolve to an integer/);

assert.equal(resolvePluginStringConfig(base, {}, "message", "text"), "Stretch");
assert.equal(resolvePluginStringConfig(base, { message: "Move" }, "message", "text"), "Move");
assert.equal(resolvePluginStringConfig(base, {}, "mood", "select"), "calm");
assert.throws(() => resolvePluginStringConfig(base, { message: 1 }, "message", "text"), /invalid/);
assert.throws(() => resolvePluginStringConfig(manifest({ configSchema: { message: { type: "text" } } }), {}, "message", "text"), /resolve to a value/);
assert.throws(() => resolvePluginStringConfig(base, {}, "intervalMinutes", "text"), /text config field/);

console.error("Plugin config validation passed.");

function assertInvalidReplacement(config: unknown, code: string): void {
  const result = validatePluginConfigReplacement(base, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === code), JSON.stringify(result.errors));
}

function manifest(patch: Partial<OpenPetsPluginManifest> = {}): OpenPetsPluginManifest {
  return {
    manifestVersion: 1,
    id: "plug",
    name: "Plug",
    version: "1.0.0",
    runtime: "declarative",
    permissions: ["timer"],
    configSchema: patch.configSchema ?? {
      message: { type: "text", default: "Stretch" },
      details: { type: "textarea" },
      intervalMinutes: { type: "number", default: 10 },
      enabled: { type: "boolean", default: true },
      mood: { type: "select", default: "calm", options: [{ label: "Calm", value: "calm" }, { label: "Active", value: "active" }] },
    },
    triggers: [],
  };
}

import assert from "node:assert/strict";
import { validatePluginCatalog } from "../src/plugin-catalog-validation.js";

const entry = { id: "hello-plugin", name: "Hello", version: "1.0.0", description: "desc", runtime: "declarative", permissions: ["timer", "pet:speak"], downloadUrl: "https://zip.openpets.dev/plugins/hello.zip", sha256: "a".repeat(64) };

const catalog = validatePluginCatalog({ version: 1, generatedAt: new Date().toISOString(), plugins: [entry] });
assert.equal(catalog.plugins[0].id, "hello-plugin");
assert.deepEqual(catalog.plugins[0].permissions, ["pet:speak", "timer"]);

assert.throws(() => validatePluginCatalog({ version: 1, generatedAt: "now", plugins: [{ ...entry, extra: true }] }), /Unknown field/);
assert.throws(() => validatePluginCatalog({ version: 1, generatedAt: "now", plugins: [entry, entry] }), /Duplicate plugin id/);
assert.throws(() => validatePluginCatalog({ version: 1, generatedAt: "now", plugins: [{ ...entry, sha256: "A".repeat(64) }] }), /sha256/);

const catalogV2 = validatePluginCatalog({ version: 2, generatedAt: "now", plugins: [{ ...entry, id: "js-plugin", runtime: "javascript", icon: "github", sdkVersion: "1.0.0", permissions: ["pet:speak", "network"], minOpenPetsVersion: "2.0.0", maxOpenPetsVersion: "3.0.0", deprecated: true, statusReason: "Use another plugin", network: { hosts: ["api.example.com"] } }] });
assert.equal(catalogV2.version, 2);
assert.equal(catalogV2.plugins[0].runtime, "javascript");
assert.equal(catalogV2.plugins[0].icon, "github");
assert.throws(() => validatePluginCatalog({ version: 2, generatedAt: "now", plugins: [{ ...entry, runtime: "python" }] }), /runtime/);
assert.throws(() => validatePluginCatalog({ version: 2, generatedAt: "now", plugins: [{ ...entry, icon: "https://example.com/icon.svg" }] }), /icon/);
assert.throws(() => validatePluginCatalog({ version: 2, generatedAt: "now", plugins: [{ ...entry, runtime: "javascript", sdkVersion: "1.0.0", permissions: ["pet:speak", "network"], network: { hosts: ["*.example.com"] } }] }), /network/);

console.error("Plugin catalog validation passed.");

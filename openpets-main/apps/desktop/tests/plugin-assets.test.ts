import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { win32 } from "node:path";

import { isPathContained, parsePluginSpriteRequest, resolveDeclaredAssetPath } from "../src/plugin-assets.js";
import type { OpenPetsJavascriptPluginManifest } from "../src/plugin-manifest.js";
import { getSafeSpritePreviews } from "../src/plugin-service.js";
import { registerPluginAssetProtocol } from "../src/plugin-asset-protocol.js";

const manifest: OpenPetsJavascriptPluginManifest = {
  manifestVersion: 3, id: "local.alpha", name: "Alpha", version: "1.2.3", runtime: "javascript", sdkVersion: "3.0.0", entry: "index.js", permissions: [],
  assets: { sprites: { courier: { path: "assets/courier.webp", frameWidth: 256, frameHeight: 256, frames: 6, durationMs: 720 } } },
};

assert.equal(parsePluginSpriteRequest("openpets-plugin-asset://local.alpha/sprites/courier?v=1.2.3", "GET")?.assetName, "courier");
assert.equal(parsePluginSpriteRequest("openpets-plugin-asset://local.alpha/sprites/other?v=1.2.3", "POST"), undefined, "unsupported methods are denied");
assert.equal(parsePluginSpriteRequest("openpets-plugin-asset://local.alpha/sprites/%2e%2e?v=1.2.3", "GET"), undefined, "traversal is denied");
assert.equal(parsePluginSpriteRequest("openpets-plugin-asset://local.alpha/images/courier?v=1.2.3", "GET"), undefined, "non-sprite paths are denied");
assert.throws(() => resolveDeclaredAssetPath(manifest, "/plugins/local.alpha", "sprites", "other"), /not declared/, "cross-plugin/undeclared asset names are denied");
assert.deepEqual(getSafeSpritePreviews(manifest), {
  courier: { url: "openpets-plugin-asset://local.alpha/sprites/courier?v=1.2.3", frameWidth: 256, frameHeight: 256, frames: 6, durationMs: 720 },
}, "snapshots expose host-built protocol URLs and trusted metadata only");
assert.equal(isPathContained("C:\\plugins\\local.alpha", "C:\\plugins\\local.alpha\\assets\\courier.webp", win32.relative), true);
assert.equal(isPathContained("C:\\plugins\\local.alpha", "C:\\plugins\\local.alpha-other\\courier.webp", win32.relative), false, "Windows sibling prefixes are not contained");
assert.equal(isPathContained("C:\\plugins\\local.alpha", "C:\\plugins\\outside\\courier.webp", win32.relative), false, "Windows traversal is not contained");
assert.equal(isPathContained("C:\\plugins\\local.alpha", "D:\\plugins\\local.alpha\\courier.webp", win32.relative), false, "Windows cross-volume paths are not contained");

const install = mkdtempSync(`${tmpdir()}/openpets-protocol-`);
const manifestPath = `${install}/openpets.plugin.json`;
mkdirSync(`${install}/assets`);
writeFileSync(manifestPath, JSON.stringify(manifest));
const handlers = new Map<string, (request: { url: string; method: string }) => Promise<Response>>();
registerPluginAssetProtocol({ handle: (scheme, handler) => handlers.set(scheme, handler) }, () => ({
  allowedPluginRoots: [install],
  stateStore: { getRecord: (id: string) => id === "local.alpha" ? { id, version: "1.2.3", enabled: true, installPath: install, manifestPath } : undefined },
}) as never, async (path) => (path === install ? "C:\\plugins\\local.alpha" : "D:\\plugins\\local.alpha\\assets\\courier.webp") as any);
const registered = handlers.get("openpets-plugin-asset");
assert.ok(registered, "plugin asset protocol is registered");
assert.equal((await registered!({ url: "openpets-plugin-asset://local.alpha/sprites/missing?v=1.2.3", method: "GET" })).status, 404, "registered handler denies undeclared assets");
assert.equal((await registered!({ url: "openpets-plugin-asset://local.beta/sprites/courier?v=1.2.3", method: "GET" })).status, 404, "registered handler denies cross-plugin lookup");
assert.equal((await registered!({ url: "openpets-plugin-asset://local.alpha/sprites/%2e%2e?v=1.2.3", method: "GET" })).status, 404, "registered handler denies traversal");
assert.equal((await registered!({ url: "openpets-plugin-asset://local.alpha/sprites/courier?v=1.2.3", method: "POST" })).status, 405, "registered handler denies methods");
assert.equal((await registered!({ url: "openpets-plugin-asset://local.alpha/sprites/courier?v=1.2.3", method: "GET" })).status, 404, "registered handler denies cross-volume assets");
rmSync(install, { recursive: true, force: true });

console.log("Plugin asset protocol boundary tests passed.");

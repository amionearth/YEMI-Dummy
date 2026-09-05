import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UserSoundStore } from "../src/plugin-user-sound-store.js";

const root = mkdtempSync(join(tmpdir(), "openpets-user-sounds-"));
const source = join(root, "ding.ogg");
writeFileSync(source, Buffer.from("OggS test sound", "utf8"));

const store = new UserSoundStore(join(root, "store"));
const ref = await store.importFromPath("plugin-a", source, { name: "Ding" });

assert.match(ref.id, /^[a-f0-9]{32}$/);
assert.equal(existsSync(await store.resolvePath("plugin-a", ref.id)), true);
await assert.rejects(() => store.resolvePath("plugin-b", ref.id), /invalid/);
await assert.rejects(() => store.resolvePath("plugin-a", "../bad"), /invalid/);

await store.clearPlugin("plugin-a");
await assert.rejects(() => store.resolvePath("plugin-a", ref.id), /invalid/);

console.error("Plugin user sound store validation passed.");

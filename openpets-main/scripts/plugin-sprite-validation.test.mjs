import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSpriteAssetBytes } from "./plugin-sprite-validation.mjs";

const sprite = { path: "assets/courier.webp", frameWidth: 256, frameHeight: 256, frames: 8 };

test("accepts the courier sprite bytes", async () => {
  const bytes = await readFile(fileURLToPath(new URL("../plugins/official/openpets.calendar-airmail/assets/couriers/courier-airdog.webp", import.meta.url)));
  assert.doesNotThrow(() => validateSpriteAssetBytes(sprite, bytes, "courier"));
});

test("rejects malformed and metadata-mismatched sprite bytes", async () => {
  assert.throws(() => validateSpriteAssetBytes(sprite, Buffer.from("not an image"), "bad"), /expected image\/webp bytes/);
  const bytes = await readFile(fileURLToPath(new URL("../plugins/official/openpets.calendar-airmail/assets/couriers/courier-airdog.webp", import.meta.url)));
  assert.throws(() => validateSpriteAssetBytes({ ...sprite, frames: 5 }, bytes, "bad"), /dimensions/);
});

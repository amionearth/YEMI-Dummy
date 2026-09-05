import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = join(dirname(fileURLToPath(import.meta.url)), "index.js");

if (process.platform !== "win32") {
  chmodSync(entrypoint, 0o755);
}

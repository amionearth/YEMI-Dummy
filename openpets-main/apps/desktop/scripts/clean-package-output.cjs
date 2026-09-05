const { rmSync } = require("node:fs");
const { basename, dirname, resolve } = require("node:path");

const scriptsDir = __dirname;
const desktopDir = resolve(scriptsDir, "..");
const target = resolve(desktopDir, "dist-electron");

if (basename(target) !== "dist-electron" || dirname(target) !== desktopDir) {
  throw new Error(`Refusing to clean unexpected package output path: ${target}`);
}

rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

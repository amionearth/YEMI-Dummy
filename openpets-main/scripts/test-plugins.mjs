#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const officialDir = join(repoRoot, "plugins", "official");
const communityDir = join(repoRoot, "plugins", "community");

const files = [];
const tests = [];

async function pathExists(path) {
  try {
    await readdir(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function collectPluginChecks() {
  await collectPluginSourceChecks(officialDir);
  await collectPluginSourceChecks(communityDir);
}

async function collectPluginSourceChecks(sourceDir) {
  if (!(await pathExists(sourceDir))) return;
  const plugins = await readdir(sourceDir, { withFileTypes: true });
  for (const plugin of plugins) {
    if (!plugin.isDirectory() || plugin.name.startsWith(".")) continue;
    const pluginDir = join(sourceDir, plugin.name);
    files.push(join(pluginDir, "index.js"));
    await collectTestFiles(pluginDir);
  }
}

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTestFiles(path);
    } else if (entry.isFile() && entry.name === "test.js") {
      files.push(path);
      tests.push(path);
    }
  }
}

await collectPluginChecks();

if (files.length === 0) {
  console.log("No plugin JavaScript files found.");
  process.exit(0);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of tests) {
  const result = spawnSync(process.execPath, [file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Checked ${files.length} plugin JavaScript file${files.length === 1 ? "" : "s"}; ran ${tests.length} plugin test${tests.length === 1 ? "" : "s"}.`);

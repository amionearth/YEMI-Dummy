import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { readDeclaredPluginFiles } from "./plugin-assets.js";
import { defaultMaxPluginManifestBytes, isUnderPath, readSafePluginManifest } from "./plugin-manifest-reader.js";
import { OPENPETS_PLUGIN_MANIFEST_FILENAME, validatePluginManifest, type OpenPetsPluginManifest } from "./plugin-manifest.js";

export type LocalPluginLoadResult = { readonly manifest: OpenPetsPluginManifest; readonly installPath: string; readonly manifestPath: string };
export type LocalPluginSourceManifest = { readonly manifest: OpenPetsPluginManifest; readonly manifestText: string; readonly entryText?: string; readonly declaredFiles?: ReadonlyMap<string, Buffer> };
const maxPluginEntryBytes = 1024 * 1024;

export async function loadLocalPluginSnapshot(options: { readonly sourceFolder: string; readonly userDataPath: string; readonly maxManifestBytes?: number }): Promise<LocalPluginLoadResult> {
  const source = await readLocalPluginSourceManifest({ sourceFolder: options.sourceFolder, maxManifestBytes: options.maxManifestBytes });
  return publishLocalPluginSnapshot({ manifest: source.manifest, manifestText: source.manifestText, entryText: source.entryText, declaredFiles: source.declaredFiles, userDataPath: options.userDataPath, maxManifestBytes: options.maxManifestBytes });
}

export async function readLocalPluginSourceManifest(options: { readonly sourceFolder: string; readonly maxManifestBytes?: number }): Promise<LocalPluginSourceManifest> {
  const maxBytes = options.maxManifestBytes ?? defaultMaxPluginManifestBytes;
  const sourceStat = await fs.lstat(options.sourceFolder);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("Selected plugin folder is invalid.");
  const realSourceFolder = await fs.realpath(options.sourceFolder);

  const sourceManifestPath = join(realSourceFolder, OPENPETS_PLUGIN_MANIFEST_FILENAME);
  const manifestStat = await fs.lstat(sourceManifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Selected plugin manifest is invalid.");
  if (manifestStat.size > maxBytes) throw new Error("Plugin manifest is too large.");
  const realSourceManifestPath = await fs.realpath(sourceManifestPath);
  if (dirname(realSourceManifestPath) !== realSourceFolder || basename(realSourceManifestPath) !== OPENPETS_PLUGIN_MANIFEST_FILENAME) throw new Error("Selected plugin manifest is invalid.");

  let handle: FileHandle | undefined;
  try {
    const nofollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    handle = await fs.open(sourceManifestPath, constants.O_RDONLY | nofollow);
    const text = await readBoundedUtf8(handle, maxBytes);
    const parsed = JSON.parse(text) as unknown;
    const result = validatePluginManifest(parsed);
    if (!result.ok) throw new Error(`Plugin manifest validation failed: ${formatManifestValidationErrors(result.errors)}`);
    if (!isSafePluginDirectoryName(result.manifest.id)) throw new Error("Plugin id is reserved.");
    if (result.manifest.manifestVersion !== 2 && result.manifest.manifestVersion !== 3) return { manifest: result.manifest, manifestText: text };
    const entryPath = join(realSourceFolder, result.manifest.entry);
    const entryStat = await fs.lstat(entryPath);
    if (!entryStat.isFile() || entryStat.isSymbolicLink()) throw new Error("Selected plugin entry is invalid.");
    if (entryStat.size > maxPluginEntryBytes) throw new Error("Plugin entry file is too large.");
    const realEntryPath = await fs.realpath(entryPath);
    if (!isUnderPath(realEntryPath, realSourceFolder) || realEntryPath !== join(realSourceFolder, result.manifest.entry)) throw new Error("Selected plugin entry is invalid.");
    let entryHandle: FileHandle | undefined;
    try {
      const nofollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      entryHandle = await fs.open(entryPath, constants.O_RDONLY | nofollow);
      const entryText = await readBoundedUtf8(entryHandle, maxPluginEntryBytes);
      const declaredFiles = result.manifest.manifestVersion === 3 ? await readDeclaredPluginFiles(result.manifest, realSourceFolder) : undefined;
      return { manifest: result.manifest, manifestText: text, entryText, declaredFiles };
    } finally { await entryHandle?.close().catch(() => undefined); }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function publishLocalPluginSnapshot(options: { readonly manifest: OpenPetsPluginManifest; readonly manifestText: string; readonly entryText?: string; readonly declaredFiles?: ReadonlyMap<string, Buffer>; readonly userDataPath: string; readonly maxManifestBytes?: number }): Promise<LocalPluginLoadResult> {
  const maxBytes = options.maxManifestBytes ?? defaultMaxPluginManifestBytes;
  const devRoot = join(options.userDataPath, "plugins-dev");
  await fs.mkdir(devRoot, { recursive: true });
  await assertRealDirectory(devRoot, "Plugin development directory is invalid.");
  const installPath = join(devRoot, options.manifest.id);
  const manifestPath = join(installPath, OPENPETS_PLUGIN_MANIFEST_FILENAME);
  const tempPath = join(devRoot, `.tmp-${options.manifest.id}-${process.pid}-${Date.now()}`);
  const tempManifestPath = join(tempPath, OPENPETS_PLUGIN_MANIFEST_FILENAME);
  await fs.rm(tempPath, { recursive: true, force: true });
  await fs.mkdir(tempPath, { recursive: true });
  try {
    await assertRealDirectory(tempPath, "Plugin temporary directory is invalid.");
    await fs.writeFile(tempManifestPath, options.manifestText, { mode: 0o600 });
    if (options.manifest.manifestVersion === 2 || options.manifest.manifestVersion === 3) {
      if (options.entryText === undefined) throw new Error("Plugin entry file is missing.");
      const tempEntryPath = join(tempPath, options.manifest.entry);
      await fs.mkdir(dirname(tempEntryPath), { recursive: true });
      await fs.writeFile(tempEntryPath, options.entryText, { mode: 0o600 });
      for (const [relPath, bytes] of options.declaredFiles ?? new Map<string, Buffer>()) {
        const filePath = join(tempPath, relPath);
        await fs.mkdir(dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, bytes, { mode: 0o600 });
      }
    }
    await readSafePluginManifest({ installPath: tempPath, manifestPath: tempManifestPath, allowedPluginRoots: [devRoot], maxManifestBytes: maxBytes, expectedId: options.manifest.id, expectedVersion: options.manifest.version });
    await replaceInstallDirectory(devRoot, installPath, tempPath);
  } finally {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
  const copied = await readSafePluginManifest({ installPath, manifestPath, allowedPluginRoots: [devRoot], maxManifestBytes: maxBytes, expectedId: options.manifest.id, expectedVersion: options.manifest.version });
  return { manifest: copied, installPath, manifestPath };
}

async function assertRealDirectory(path: string, message: string): Promise<void> {
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(message);
}

async function replaceInstallDirectory(root: string, installPath: string, tempPath: string): Promise<void> {
  const backupPath = join(root, `.bak-${Date.now()}-${process.pid}`);
  let hadExisting = false;
  try {
    await assertRealDirectory(tempPath, "Plugin temporary directory is invalid.");
    try { await assertRealDirectory(installPath, "Plugin install directory is invalid."); hadExisting = true; }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ENOENT") throw error; }
    if (hadExisting) await fs.rename(installPath, backupPath);
    await fs.rename(tempPath, installPath);
    await fs.rm(backupPath, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(installPath, { recursive: true, force: true }).catch(() => undefined);
    if (hadExisting) await fs.rename(backupPath, installPath).catch(() => undefined);
    throw error;
  }
}

async function readBoundedUtf8(handle: FileHandle, maxBytes: number): Promise<string> {
  const buffer = Buffer.alloc(maxBytes + 1);
  const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
  if (bytesRead > maxBytes) throw new Error("Plugin manifest is too large.");
  return buffer.subarray(0, bytesRead).toString("utf8");
}

function isSafePluginDirectoryName(id: string): boolean {
  return id !== "." && id !== ".." && !id.startsWith(".") && !/[\\/]/.test(id);
}

function formatManifestValidationErrors(errors: readonly { readonly path: string; readonly code: string; readonly message: string }[]): string {
  return errors.slice(0, 6).map((error) => `${error.path} ${error.code}: ${error.message}`).join("; ");
}

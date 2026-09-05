import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { OPENPETS_PLUGIN_MANIFEST_FILENAME, validatePluginManifest, type OpenPetsPluginManifest } from "./plugin-manifest.js";

export const defaultMaxPluginManifestBytes = 64 * 1024;

export type ReadPluginManifestOptions = {
  readonly installPath: string;
  readonly manifestPath: string;
  readonly allowedPluginRoots: readonly string[];
  readonly maxManifestBytes?: number;
  readonly expectedId?: string;
  readonly expectedVersion?: string;
};

export async function readSafePluginManifest(options: ReadPluginManifestOptions): Promise<OpenPetsPluginManifest> {
  const maxBytes = options.maxManifestBytes ?? defaultMaxPluginManifestBytes;
  const realInstallPath = await fs.realpath(options.installPath);
  const allowedRoots = await Promise.all(options.allowedPluginRoots.map((root) => fs.realpath(root)));
  if (!allowedRoots.some((root) => isUnderPath(realInstallPath, root))) throw new Error("Plugin install path is outside allowed plugin roots.");

  const realManifestPath = await fs.realpath(options.manifestPath);
  if (!isUnderPath(realManifestPath, realInstallPath)) throw new Error("Plugin manifest path is outside install path.");
  if (dirname(realManifestPath) !== realInstallPath || basename(realManifestPath) !== OPENPETS_PLUGIN_MANIFEST_FILENAME) throw new Error("Plugin manifest path is invalid.");

  const stat = await fs.stat(realManifestPath);
  if (!stat.isFile()) throw new Error("Plugin manifest path is not a file.");
  if (stat.size > maxBytes) throw new Error("Plugin manifest is too large.");
  const manifestText = await readBoundedUtf8(realManifestPath, maxBytes);
  const parsed = JSON.parse(manifestText) as unknown;
  const result = validatePluginManifest(parsed);
  if (!result.ok) throw new Error(`Plugin manifest validation failed: ${formatManifestValidationErrors(result.errors)}`);
  if ((options.expectedId !== undefined && result.manifest.id !== options.expectedId) || (options.expectedVersion !== undefined && result.manifest.version !== options.expectedVersion)) throw new Error("Plugin manifest id/version does not match installed state.");
  return result.manifest;
}

async function readBoundedUtf8(path: string, maxBytes: number): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(path, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) throw new Error("Plugin manifest is too large.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function isUnderPath(child: string, parent: string): boolean {
  const normalizedChild = resolve(child);
  const normalizedParent = resolve(parent);
  const path = relative(normalizedParent, normalizedChild);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function formatManifestValidationErrors(errors: readonly { readonly path: string; readonly code: string; readonly message: string }[]): string {
  return errors.slice(0, 6).map((error) => `${error.path} ${error.code}: ${error.message}`).join("; ");
}

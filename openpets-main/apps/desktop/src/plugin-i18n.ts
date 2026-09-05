// Plugin-level i18n: loads each plugin's `locales/<locale>.json` catalogs and
// resolves both host-rendered `$t:` manifest references (at display time) and
// the runtime `ctx.t(key, vars?)` helper plugins compose strings with. Reuses
// the host i18n primitives so plugin translations track the active host locale.
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { getActiveLocale } from "./i18n/index.js";
import { interpolate, SUPPORTED_LOCALES, type Locale } from "./i18n/catalog.js";

/** Literal prefix marking a host-resolved translation reference: `$t:`. */
const PLUGIN_TEXT_PREFIX = "$t:";

/** Per-locale size cap mirroring the bounded manifest reader convention. */
const maxPluginLocaleBytes = 256 * 1024;

export type PluginLocaleCatalogs = Partial<Record<Locale, Record<string, string>>>;

const registry = new Map<string, PluginLocaleCatalogs>();
const pendingLoads = new Map<string, Promise<void>>();

async function readBoundedUtf8(path: string, maxBytes: number): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(path, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) throw new Error("Plugin locale file is too large.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function asFlatStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val !== "string") return undefined;
    out[key] = val;
  }
  return out;
}

/**
 * Read `locales/<locale>.json` for each supported locale from the plugin's
 * install directory. Each file must be a flat `string -> string` object; missing
 * or invalid files are skipped (only well-formed catalogs are returned).
 */
export async function loadPluginLocales(installPath: string): Promise<PluginLocaleCatalogs> {
  const catalogs: PluginLocaleCatalogs = {};
  await Promise.all(
    SUPPORTED_LOCALES.map(async (locale) => {
      const path = join(installPath, "locales", `${locale}.json`);
      try {
        const text = await readBoundedUtf8(path, maxPluginLocaleBytes);
        const parsed = asFlatStringRecord(JSON.parse(text) as unknown);
        if (parsed) catalogs[locale] = parsed;
      } catch {
        // Missing or malformed locale files are fine; fall back to other catalogs.
      }
    }),
  );
  return catalogs;
}

export function registerPluginLocales(pluginId: string, catalogs: PluginLocaleCatalogs): void {
  registry.set(pluginId, catalogs);
}

export function unregisterPluginLocales(pluginId: string): void {
  registry.delete(pluginId);
  pendingLoads.delete(pluginId);
}

/** Lazily load and register a plugin's catalogs if not already present. */
export async function ensureLoaded(pluginId: string, installPath: string): Promise<void> {
  if (registry.has(pluginId)) return;
  let pending = pendingLoads.get(pluginId);
  if (!pending) {
    pending = loadPluginLocales(installPath).then((catalogs) => {
      registry.set(pluginId, catalogs);
    }).finally(() => {
      pendingLoads.delete(pluginId);
    });
    pendingLoads.set(pluginId, pending);
  }
  await pending;
}

function lookup(pluginId: string, key: string): string | undefined {
  const catalogs = registry.get(pluginId);
  if (!catalogs) return undefined;
  return catalogs[getActiveLocale()]?.[key] ?? catalogs.en?.[key];
}

/**
 * Resolve a host-rendered static string. Returns the value unchanged unless it
 * starts with `$t:`; then strips the prefix and resolves the key against the
 * active-locale catalog -> plugin `en` catalog -> the raw key.
 */
export function resolvePluginText(pluginId: string, value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith(PLUGIN_TEXT_PREFIX)) return value;
  const key = value.slice(PLUGIN_TEXT_PREFIX.length);
  return lookup(pluginId, key) ?? key;
}

/**
 * Build the `ctx.t(key, vars?)` helper for a plugin: active-locale catalog ->
 * `en` catalog -> the raw key, then `{var}` interpolation.
 */
export function makePluginT(pluginId: string): (key: string, vars?: Record<string, string | number>) => string {
  return (key, vars) => interpolate(lookup(pluginId, key) ?? key, vars);
}

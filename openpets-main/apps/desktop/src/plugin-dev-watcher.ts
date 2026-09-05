import { existsSync, watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { debug, error as logError, info } from "./logger.js";
import { OPENPETS_PLUGIN_MANIFEST_FILENAME } from "./plugin-manifest.js";
import type { PluginService } from "./plugin-service.js";

/**
 * Dev hot reload (§18.3): watch the dev plugin roots/paths, and on save
 * re-snapshot + reload only the changed plugin — preserving enabled state,
 * storage, and approved permissions (loadLocalPath already keeps all three
 * when the approval set is unchanged). Sub-second edit→see-it loop.
 */

const debounceMs = 350;

export type DevPluginWatcher = { readonly addPaths: (paths: readonly string[]) => void; readonly removePath: (path: string) => void; readonly stop: () => void };

export function startDevPluginWatcher(service: PluginService, roots: readonly string[], paths: readonly string[]): DevPluginWatcher {
  const watchers: FSWatcher[] = [];
  const pathWatchers = new Map<string, FSWatcher>();
  const pending = new Map<string, NodeJS.Timeout>();

  const scheduleReload = (sourceFolder: string): void => {
    const existing = pending.get(sourceFolder);
    if (existing) clearTimeout(existing);
    pending.set(sourceFolder, setTimeout(() => {
      pending.delete(sourceFolder);
      if (!existsSync(join(sourceFolder, OPENPETS_PLUGIN_MANIFEST_FILENAME))) return;
      info("plugin", "dev hot reload", { sourceFolder });
      void service.loadLocalPath(sourceFolder, { autoApprove: true }).then((result) => {
        if (!result.ok) logError("plugin", "dev hot reload failed", new Error(result.error));
      });
    }, debounceMs));
  };

  const watchPluginFolder = (folder: string): void => {
    if (pathWatchers.has(folder)) return;
    try {
      const watcher = watch(folder, { persistent: false }, () => scheduleReload(folder));
      watcher.on("error", () => undefined);
      pathWatchers.set(folder, watcher);
    } catch (error) {
      debug("plugin", "dev watch failed", { folder, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const addPaths = (nextPaths: readonly string[]): void => {
    for (const path of nextPaths) watchPluginFolder(path);
  };

  const removePath = (path: string): void => {
    const watcher = pathWatchers.get(path);
    if (!watcher) return;
    watcher.close();
    pathWatchers.delete(path);
    const timer = pending.get(path);
    if (timer) clearTimeout(timer);
    pending.delete(path);
  };

  addPaths(paths);

  for (const root of roots) {
    void fs.readdir(root, { withFileTypes: true }).then((entries) => {
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) watchPluginFolder(join(root, entry.name));
      }
    }).catch(() => undefined);
    try {
      // Pick up newly created plugin folders under a watched root.
      const rootWatcher = watch(root, { persistent: false }, (_event, fileName) => {
        if (!fileName) return;
        const candidate = join(root, String(fileName));
        if (existsSync(join(candidate, OPENPETS_PLUGIN_MANIFEST_FILENAME))) {
          watchPluginFolder(candidate);
          scheduleReload(candidate);
        }
      });
      rootWatcher.on("error", () => undefined);
      watchers.push(rootWatcher);
    } catch (error) {
      debug("plugin", "dev root watch failed", { root, error: error instanceof Error ? error.message : String(error) });
    }
  }

  info("plugin", "dev plugin watcher started", { roots: roots.length, paths: paths.length });
  return { addPaths, removePath, stop: () => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const watcher of pathWatchers.values()) watcher.close();
    pathWatchers.clear();
    for (const watcher of watchers) watcher.close();
  } };
}

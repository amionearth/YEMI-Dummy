import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, session, type IpcMainEvent } from "electron";

import { debug, info, warn } from "./logger.js";
import { logPluginDiagnostic, truncatePluginConsoleMessage } from "./plugin-diagnostics.js";
import { isUnderPath } from "./plugin-manifest-reader.js";
import type { PluginPanelHostHandle } from "./plugin-sdk-bridge.js";

/**
 * Sandboxed plugin panels (§7.2): the plugin ships its own HTML/CSS/JS, loaded
 * in a dedicated BrowserWindow that reuses the plugin-host sandbox posture —
 * contextIsolation, sandbox, no node, a unique non-persistent session, and a
 * request filter restricted to files inside the plugin's install directory.
 * The page talks to its plugin only through the clone-safe message channel
 * exposed by `panel-preload.cjs`.
 */

export type OpenPluginPanelOptions = {
  readonly pluginId: string;
  readonly installPath: string;
  readonly panelPath: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly onMessage: (msg: unknown) => void;
  readonly onClosed: () => void;
};

const maxPanelMessageBytes = 64 * 1024;

export async function openPluginPanel(options: OpenPluginPanelOptions): Promise<PluginPanelHostHandle> {
  const realInstall = await fs.realpath(options.installPath);
  const realPanel = await fs.realpath(options.panelPath);
  const panelLabel = basename(realPanel);
  if (!isUnderPath(realPanel, realInstall)) throw new Error("Plugin panel page is outside the plugin install directory.");
  const panelStat = await fs.lstat(realPanel);
  if (!panelStat.isFile()) throw new Error("Plugin panel page is not a file.");

  const token = randomBytes(16).toString("hex");
  const channel = `openpets:plugin-panel:${token}`;
  const partition = `openpets-panel:${encodeURIComponent(options.pluginId)}:${Date.now()}`;
  const panelSession = session.fromPartition(partition, { cache: false });
  panelSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  panelSession.setPermissionCheckHandler(() => false);
  const allowedRoot = pathToFileURL(realInstall).toString();
  panelSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === "about:blank" || (details.url.startsWith("file://") && (details.url === allowedRoot || details.url.startsWith(`${allowedRoot.endsWith("/") ? allowedRoot : `${allowedRoot}/`}`)));
    if (!allowed) logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel request blocked", { pluginId: options.pluginId, panelId: token, reason: "outside-install", host: safeHost(details.url) });
    callback({ cancel: !allowed });
  });

  const window = new BrowserWindow({
    title: options.title ?? "OpenPets plugin",
    width: options.width ?? 420,
    height: options.height ?? 480,
    show: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition,
      preload: `${app.getAppPath()}/panel-preload.cjs`,
      additionalArguments: [`--openpets-panel-token=${token}`],
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel navigation blocked", { pluginId: options.pluginId, panelId: token, host: safeHost(url) }); event.preventDefault(); });
  window.webContents.on("will-redirect", (event, url) => { logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel redirect blocked", { pluginId: options.pluginId, panelId: token, host: safeHost(url) }); event.preventDefault(); });
  window.webContents.on("did-fail-load", (_event, _code, description) => logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel load failed", { pluginId: options.pluginId, panelId: token, source: panelLabel, reason: description }));
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => logPluginDiagnostic(panelDiagnosticLogger, level >= 2 ? "warn" : "debug", "plugin panel console", { pluginId: options.pluginId, panelId: token, level, line, source: sourceId, reason: truncatePluginConsoleMessage(message) }));
  window.webContents.on("render-process-gone", (_event, details) => logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel renderer gone", { pluginId: options.pluginId, panelId: token, reason: details.reason }));
  panelSession.on("will-download", (event) => { logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel download blocked", { pluginId: options.pluginId, panelId: token }); event.preventDefault(); });

  const handleToPlugin = (event: IpcMainEvent, msg: unknown): void => {
    if (event.sender !== window.webContents) return;
    try {
      const text = JSON.stringify(msg ?? null);
      const sizeBytes = text === undefined ? 0 : Buffer.byteLength(text);
      if (text !== undefined && sizeBytes <= maxPanelMessageBytes) options.onMessage(JSON.parse(text));
      else logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel message dropped", { pluginId: options.pluginId, panelId: token, reason: "too-large", sizeBytes });
    } catch { logPluginDiagnostic(panelDiagnosticLogger, "warn", "plugin panel message dropped", { pluginId: options.pluginId, panelId: token, reason: "not-clone-safe" }); }
  };
  const handleCloseRequest = (event: IpcMainEvent): void => {
    if (event.sender !== window.webContents) return;
    if (!window.isDestroyed()) window.close();
  };
  ipcMain.on(`${channel}:to-plugin`, handleToPlugin);
  ipcMain.on(`${channel}:close`, handleCloseRequest);
  window.once("closed", () => {
    ipcMain.off(`${channel}:to-plugin`, handleToPlugin);
    ipcMain.off(`${channel}:close`, handleCloseRequest);
    void panelSession.clearStorageData().catch(() => undefined);
    options.onClosed();
  });

  debug("plugin", "panel loading", { pluginId: options.pluginId, panel: panelLabel });
  await window.loadFile(realPanel);
  window.show();
  info("plugin", "panel opened", { pluginId: options.pluginId });

  return {
    id: token,
    show: async () => { if (!window.isDestroyed()) window.show(); },
    hide: async () => { if (!window.isDestroyed()) window.hide(); },
    postMessage: async (msg) => { if (!window.isDestroyed()) window.webContents.send(`${channel}:message`, msg); },
    close: async () => { if (!window.isDestroyed()) window.close(); },
  };
}

function safeHost(urlText: string): string | undefined { try { return new URL(urlText).hostname || undefined; } catch { return undefined; } }
function panelDiagnosticLogger(level: "debug" | "info" | "warn" | "error", message: string, fields?: Record<string, unknown>): void {
  if (level === "warn") warn("plugin", message, fields);
  else if (level === "info") info("plugin", message, fields);
  else debug("plugin", message, fields);
}

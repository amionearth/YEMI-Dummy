import { EventEmitter } from "node:events";

import { net, powerMonitor, screen } from "electron";

import { buildAgentActivityPayload } from "./agent-activity-payload.js";
import { debug } from "./logger.js";

/**
 * The senses bus host source (§3): a curated, read-only event stream fed by
 * the pet windows, powerMonitor, screen, and small pollers. Plugins subscribe
 * through the SDK bridge; the bridge enforces the permission and the bounded
 * event-name set. Hard privacy line (§3.1): nothing here ever carries
 * keystrokes, screen contents, other apps' window titles, or clipboard data.
 */

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let started = false;
let idleTimer: NodeJS.Timeout | null = null;
let dayPartTimer: NodeJS.Timeout | null = null;
let onlineTimer: NodeJS.Timeout | null = null;
let userIsIdle = false;
let lastOnline: boolean | null = null;
let lastDayPart: string | null = null;

const idleThresholdSeconds = 120;
const idlePollMs = 15_000;
const onlinePollMs = 30_000;

export type PluginEventHandler = (payload: Record<string, unknown>) => void;

/** Subscribe to a curated event. Returns an unsubscribe function. */
export function subscribePluginEvent(event: string, handler: PluginEventHandler): () => void {
  emitter.on(event, handler);
  return () => emitter.off(event, handler);
}

/** Emit an event into the bus (host-internal producers only). */
export function emitPluginEvent(event: string, payload: Record<string, unknown>): void {
  try { emitter.emit(event, payload); } catch { /* subscriber errors are isolated upstream */ }
}

const petWindowEventNames = new Set(["pet:clicked", "pet:doubleClicked", "pet:dragStart", "pet:dragEnd", "pet:hover", "pet:drop"]);
let nextDropFileId = 0;
const droppedFileTexts = new Map<string, { text: string; expiresAt: number }>();

/** Read a dropped file's cached text (one-shot accessor backing, §13.7). */
export function readDroppedFileText(fileId: string): string | undefined {
  const entry = droppedFileTexts.get(fileId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { droppedFileTexts.delete(fileId); return undefined; }
  return entry.text;
}

/** Pet windows publish their senses through this (clicks, hovers, drops). */
export function publishPluginPetEvent(petId: string, name: string, payload: Record<string, unknown>): void {
  if (!petWindowEventNames.has(name)) return;
  if (name === "pet:drop") {
    const kind = payload.kind === "files" ? "files" : "text";
    if (kind === "text") {
      const text = typeof payload.text === "string" ? payload.text.slice(0, 256 * 1024) : "";
      if (!text) return;
      emitPluginEvent("pet:drop", { kind: "text", text, petId });
      return;
    }
    const dropped = Array.isArray(payload.droppedFiles) ? payload.droppedFiles.slice(0, 4) : [];
    const files = dropped.flatMap((file) => {
      if (typeof file !== "object" || file === null) return [];
      const record = file as Record<string, unknown>;
      const fileId = `drop-${++nextDropFileId}`;
      const text = typeof record.text === "string" ? record.text.slice(0, 5 * 1024 * 1024) : "";
      droppedFileTexts.set(fileId, { text, expiresAt: Date.now() + 10 * 60_000 });
      return [{ fileId, name: typeof record.name === "string" ? record.name.slice(0, 200) : "file", sizeBytes: Number(record.sizeBytes) || text.length }];
    });
    if (files.length === 0) return;
    emitPluginEvent("pet:drop", { kind: "files", files, petId });
    return;
  }
  emitPluginEvent(name, { petId });
}

function currentDayPart(date = new Date()): "morning" | "afternoon" | "evening" | "night" {
  const hour = date.getHours();
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

/** Start the host-side event producers. Idempotent; call once from main. */
export function startPluginEventSources(): void {
  if (started) return;
  started = true;
  debug("plugin", "event sources starting");

  powerMonitor.on("lock-screen", () => emitPluginEvent("screen:locked", {}));
  powerMonitor.on("unlock-screen", () => emitPluginEvent("screen:unlocked", {}));
  powerMonitor.on("on-battery", () => emitPluginEvent("power:charging", { charging: false }));
  powerMonitor.on("on-ac", () => emitPluginEvent("power:charging", { charging: true }));
  powerMonitor.on("suspend", () => { userIsIdle = true; });
  powerMonitor.on("resume", () => { userIsIdle = false; });

  const displayChanged = () => emitPluginEvent("display:changed", { displays: screen.getAllDisplays().length });
  screen.on("display-added", displayChanged);
  screen.on("display-removed", displayChanged);
  screen.on("display-metrics-changed", displayChanged);

  idleTimer = setInterval(() => {
    try {
      const idleSeconds = powerMonitor.getSystemIdleTime();
      if (!userIsIdle && idleSeconds >= idleThresholdSeconds) {
        userIsIdle = true;
        emitPluginEvent("idle:enter", { idleSeconds });
      } else if (userIsIdle && idleSeconds < idleThresholdSeconds) {
        userIsIdle = false;
        emitPluginEvent("idle:exit", { idleSeconds });
      }
    } catch { /* idle probing is best-effort */ }
  }, idlePollMs);
  idleTimer.unref?.();

  lastDayPart = currentDayPart();
  dayPartTimer = setInterval(() => {
    const part = currentDayPart();
    if (part !== lastDayPart) {
      lastDayPart = part;
      emitPluginEvent("day:partChanged", { part });
    }
  }, 60_000);
  dayPartTimer.unref?.();

  lastOnline = net.online;
  onlineTimer = setInterval(() => {
    const online = net.online;
    if (lastOnline !== null && online !== lastOnline) emitPluginEvent(online ? "online" : "offline", {});
    lastOnline = online;
  }, onlinePollMs);
  onlineTimer.unref?.();
}

export function stopPluginEventSources(): void {
  if (idleTimer) clearInterval(idleTimer);
  if (dayPartTimer) clearInterval(dayPartTimer);
  if (onlineTimer) clearInterval(onlineTimer);
  idleTimer = dayPartTimer = onlineTimer = null;
  started = false;
}

/** Agent reaction/speech activity mirror (`agent:activity`). */
export function publishPluginAgentActivity(activity: { readonly kind: string; readonly reaction?: string; readonly petId?: string; readonly surface?: "default" | "agent" }): void {
  emitPluginEvent("agent:activity", buildAgentActivityPayload(activity) as unknown as Record<string, unknown>);
}

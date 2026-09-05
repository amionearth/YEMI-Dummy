import { basename, extname } from "node:path";

import type { PluginLogLevel, PluginRuntimeLogger } from "./plugin-sdk-bridge.js";

export type PluginDiagnosticsFields = Record<string, unknown>;

const allowedKeys = new Set(["pluginId", "runtime", "route", "operation", "phase", "reason", "errorCode", "durationMs", "sizeBytes", "status", "subscriberCount", "scheduleId", "eventName", "topic", "method", "host", "panelId", "commandId", "menuItemId", "bubbleId", "kind", "level", "line", "source", "basename", "ext", "ok", "canceled", "count", "skipped", "sourceBasename", "provider", "model", "keyHash", "keyLength"]);

export function sanitizePluginDiagnosticsFields(fields: PluginDiagnosticsFields = {}): PluginDiagnosticsFields {
  const safe: PluginDiagnosticsFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowedKeys.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "number") { if (Number.isFinite(value)) safe[key] = Math.round(value); continue; }
    if (typeof value === "boolean") { safe[key] = value; continue; }
    const text = String(value);
    if (key === "host" || key === "method" || key === "runtime" || key === "phase" || key === "route" || key === "operation" || key === "kind" || key === "level") safe[key] = text.slice(0, 80);
    else if (key === "source" || key === "basename" || key === "sourceBasename") safe[key] = basename(text).slice(0, 120);
    else if (key === "ext") safe[key] = extname(text) || text.slice(0, 16);
    else safe[key] = redactPluginDiagnosticText(text).slice(0, 180);
  }
  return safe;
}

export function redactPluginDiagnosticText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, (raw) => { try { const url = new URL(raw); return `${url.protocol}//${url.hostname}${url.pathname ? "/…" : ""}`; } catch { return "[url]"; } })
    .replace(/(?:[A-Za-z]:\\|\/)[^\s)'"]+/g, (raw) => basename(raw) || "[path]")
    .replace(/\b(?:token|secret|password|api[_-]?key)=([^\s&]+)/gi, "[redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted]");
}

export function truncatePluginConsoleMessage(value: unknown): string {
  return redactPluginDiagnosticText(String(value ?? "").replace(/[\0-\x08\x0B\x0C\x0E-\x1F]/g, " ")).slice(0, 500);
}

export function classifyPluginError(error: unknown): "permission" | "quota" | "validation" | "network" | "host" | "callback" | "unknown" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/permission|not approved|denied/i.test(message)) return "permission";
  if (/quota|too many|rate/i.test(message)) return "quota";
  if (/invalid|validation|must|unsupported/i.test(message)) return "validation";
  if (/http|network|fetch|host|url|redirect|timed out|dns|status/i.test(message)) return "network";
  if (/callback|handler/i.test(message)) return "callback";
  if (/unavailable|renderer|window|panel|host/i.test(message)) return "host";
  return "unknown";
}

export function logPluginDiagnostic(logger: PluginRuntimeLogger | undefined, level: PluginLogLevel, message: string, fields?: PluginDiagnosticsFields): void {
  logger?.(level, message, sanitizePluginDiagnosticsFields(fields));
}

export async function withPluginDiagnostic<T>(logger: PluginRuntimeLogger | undefined, level: PluginLogLevel, message: string, fields: PluginDiagnosticsFields, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    logPluginDiagnostic(logger, level, message, { ...fields, phase: "success", durationMs: Date.now() - started, ok: true });
    return result;
  } catch (error) {
    logPluginDiagnostic(logger, "warn", message, { ...fields, phase: "fail", ok: false, durationMs: Date.now() - started, reason: error instanceof Error ? error.message : String(error), errorCode: classifyPluginError(error) });
    throw error;
  }
}

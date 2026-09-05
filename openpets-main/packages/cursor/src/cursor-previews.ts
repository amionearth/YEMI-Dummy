import type { CursorMcpEntry, CursorMcpPreviewOptions } from "./cursor-mcp.js";
import { buildCursorMcpEntry } from "./cursor-mcp.js";

export interface RedactedPreview {
  readonly openpets?: CursorMcpEntry;
  readonly redactedFields?: readonly string[];
}

export interface FullRedactedConfig {
  readonly mcpServers?: {
    readonly openpets?: CursorMcpEntry | Record<string, unknown>;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

const sensitiveKeys = [
  "env",
  "headers",
  "auth",
  "authorization",
  "token",
  "secret",
  "password",
  "credentials",
];

const sensitivePatterns = [
  /token=/i,
  /api[_-]?key=/i,
  /secret=/i,
  /password=/i,
  /auth=/i,
];

export function buildOpenPetsOnlyPreview(options: CursorMcpPreviewOptions): RedactedPreview {
  return { openpets: buildCursorMcpEntry(options) };
}

export function redactCursorConfig(config: Record<string, unknown>): FullRedactedConfig {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (key === "mcpServers" && isRecord(value)) {
      result[key] = redactMcpServers(value);
    } else {
      result[key] = redactValue(value);
    }
  }

  return result;
}

function redactMcpServers(mcpServers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(mcpServers)) {
    if (isRecord(value)) {
      result[key] = redactMcpEntry(value);
    } else {
      result[key] = redactValue(value);
    }
  }

  return result;
}

function redactMcpEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entry)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      result[key] = "[REDACTED]";
    } else if (key === "args" && Array.isArray(value)) {
      result[key] = value.map((arg) => {
        if (typeof arg !== "string") return arg;
        return redactStringValue(arg);
      });
    } else if (typeof value === "string") {
      result[key] = redactStringValue(value);
    } else if (isRecord(value)) {
      result[key] = redactMcpEntry(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => (isRecord(item) ? redactMcpEntry(item) : redactValue(item)));
    } else {
      result[key] = value;
    }
  }

  return result;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactStringValue(value);
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactValue(val);
      }
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  return value;
}

function redactStringValue(value: string): string {
  if (value.length > 1000) return "[REDACTED-LONG-STRING]";

  for (const pattern of sensitivePatterns) {
    if (pattern.test(value)) {
      return value.replace(/[=:][^&\s]*/g, "=[REDACTED]");
    }
  }

  if (value.includes("?")) {
    const urlMatch = value.match(/^https?:\/\/[^\s]+$/);
    if (urlMatch) {
      return redactUrlParams(value);
    }
  }

  return value;
}

function redactUrlParams(url: string): string {
  try {
    const urlObj = new URL(url);
    let hasSensitive = false;

    for (const [key] of urlObj.searchParams) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk)) || sensitivePatterns.some((p) => p.test(`${key}=`))) {
        hasSensitive = true;
        urlObj.searchParams.set(key, "[REDACTED]");
      }
    }

    return hasSensitive ? urlObj.toString() : url;
  } catch {
    return url;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

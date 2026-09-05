import { isAbsolute, join } from "node:path";

export const cursorMcpServerName = "openpets";
export const openPetsMcpPackageName = "@open-pets/mcp";
export type CursorCommandMode = "published" | "local" | "bundled";

export interface CursorMcpEntry {
  readonly type: "stdio";
  readonly command: string;
  readonly args: readonly string[];
}

export interface CursorMcpConfig {
  readonly mcpServers?: {
    readonly openpets?: CursorMcpEntry | unknown;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface CursorMcpPreviewOptions {
  readonly mcpVersion: string;
  readonly petId?: string;
  readonly commandMode?: CursorCommandMode;
  readonly mcpEntryPath?: string;
}

export function validateOpenPetsPetId(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length < 1) throw new Error("Invalid OpenPets pet id.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(trimmed)) throw new Error("Invalid OpenPets pet id.");
  return trimmed;
}

export function isValidPetId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

export function buildCursorMcpEntry(options: CursorMcpPreviewOptions): CursorMcpEntry {
  const petArgs = options.petId === undefined ? [] : ["--pet", validateOpenPetsPetId(options.petId)];
  const mode = options.commandMode ?? "published";
  if (mode === "local" || mode === "bundled") {
    if (!options.mcpEntryPath || !isAbsolute(options.mcpEntryPath)) {
      throw new Error("Cursor local MCP preview requires an absolute MCP entry path.");
    }
    return { type: "stdio", command: "node", args: [options.mcpEntryPath, ...petArgs] };
  }
  validateOpenPetsPackageVersion(options.mcpVersion);
  return { type: "stdio", command: "npx", args: ["-y", `${openPetsMcpPackageName}@${options.mcpVersion}`, ...petArgs] };
}

export function validateOpenPetsPackageVersion(value: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(value)) {
    throw new Error("Invalid OpenPets package version.");
  }
  return value;
}

export function formatCursorMcpConfig(options: CursorMcpPreviewOptions): CursorMcpConfig {
  return { mcpServers: { [cursorMcpServerName]: buildCursorMcpEntry(options) } };
}

export function getCursorGlobalMcpPath(homeDir: string): string {
  return join(homeDir, ".cursor", "mcp.json");
}

export function getCursorProjectMcpPath(projectDir: string): string {
  return join(projectDir, ".cursor", "mcp.json");
}

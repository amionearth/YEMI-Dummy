import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { lstatSync, realpathSync, statSync } from "node:fs";

export const claudeMcpServerName = "openpets";
export const openPetsMcpPackageName = "@open-pets/mcp";
export type OpenPetsCommandMode = "published" | "local" | "bundled";

export type ClaudeMcpScope = "user";

export interface ClaudeCommandSpec {
  readonly command: string;
  readonly args: readonly string[];
}

export interface ClaudeMcpPreview {
  readonly commandMode: OpenPetsCommandMode;
  readonly add: ClaudeCommandSpec;
  readonly remove: ClaudeCommandSpec;
  readonly mcpJson: {
    readonly mcpServers: {
      readonly openpets: {
        readonly type: "stdio";
        readonly command: string;
        readonly args: readonly string[];
      };
    };
  };
  readonly displayCommand: string;
}

export interface ParsedClaudeMcpEntry {
  readonly present: boolean;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly source: "none" | "list" | "get";
  readonly verified: boolean;
  readonly matchesExpected: boolean;
}

export function buildClaudeMcpPreview(selectedPetId?: string, commandMode: OpenPetsCommandMode = "published", nodeCommand = "node"): ClaudeMcpPreview {
  const server = buildOpenPetsMcpServerCommand(selectedPetId, commandMode, nodeCommand);
  const addArgs = ["mcp", "add", "--scope", "user", claudeMcpServerName, "--", server.command, ...server.args] as const;
  const removeArgs = ["mcp", "remove", "--scope", "user", claudeMcpServerName] as const;
  const add: ClaudeCommandSpec = { command: "claude", args: addArgs };

  return {
    commandMode,
    add,
    remove: { command: "claude", args: removeArgs },
    mcpJson: {
      mcpServers: {
        openpets: {
          type: "stdio",
          command: server.command,
          args: server.args,
        },
      },
    },
    displayCommand: formatCommandForDisplay(add),
  };
}

export function buildOpenPetsMcpArgs(selectedPetId?: string): readonly string[] {
  if (selectedPetId === undefined) return ["-y", openPetsMcpPackageName];
  validateOpenPetsPetArg(selectedPetId);
  return ["-y", openPetsMcpPackageName, "--pet", selectedPetId];
}

export function buildOpenPetsMcpServerCommand(selectedPetId?: string, commandMode: OpenPetsCommandMode = "published", nodeCommand = "node"): { readonly command: string; readonly args: readonly string[] } {
  if (commandMode === "local" || commandMode === "bundled") {
    const entryPath = commandMode === "bundled" ? getBundledMcpEntryPath() : getLocalMcpEntryPath();
    commandMode === "bundled" ? assertBundledMcpEntryPath() : assertLocalMcpEntryPath();
    if (selectedPetId === undefined) return { command: nodeCommand, args: [entryPath] };
    validateOpenPetsPetArg(selectedPetId);
    return { command: nodeCommand, args: [entryPath, "--pet", selectedPetId] };
  }
  return { command: "npx", args: buildOpenPetsMcpArgs(selectedPetId) };
}

export function assertLocalMcpEntryPath(): void {
  assertSafeLocalDistFile(getLocalMcpEntryPath(), "MCP entry");
}

export function getLocalMcpEntryPath(): string {
  return getSiblingMcpEntryPath();
}

export function getBundledMcpEntryPath(): string {
  return mapAsarPathToUnpacked(getSiblingMcpEntryPath());
}

export function mapAsarPathToUnpacked(path: string): string {
  return path.replace(/(^|[\\/])app\.asar(?=$|[\\/])/, "$1app.asar.unpacked");
}

function getSiblingMcpEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "mcp", "dist", "index.js");
}

export function assertBundledMcpEntryPath(): void {
  assertSafeBundledDistFile(getBundledMcpEntryPath(), "MCP entry");
}

export function buildClaudeMcpGetCommand(): ClaudeCommandSpec {
  return { command: "claude", args: ["mcp", "get", claudeMcpServerName] };
}

export function validateOpenPetsPetArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length < 1) throw new Error("Invalid OpenPets pet id.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(trimmed)) throw new Error("Invalid OpenPets pet id.");
  return trimmed;
}

export function parseClaudeMcpListOutput(output: string): ParsedClaudeMcpEntry {
  const normalized = output.toLowerCase();
  const present = /(^|\s|[•*-])openpets(\s|$|:|-)/m.test(normalized) || normalized.includes("openpets:");
  return {
    present,
    source: present ? "list" : "none",
    verified: false,
    matchesExpected: false,
  };
}

export function parseClaudeMcpGetOutput(output: string, expectedPetId?: string, commandMode: OpenPetsCommandMode = "published", nodeCommand = "node"): ParsedClaudeMcpEntry {
  const text = output.trim();
  if (!text) return { present: false, source: "none", verified: false, matchesExpected: false };

  const parsed = tryParseJson(text);
  const expected = buildOpenPetsMcpServerCommand(expectedPetId, commandMode, nodeCommand);
  const jsonEntry = parsed ? extractJsonEntry(parsed) : null;
  if (jsonEntry) {
    const matchesExpected = jsonEntry.command === expected.command && arraysEqual(jsonEntry.args, expected.args);
    return { present: true, command: jsonEntry.command, args: jsonEntry.args, source: "get", verified: true, matchesExpected };
  }

  const command = extractTextCommand(text);
  const args = extractTextArgs(text);
  if (command && args) {
    const matchesExpected = command === expected.command && arraysEqual(args, expected.args);
    return { present: true, command, args, source: "get", verified: true, matchesExpected };
  }

  if (/openpets/i.test(text) || /@open-pets\/mcp/i.test(text)) {
    return { present: true, source: "get", verified: false, matchesExpected: false };
  }

  return { present: false, source: "none", verified: false, matchesExpected: false };
}

export function classifyClaudeMcpStatus(listOutput: string, getOutput: string | undefined, expectedPetId?: string, commandMode: OpenPetsCommandMode = "published", nodeCommand = "node"): ParsedClaudeMcpEntry {
  if (getOutput) {
    const parsedGet = parseClaudeMcpGetOutput(getOutput, expectedPetId, commandMode, nodeCommand);
    if (parsedGet.present) return parsedGet;
  }
  return parseClaudeMcpListOutput(listOutput);
}

export function formatCommandForDisplay(spec: ClaudeCommandSpec): string {
  return [spec.command, ...spec.args].map(quoteArg).join(" ");
}

function quoteArg(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (/[\r\n"]/.test(value) || value.includes("\0")) throw new Error("Command argument contains unsupported shell characters.");
  return `"${value.replaceAll("\\", "\\\\").replaceAll("$", "\\$").replaceAll("`", "\\`")}"`;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractJsonEntry(value: unknown): { readonly command: string; readonly args: readonly string[] } | null {
  const record = isRecord(value) ? value : null;
  const maybeEntry = record && isRecord(record.mcpServers) && isRecord(record.mcpServers.openpets)
    ? record.mcpServers.openpets
    : record;

  if (!isRecord(maybeEntry) || typeof maybeEntry.command !== "string" || !Array.isArray(maybeEntry.args)) return null;
  if (!maybeEntry.args.every((arg) => typeof arg === "string")) return null;
  return { command: maybeEntry.command, args: maybeEntry.args as string[] };
}

function extractTextCommand(value: string): string | undefined {
  const match = value.match(/(?:^|\n)\s*Command\s*:\s*([^\s\n]+)/i) ?? value.match(/(?:^|\n)\s*command\s+([^\s\n]+)/i);
  return match?.[1];
}

function extractTextArgs(value: string): readonly string[] | undefined {
  const jsonArgs = value.match(/(?:^|\n)\s*Args\s*:\s*(\[[^\n]+\])/i);
  if (jsonArgs?.[1]) {
    const parsed = tryParseJson(jsonArgs[1]);
    if (Array.isArray(parsed) && parsed.every((arg) => typeof arg === "string")) return parsed as string[];
  }

  const textArgs = value.match(/(?:^|\n)\s*Args\s*:\s*(.+)$/im);
  if (!textArgs?.[1]) return undefined;
  return splitSimpleArgs(textArgs[1]);
}

function splitSimpleArgs(value: string): readonly string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertSafeLocalDistFile(path: string, label: string): void {
  const expectedPrefix = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (!path.startsWith(expectedPrefix)) throw new Error(`Local ${label} path is outside the OpenPets workspace.`);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Local ${label} path is not a regular file.`);
}

function assertSafeBundledDistFile(path: string, label: string): void {
  if (isTrueAsarPath(path)) throw new Error(`Bundled ${label} path must be unpacked outside app.asar.`);
  if (path.includes("\n") || path.includes("\r") || path.includes("\0")) throw new Error(`Bundled ${label} path contains unsupported characters.`);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`Bundled ${label} path must not be a symlink.`);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Bundled ${label} path is not a regular file.`);
  const expectedRoot = realpathSync(mapAsarPathToUnpacked(join(dirname(fileURLToPath(import.meta.url)), "..", "..")));
  const realPath = realpathSync(path);
  const rel = relative(expectedRoot, realPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Bundled ${label} path is outside the packaged OpenPets resources.`);
}

function isTrueAsarPath(path: string): boolean {
  return /app\.asar(?:$|[\\/])/.test(path) && !/app\.asar\.unpacked(?:$|[\\/])/.test(path);
}

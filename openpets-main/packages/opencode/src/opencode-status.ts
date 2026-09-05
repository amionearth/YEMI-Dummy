import { buildOpenCodeInstructionPath, buildOpenCodeMcpEntry, buildOpenCodePluginPreview, openCodeMcpServerName, type OpenCodePreviewOptions } from "./opencode-previews.js";

export type OpenCodeEntryStatus = "not_installed" | "installed" | "needs_update" | "custom" | "conflict" | "error";

export interface OpenCodeStatusResult {
  readonly status: OpenCodeEntryStatus;
  readonly message: string;
  readonly matches: readonly string[];
}

export function classifyOpenCodeMcpStatus(configs: readonly Record<string, unknown>[], expected: OpenCodePreviewOptions): OpenCodeStatusResult {
  const entries = configs.flatMap((config, index) => {
    const mcp = isRecord(config.mcp) ? config.mcp : undefined;
    const entry = mcp?.[openCodeMcpServerName];
    return entry === undefined ? [] : [{ source: String(index), entry }];
  });
  if (entries.length === 0) return { status: "not_installed", message: "OpenCode OpenPets MCP is not installed.", matches: [] };
  const expectedEntry = buildOpenCodeMcpEntry(expected);
  const current = entries.filter(({ entry }) => isSameMcpEntry(entry, expectedEntry));
  const managed = entries.filter(({ entry }) => isManagedOpenPetsMcpEntry(entry, expectedEntry.command));
  if (current.length === 1 && entries.length === 1) return { status: "installed", message: "OpenCode OpenPets MCP is installed.", matches: [entries[0]?.source ?? "0"] };
  if (current.length > 0 || managed.length > 0) return { status: entries.length > 1 ? "conflict" : "needs_update", message: "OpenCode OpenPets MCP needs update.", matches: entries.map((entry) => entry.source) };
  return { status: "custom", message: "OpenCode has a custom openpets MCP entry.", matches: entries.map((entry) => entry.source) };
}

export function classifyOpenCodeInstructionsStatus(configs: readonly Record<string, unknown>[], scope: "project" | "global", configDir?: string, instructionFiles: Record<string, string> = {}): OpenCodeStatusResult {
  const expected = buildOpenCodeInstructionPath(scope, configDir);
  const allEntries = configs.flatMap((config, index) => Array.isArray(config.instructions) ? config.instructions.filter((entry): entry is string => typeof entry === "string" && isOpenPetsLikeInstruction(entry)).map((entry) => ({ source: String(index), entry })) : []);
  const managedEntries = allEntries.filter(({ entry }) => entry === expected);
  const customEntries = allEntries.filter(({ entry }) => entry !== expected);
  if (allEntries.length === 0) return { status: "not_installed", message: "OpenCode OpenPets instructions are not installed.", matches: [] };
  if (managedEntries.length > 1 || (managedEntries.length > 0 && customEntries.length > 0)) return { status: "conflict", message: "OpenCode has conflicting OpenPets instruction entries.", matches: allEntries.map((entry) => entry.source) };
  if (managedEntries.length === 1 && hasManagedInstructionBlock(instructionFiles[expected])) return { status: "installed", message: "OpenCode OpenPets instructions are installed.", matches: managedEntries.map((entry) => entry.source) };
  if (managedEntries.length === 1) return { status: "needs_update", message: "OpenCode OpenPets instruction file needs managed block.", matches: managedEntries.map((entry) => entry.source) };
  return { status: "custom", message: "OpenCode has custom OpenPets-like instruction entries.", matches: customEntries.map((entry) => entry.source) };
}

export function classifyOpenCodePluginStatus(configs: readonly Record<string, unknown>[], petId?: string, packageVersion?: string, excludeReactions?: readonly string[]): OpenCodeStatusResult {
  const expected = buildOpenCodePluginPreview({ petId, packageVersion, excludeReactions });
  const pluginEntries = configs.flatMap((config, index) => Array.isArray(config.plugin) ? config.plugin.map((entry) => ({ source: String(index), entry })) : []);
  const current = pluginEntries.filter(({ entry }) => isExpectedPlugin(entry, expected));
  const recognizable = pluginEntries.filter(({ entry }) => isManagedOpenPetsPluginEntry(entry));
  const custom = pluginEntries.filter(({ entry }) => !isManagedOpenPetsPluginEntry(entry) && isOpenPetsLikePluginEntry(entry));
  if (current.length === 1 && recognizable.length === 1 && custom.length === 0) return { status: "installed", message: "OpenCode OpenPets plugin is installed.", matches: current.map((entry) => entry.source) };
  if (recognizable.length > 0 && custom.length > 0) return { status: "conflict", message: "OpenCode has conflicting OpenPets plugin entries.", matches: [...recognizable, ...custom].map((entry) => entry.source) };
  if (recognizable.length > 0) return { status: recognizable.length > 1 ? "conflict" : "needs_update", message: "OpenCode OpenPets plugin needs update.", matches: recognizable.map((entry) => entry.source) };
  if (custom.length > 0) return { status: "custom", message: "OpenCode has custom OpenPets-like plugin entries.", matches: custom.map((entry) => entry.source) };
  return { status: "not_installed", message: "OpenCode OpenPets plugin is not installed.", matches: [] };
}

export function isManagedOpenPetsMcpEntry(value: unknown, expectedCommand?: readonly string[]): boolean {
  if (!isRecord(value) || value.type !== "local" || value.enabled !== true || !Array.isArray(value.command)) return false;
  const keys = Object.keys(value).sort();
  if (!hasManagedMcpKeys(keys) || !hasValidMcpEnvironment(value.environment)) return false;
  return isManagedOpenPetsMcpCommand(value.command, expectedCommand);
}

function isManagedOpenPetsMcpCommand(command: readonly unknown[], expectedCommand?: readonly string[]): boolean {
  if (!command.every((part) => typeof part === "string")) return false;
  const parts = command as readonly string[];
  if (expectedCommand && isSameCommand(parts, expectedCommand)) return true;
  if (expectedCommand && isExpectedNodeOpenPetsMcpCommand(parts, expectedCommand)) return true;
  return isPublishedOpenPetsMcpCommand(parts) || isNodeOpenPetsMcpCommand(parts);
}

function isExpectedNodeOpenPetsMcpCommand(command: readonly string[], expected: readonly string[]): boolean {
  return expected[0] === "node" && command.length >= 3 && command[0] === "node" && command[1] === expected[1] && command[2] === "mcp" && hasValidPetArgs(command.slice(3));
}

function isPublishedOpenPetsMcpCommand(command: readonly string[]): boolean {
  return command.length >= 4 && command[0] === "npx" && command[1] === "-y" && /^@open-pets\/cli@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(command[2] ?? "") && command[3] === "mcp" && hasValidPetArgs(command.slice(4));
}

function isNodeOpenPetsMcpCommand(command: readonly string[]): boolean {
  return command.length >= 3 && command[0] === "node" && isOpenPetsCliEntryPath(command[1] ?? "") && command[2] === "mcp" && hasValidPetArgs(command.slice(3));
}

function isOpenPetsCliEntryPath(path: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]@open-pets[\\/]cli[\\/]dist[\\/]index\.js$/u.test(path) || /(?:^|[\\/])packages[\\/]cli[\\/]dist[\\/]index\.js$/u.test(path);
}

function hasValidPetArgs(args: readonly string[]): boolean {
  if (args.length === 0) return true;
  return args.length === 2 && args[0] === "--pet" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(args[1] ?? "");
}

function isSameCommand(command: readonly string[], expected: readonly string[]): boolean {
  return command.length === expected.length && command.every((part, index) => part === expected[index]);
}

function isExpectedPlugin(value: unknown, expected: string | readonly [string, { readonly pet?: string; readonly excludeReactions?: readonly string[] }]): boolean {
  if (typeof expected === "string") return value === expected;
  return Array.isArray(value) && value.length === 2 && value[0] === expected[0] && isSamePluginOptions(value[1], expected[1]);
}

export function isManagedOpenPetsPluginEntry(value: unknown): boolean {
  if (typeof value === "string") return /^@open-pets\/opencode(?:@[^/]+)?$/.test(value);
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && /^@open-pets\/opencode(?:@[^/]+)?$/.test(value[0]) && isPetPluginOptions(value[1]);
}

export function isOpenPetsLikePluginEntry(value: unknown): boolean {
  if (typeof value === "string") return /openpets|open-pets/i.test(value);
  if (Array.isArray(value)) return value.some(isOpenPetsLikePluginEntry);
  return false;
}

function isPetPluginOptions(value: unknown): value is { readonly pet?: string; readonly excludeReactions?: readonly string[] } {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const hasPet = keys.includes("pet");
  const hasExclusions = keys.includes("excludeReactions");
  if (!hasPet && !hasExclusions) return false;
  const expectedKeyCount = (hasPet ? 1 : 0) + (hasExclusions ? 1 : 0);
  if (keys.length !== expectedKeyCount) return false;
  if (hasPet && (typeof value.pet !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.pet))) return false;
  if (!hasExclusions) return true;
  return Array.isArray(value.excludeReactions) && value.excludeReactions.length > 0 && value.excludeReactions.every((reaction: unknown) => typeof reaction === "string");
}

function isSameMcpEntry(value: unknown, expected: { readonly type: "local"; readonly command: readonly string[]; readonly enabled: true }): boolean {
  if (!isRecord(value) || value.type !== expected.type || value.enabled !== expected.enabled || !Array.isArray(value.command)) return false;
  const keys = Object.keys(value).sort();
  if (!hasManagedMcpKeys(keys) || !hasValidMcpEnvironment(value.environment)) return false;
  return value.command.length === expected.command.length && value.command.every((part, index) => part === expected.command[index]);
}

function hasManagedMcpKeys(keys: readonly string[]): boolean {
  return keys.length === 3 && keys[0] === "command" && keys[1] === "enabled" && keys[2] === "type"
    || keys.length === 4 && keys[0] === "command" && keys[1] === "enabled" && keys[2] === "environment" && keys[3] === "type";
}

function hasValidMcpEnvironment(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, envValue]) => /^[A-Z_][A-Z0-9_]*$/.test(key) && typeof envValue === "string");
}

function isSamePluginOptions(value: unknown, expected: { readonly pet?: string; readonly excludeReactions?: readonly string[] }): boolean {
  if (!isPetPluginOptions(value)) return false;
  if (value.pet !== expected.pet) return false;
  const expectedExclusions = new Set(expected.excludeReactions ?? []);
  const actualExclusions = new Set(value.excludeReactions ?? []);
  return expectedExclusions.size === actualExclusions.size && [...expectedExclusions].every((reaction) => actualExclusions.has(reaction));
}

function isOpenPetsLikeInstruction(value: string): boolean {
  return /openpets\.md$/i.test(value) || /@open-pets\/opencode/i.test(value);
}

function hasManagedInstructionBlock(value: string | undefined): boolean {
  return typeof value === "string" && /<!-- OPENPETS:START -->[\s\S]*?<!-- OPENPETS:END -->/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

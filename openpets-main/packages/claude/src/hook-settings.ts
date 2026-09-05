import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { mapAsarPathToUnpacked, validateOpenPetsPetArg, type OpenPetsCommandMode } from "./claude-code.js";

export const openPetsHookMarker = "--openpets-managed";
export const claudeHookEvents = ["UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure"] as const;

export type ClaudeHookInstallStatus = "not_installed" | "installed" | "needs_update" | "error";

export interface ClaudeHookDoctorResult {
  readonly status: ClaudeHookInstallStatus;
  readonly settingsPath: string;
  readonly exists: boolean;
  readonly valid: boolean;
  readonly message: string;
  readonly backupPath?: string;
  readonly preview: Record<string, unknown>;
  readonly asyncSupported: boolean;
}

export interface ClaudeHookWriteResult extends ClaudeHookDoctorResult {
  readonly changed: boolean;
}

export function getClaudeUserSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function createOpenPetsHookCommand(commandMode: OpenPetsCommandMode = "published", selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): string {
  const petArgs = selectedPetId === undefined ? "" : ` --pet ${shellQuote(validateOpenPetsPetArg(selectedPetId))}`;
  // An explicitly resolved CLI path (e.g. the bundled CLI inside an installed
  // OpenPets app, discovered by the external install-hooks command) always wins
  // over the package-relative bundled/local paths and the npx fallback.
  if (explicitCliPath !== undefined) {
    assertInstalledClaudeCliPath(explicitCliPath);
    return `${shellQuote(nodeCommand)} ${shellQuote(explicitCliPath)} hook ${openPetsHookMarker}${petArgs}`;
  }
  if (commandMode === "local" || commandMode === "bundled") {
    const cliPath = commandMode === "bundled" ? getBundledClaudeCliPath() : getLocalClaudeCliPath();
    commandMode === "bundled" ? assertBundledClaudeCliPath() : assertLocalClaudeCliPath();
    return `${shellQuote(nodeCommand)} ${shellQuote(cliPath)} hook ${openPetsHookMarker}${petArgs}`;
  }
  return `npx -y @open-pets/claude hook ${openPetsHookMarker}${petArgs}`;
}

// Candidate locations of an installed OpenPets desktop app's bundled
// `@open-pets/claude` CLI, by platform. The bundled CLI runs through `node`
// against an absolute path, which avoids the per-invocation package-manager
// resolution cost (`npx -y ...`) that the published fallback pays on every hook
// firing. Order is most-specific/most-common first.
function installedClaudeCliCandidates(): readonly string[] {
  // Path from the app's resources dir down to the bundled CLI. macOS nests
  // resources under Contents/Resources; Windows and Linux use a top-level
  // resources/ dir (identical from there on).
  const cliFromResources = join("app.asar.unpacked", "node_modules", "@open-pets", "claude", "dist", "cli.js");
  const macRel = join("Contents", "Resources", cliFromResources);
  const resourcesRel = join("resources", cliFromResources);
  if (process.platform === "darwin") {
    return [
      join("/Applications", "OpenPets.app", macRel),
      join(homedir(), "Applications", "OpenPets.app", macRel),
    ];
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    return [
      ...(localAppData ? [join(localAppData, "Programs", "openpets", resourcesRel)] : []),
      ...(programFiles ? [join(programFiles, "OpenPets", resourcesRel)] : []),
    ];
  }
  // Linux deb/rpm installs unpack here; AppImage mounts at runtime and is not
  // discoverable, so those users keep the published fallback.
  return [
    join("/opt", "OpenPets", resourcesRel),
    join("/usr", "lib", "openpets", resourcesRel),
  ];
}

// Returns the absolute path to an installed OpenPets app's bundled Claude CLI,
// or null when no valid install is found (the caller then keeps the npx
// published fallback). Each candidate is validated the same way the bundled
// command path is, minus the package-relative root check (the app lives outside
// this package).
export function findInstalledOpenPetsClaudeCli(candidates: readonly string[] = installedClaudeCliCandidates()): string | null {
  for (const candidate of candidates) {
    try {
      assertInstalledClaudeCliPath(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function assertInstalledClaudeCliPath(path: string): void {
  if (!isAbsolute(path)) throw new Error("Installed Claude hook CLI path must be absolute.");
  if (path.includes("\n") || path.includes("\r") || path.includes("\0")) throw new Error("Installed Claude hook CLI path contains unsupported characters.");
  if (isTrueAsarPath(path)) throw new Error("Installed Claude hook CLI path must be unpacked outside app.asar.");
  const cliDir = join("@open-pets", "claude", "dist");
  if (!path.endsWith(join(cliDir, "cli.js"))) throw new Error("Installed Claude hook CLI path must point at @open-pets/claude/dist/cli.js.");
  if (lstatSync(path).isSymbolicLink()) throw new Error("Installed Claude hook CLI path must not be a symlink.");
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("Installed Claude hook CLI path is not a regular file.");
}

export function getLocalClaudeCliPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

export function getBundledClaudeCliPath(): string {
  return mapAsarPathToUnpacked(getLocalClaudeCliPath());
}

export function assertLocalClaudeCliPath(): void {
  const path = getLocalClaudeCliPath();
  const expectedPrefix = dirname(fileURLToPath(import.meta.url));
  if (!path.startsWith(expectedPrefix)) throw new Error("Local Claude hook path is outside the OpenPets package.");
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("Local Claude hook CLI path is not a regular file.");
}

export function assertBundledClaudeCliPath(): void {
  const path = getBundledClaudeCliPath();
  if (isTrueAsarPath(path)) throw new Error("Bundled Claude hook CLI path must be unpacked outside app.asar.");
  if (path.includes("\n") || path.includes("\r") || path.includes("\0")) throw new Error("Bundled Claude hook CLI path contains unsupported characters.");
  if (lstatSync(path).isSymbolicLink()) throw new Error("Bundled Claude hook CLI path must not be a symlink.");
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("Bundled Claude hook CLI path is not a regular file.");
  const expectedRoot = realpathSync(mapAsarPathToUnpacked(join(dirname(fileURLToPath(import.meta.url)), "..", "..")));
  const realPath = realpathSync(path);
  const rel = relative(expectedRoot, realPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Bundled Claude hook CLI path is outside the packaged OpenPets resources.");
}

function isTrueAsarPath(path: string): boolean {
  return /app\.asar(?:$|[\\/])/.test(path) && !/app\.asar\.unpacked(?:$|[\\/])/.test(path);
}

export function createOpenPetsHookSettingsPreview(commandMode: OpenPetsCommandMode = "published", selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const event of claudeHookEvents) {
    hooks[event] = [{ hooks: [createHookCommandEntry(commandMode, selectedPetId, nodeCommand, explicitCliPath)] }];
  }
  return { hooks };
}

export function doctorClaudeHooks(settingsPath = getClaudeUserSettingsPath(), commandMode: OpenPetsCommandMode = "published", selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): ClaudeHookDoctorResult {
  const preview = createOpenPetsHookSettingsPreview(commandMode, selectedPetId, nodeCommand, explicitCliPath);
  const asyncSupported = isClaudeHookAsyncSupported();
  try {
    const settings = readClaudeSettings(settingsPath);
    const status = getHookInstallStatus(settings, commandMode, selectedPetId, nodeCommand, explicitCliPath);
    return {
      status,
      settingsPath,
      exists: existsSync(settingsPath),
      valid: true,
      message: `${asyncSupported ? status === "installed" ? "OpenPets Claude hooks are installed. Async hook install is enabled by OpenPets." : status === "needs_update" ? "OpenPets Claude hooks need update. Async hook install is enabled by OpenPets." : "OpenPets Claude hooks are not installed. Async hook install is enabled by OpenPets." : "Async hook install is disabled by OpenPets."} ${selectedPetId ? `Hook events target ${selectedPetId}.` : "Hook events target the default pet."}`,
      preview,
      asyncSupported,
    };
  } catch (error) {
    return { status: "error", settingsPath, exists: existsSync(settingsPath), valid: false, message: error instanceof Error ? error.message : "Claude hook settings are invalid.", preview, asyncSupported };
  }
}

export function installClaudeHooks(settingsPath = getClaudeUserSettingsPath(), commandMode: OpenPetsCommandMode = "published", selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): ClaudeHookWriteResult {
  if (!isClaudeHookAsyncSupported()) throw new Error("Claude async hook support is not enabled for this OpenPets build.");
  const settings = readClaudeSettings(settingsPath);
  const status = getHookInstallStatus(settings, commandMode, selectedPetId, nodeCommand, explicitCliPath);
  if (status === "installed") return { ...doctorClaudeHooks(settingsPath, commandMode, selectedPetId, nodeCommand, explicitCliPath), changed: false };
  const backupPath = backupSettings(settingsPath);
  const next = addOpenPetsHooks(removeOpenPetsHooks(settings), commandMode, selectedPetId, nodeCommand, explicitCliPath);
  writeClaudeSettings(settingsPath, next);
  return { ...doctorClaudeHooks(settingsPath, commandMode, selectedPetId, nodeCommand, explicitCliPath), backupPath, changed: true };
}

export function uninstallClaudeHooks(settingsPath = getClaudeUserSettingsPath(), commandMode: OpenPetsCommandMode = "published"): ClaudeHookWriteResult {
  const settings = readClaudeSettings(settingsPath);
  const status = getHookInstallStatus(settings, commandMode);
  if (status === "not_installed") return { ...doctorClaudeHooks(settingsPath, commandMode), changed: false };
  const backupPath = backupSettings(settingsPath);
  const next = removeOpenPetsHooks(settings);
  writeClaudeSettings(settingsPath, next);
  return { ...doctorClaudeHooks(settingsPath, commandMode), backupPath, changed: true };
}

export function addOpenPetsHooks(settings: Record<string, unknown>, commandMode: OpenPetsCommandMode = "published", selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): Record<string, unknown> {
  const next = structuredClone(settings) as Record<string, unknown>;
  assertSelectedHookEventsAreArrays(next);
  const hooks = isRecord(next.hooks) ? { ...next.hooks } : {};
  for (const event of claudeHookEvents) {
    const existing = Array.isArray(hooks[event]) ? hooks[event].filter((entry) => !containsOpenPetsHook(entry)) : [];
    hooks[event] = [...existing, { hooks: [createHookCommandEntry(commandMode, selectedPetId, nodeCommand, explicitCliPath)] }];
  }
  next.hooks = hooks;
  return next;
}

export function removeOpenPetsHooks(settings: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(settings) as Record<string, unknown>;
  if (!isRecord(next.hooks)) return next;
  assertSelectedHookEventsAreArrays(next);
  const hooks: Record<string, unknown> = { ...next.hooks };
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const cleaned = entries.map(removeOpenPetsHooksFromMatcher).filter((entry) => entry !== null);
    if (cleaned.length > 0) hooks[event] = cleaned;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

function getHookInstallStatus(settings: Record<string, unknown>, commandMode: OpenPetsCommandMode, selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): ClaudeHookInstallStatus {
  if (settings.hooks !== undefined && !isRecord(settings.hooks)) throw new Error("Claude settings hooks field is not an object.");
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  let foundAny = false;
  let staleManaged = false;
  for (const event of claudeHookEvents) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) return foundAny ? "needs_update" : "not_installed";
    const currentCount = entries.filter((entry) => containsCurrentOpenPetsHook(entry, commandMode, selectedPetId, nodeCommand, explicitCliPath)).length;
    const managedCount = entries.filter((entry) => containsOpenPetsHook(entry)).length;
    const hasCurrent = currentCount === 1;
    if (managedCount > 0) foundAny = true;
    if (managedCount !== currentCount || currentCount > 1) staleManaged = true;
    if (!hasCurrent) return foundAny ? "needs_update" : "not_installed";
    foundAny = true;
  }
  return staleManaged ? "needs_update" : "installed";
}

function createHookCommandEntry(commandMode: OpenPetsCommandMode, selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): Record<string, unknown> {
  return { type: "command", command: createOpenPetsHookCommand(commandMode, selectedPetId, nodeCommand, explicitCliPath), timeout: 3, async: true, asyncRewake: false };
}

function containsCurrentOpenPetsHook(value: unknown, commandMode: OpenPetsCommandMode, selectedPetId?: string, nodeCommand = "node", explicitCliPath?: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.hooks)) return false;
  const command = createOpenPetsHookCommand(commandMode, selectedPetId, nodeCommand, explicitCliPath);
  return value.hooks.some((hook) => isRecord(hook) && hook.type === "command" && hook.command === command && hook.timeout === 3 && hook.async === true && hook.asyncRewake === false);
}

function containsOpenPetsHook(value: unknown): boolean {
  if (isRecord(value) && typeof value.command === "string" && value.command.includes(openPetsHookMarker)) return true;
  if (isRecord(value) && Array.isArray(value.hooks)) return value.hooks.some(containsOpenPetsHook);
  return false;
}

function removeOpenPetsHooksFromMatcher(value: unknown): unknown | null {
  if (!isRecord(value) || !Array.isArray(value.hooks)) return containsOpenPetsHook(value) ? null : value;
  const hooks = value.hooks.filter((hook) => !containsOpenPetsHook(hook));
  if (hooks.length === 0) return null;
  return { ...value, hooks };
}

function readClaudeSettings(path: string): Record<string, unknown> {
  assertSafeSettingsPath(path);
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error("Claude settings must be a JSON object.");
  if (parsed.hooks !== undefined && !isRecord(parsed.hooks)) throw new Error("Claude settings hooks field is not an object.");
  assertSelectedHookEventsAreArrays(parsed);
  return parsed;
}

function assertSelectedHookEventsAreArrays(settings: Record<string, unknown>): void {
  if (!isRecord(settings.hooks)) return;
  for (const event of claudeHookEvents) {
    if (settings.hooks[event] !== undefined && !Array.isArray(settings.hooks[event])) {
      throw new Error(`Claude settings hooks.${event} must be an array.`);
    }
  }
}

function isClaudeHookAsyncSupported(): boolean {
  return process.env.OPENPETS_DISABLE_CLAUDE_ASYNC_HOOKS !== "1";
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (/[\r\n"]/.test(value) || value.includes("\0")) throw new Error("Claude hook path contains unsupported shell characters.");
  return `"${value.replaceAll("\\", "\\\\").replaceAll("$", "\\$").replaceAll("`", "\\`")}"`;
}

function writeClaudeSettings(path: string, settings: Record<string, unknown>): void {
  assertSafeSettingsPath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, path);
}

function backupSettings(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  assertSafeSettingsPath(path);
  const backupPath = `${path}.openpets-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`;
  writeFileSync(backupPath, readFileSync(path), { mode: 0o600 });
  try { chmodSync(backupPath, 0o600); } catch { /* best effort */ }
  return backupPath;
}

function assertSafeSettingsPath(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Claude settings path must be a regular file.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

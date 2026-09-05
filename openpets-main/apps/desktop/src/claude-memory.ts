import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ClaudeOpenPetsMemoryResult {
  readonly changed: boolean;
  readonly claudeMdPath: string;
  readonly openPetsMemoryPath: string;
}

export interface ClaudeOpenPetsMemoryStatus {
  readonly status: "installed" | "not_installed" | "error";
  readonly message: string;
  readonly claudeMdPath: string;
  readonly openPetsMemoryPath: string;
}

export const openPetsClaudeImportLine = "@~/.claude/openpets.md";

const openPetsImportStart = "<!-- OPENPETS:IMPORT:START -->";
const openPetsImportEnd = "<!-- OPENPETS:IMPORT:END -->";
const openPetsMemoryStart = "<!-- OPENPETS:START -->";
const openPetsMemoryEnd = "<!-- OPENPETS:END -->";
const maxClaudeMemoryBytes = 1024 * 1024;

export function installClaudeOpenPetsMemory(homeDir: string): ClaudeOpenPetsMemoryResult {
  const paths = getClaudeMemoryPaths(homeDir);
  assertSafeClaudeMemoryPaths(paths.claudeDir, paths.claudeMdPath, paths.openPetsMemoryPath);
  mkdirSync(paths.claudeDir, { recursive: true, mode: 0o700 });
  assertSafeClaudeMemoryPaths(paths.claudeDir, paths.claudeMdPath, paths.openPetsMemoryPath);

  const currentOpenPetsMemory = readTextFile(paths.openPetsMemoryPath);
  const nextOpenPetsMemory = upsertOpenPetsMemoryBlock(currentOpenPetsMemory, createOpenPetsMemoryBlock());
  const openPetsChanged = currentOpenPetsMemory !== nextOpenPetsMemory;
  if (openPetsChanged) writePrivateTextFile(paths.openPetsMemoryPath, nextOpenPetsMemory);

  const currentClaudeMd = readTextFile(paths.claudeMdPath);
  const nextClaudeMd = ensureManagedImport(currentClaudeMd);
  const claudeMdChanged = currentClaudeMd !== nextClaudeMd;
  if (claudeMdChanged) writePrivateTextFile(paths.claudeMdPath, nextClaudeMd);

  return { changed: openPetsChanged || claudeMdChanged, claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
}

export function uninstallClaudeOpenPetsMemory(homeDir: string): ClaudeOpenPetsMemoryResult {
  const paths = getClaudeMemoryPaths(homeDir);
  assertSafeClaudeMemoryPaths(paths.claudeDir, paths.claudeMdPath, paths.openPetsMemoryPath);

  let changed = false;
  const currentClaudeMd = readTextFile(paths.claudeMdPath);
  const hasUserOwnedImport = hasImportLineOutsideManagedBlock(currentClaudeMd);
  const nextClaudeMd = removeManagedImport(currentClaudeMd);
  if (currentClaudeMd !== nextClaudeMd) {
    writePrivateTextFile(paths.claudeMdPath, nextClaudeMd);
    changed = true;
  }

  const currentOpenPetsMemory = readTextFile(paths.openPetsMemoryPath);
  if (currentOpenPetsMemory) {
    const nextOpenPetsMemory = removeOpenPetsMemoryBlock(currentOpenPetsMemory);
    if (nextOpenPetsMemory.trim().length === 0) {
      if (hasUserOwnedImport) {
        writePrivateTextFile(paths.openPetsMemoryPath, "");
      } else {
        rmSync(paths.openPetsMemoryPath, { force: true });
      }
      changed = true;
    } else if (nextOpenPetsMemory !== currentOpenPetsMemory) {
      writePrivateTextFile(paths.openPetsMemoryPath, nextOpenPetsMemory);
      changed = true;
    }
  }

  return { changed, claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
}

export function doctorClaudeOpenPetsMemory(homeDir: string): ClaudeOpenPetsMemoryStatus {
  const paths = getClaudeMemoryPaths(homeDir);
  try {
    assertSafeClaudeMemoryPaths(paths.claudeDir, paths.claudeMdPath, paths.openPetsMemoryPath);
    const claudeMd = readTextFile(paths.claudeMdPath);
    const openPetsMemory = readTextFile(paths.openPetsMemoryPath);
    const hasImport = hasManagedImport(claudeMd) || hasImportLineOutsideManagedBlock(claudeMd);
    const hasInstructions = createOpenPetsBlockPattern().test(openPetsMemory) || /openpets_say|OpenPets MCP/i.test(openPetsMemory);
    if (hasImport && hasInstructions) {
      return { status: "installed", message: "Claude will load OpenPets instructions from ~/.claude/openpets.md.", claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
    }
    if (hasImport) {
      return { status: "not_installed", message: "Claude imports OpenPets instructions, but the OpenPets memory file is missing or incomplete.", claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
    }
    if (hasInstructions) {
      return { status: "not_installed", message: "OpenPets instructions exist, but Claude is not importing them yet.", claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
    }
    return { status: "not_installed", message: "Claude OpenPets instructions are not installed.", claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Claude OpenPets instruction status is unavailable.", claudeMdPath: paths.claudeMdPath, openPetsMemoryPath: paths.openPetsMemoryPath };
  }
}

export function getClaudeMemoryPaths(homeDir: string): { readonly claudeDir: string; readonly claudeMdPath: string; readonly openPetsMemoryPath: string } {
  const claudeDir = join(homeDir, ".claude");
  return {
    claudeDir,
    claudeMdPath: join(claudeDir, "CLAUDE.md"),
    openPetsMemoryPath: join(claudeDir, "openpets.md"),
  };
}

export function createOpenPetsMemoryBlock(): string {
  return `${openPetsMemoryStart}\n## OpenPets\n\nOpenPets MCP tools may be available.\n\nUse OpenPets as a short visible status channel for meaningful coding progress:\n- Use \`openpets_say\` when starting, completing, blocking, or needing review on non-trivial work.\n- Keep messages brief, user-facing, and non-sensitive.\n- Do not include code, logs, secrets, URLs, or file paths.\n- Use \`openpets_react\` for small visual or emotional feedback.\n- Use \`openpets_status\` only when checking availability or the targeted pet.\n- Do not spam every internal step.\n${openPetsMemoryEnd}\n`;
}

export function ensureImportLine(source: string, importLine: string): string {
  const lines = source.split(/\r?\n/);
  const filtered = lines.filter((line) => line.trim() !== importLine);
  const base = filtered.join("\n").replace(/\s*$/u, "");
  return base ? `${base}\n\n${importLine}\n` : `${importLine}\n`;
}

export function ensureManagedImport(source: string): string {
  const withoutManagedImports = removeManagedImport(source).replace(/\s*$/u, "");
  if (withoutManagedImports.split(/\r?\n/).some((line) => line.trim() === openPetsClaudeImportLine)) {
    return withoutManagedImports ? `${withoutManagedImports}\n` : "";
  }
  const block = `${openPetsImportStart}\n${openPetsClaudeImportLine}\n${openPetsImportEnd}`;
  return withoutManagedImports ? `${withoutManagedImports}\n\n${block}\n` : `${block}\n`;
}

export function removeManagedImport(source: string): string {
  return source.replace(createManagedImportPattern(), "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/u, (match) => (match.includes("\n") ? "\n" : ""));
}

export function removeImportLine(source: string, importLine: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim() !== importLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*$/u, (match) => (match.includes("\n") ? "\n" : ""));
}

export function upsertOpenPetsMemoryBlock(source: string, block: string): string {
  const withoutBlocks = source.replace(createOpenPetsBlockPattern(), "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/u, "");
  return withoutBlocks ? `${withoutBlocks}\n\n${block}` : block;
}

export function removeOpenPetsMemoryBlock(source: string): string {
  const withoutBlock = source.replace(createOpenPetsBlockPattern(), "").replace(/\n{3,}/g, "\n\n").trim();
  return withoutBlock ? `${withoutBlock}\n` : "";
}

function createOpenPetsBlockPattern(): RegExp {
  return new RegExp(`${escapeRegExp(openPetsMemoryStart)}[\\s\\S]*?${escapeRegExp(openPetsMemoryEnd)}\\n?`, "g");
}

function createManagedImportPattern(): RegExp {
  return new RegExp(`${escapeRegExp(openPetsImportStart)}[\\s\\S]*?${escapeRegExp(openPetsImportEnd)}\\n?`, "g");
}

function hasManagedImport(source: string): boolean {
  return createManagedImportPattern().test(source);
}

function hasImportLineOutsideManagedBlock(source: string): boolean {
  return removeManagedImport(source).split(/\r?\n/).some((line) => line.trim() === openPetsClaudeImportLine);
}

function assertSafeClaudeMemoryPaths(claudeDir: string, claudeMdPath: string, openPetsMemoryPath: string): void {
  if (existsSync(claudeDir)) {
    const stat = lstatSync(claudeDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Claude memory directory is not a safe directory.");
  }
  for (const path of [claudeMdPath, openPetsMemoryPath]) {
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Claude memory file is not a safe regular file.");
    if (stat.size > maxClaudeMemoryBytes) throw new Error("Claude memory file is too large for OpenPets to update safely.");
  }
}

function readTextFile(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function writePrivateTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  assertSafeWriteTarget(path);
  const tempPath = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(tempPath, "wx", 0o600);
  try {
    writeFileSync(fd, content, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  assertSafeWriteTarget(path);
  renameSync(tempPath, path);
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

function assertSafeWriteTarget(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Claude memory file is not a safe regular file.");
  if (stat.size > maxClaudeMemoryBytes) throw new Error("Claude memory file is too large for OpenPets to update safely.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

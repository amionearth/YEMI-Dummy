import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, parse, resolve } from "node:path";

export type CursorRulesStatus = "missing" | "installed" | "needs-update" | "conflict" | "invalid" | "error";

export interface CursorRulesReadResult {
  readonly ok: true;
  readonly content: string;
  readonly exists: boolean;
}

export interface CursorRulesError {
  readonly ok: false;
  readonly message: string;
  readonly reason: "size" | "symlink" | "not-regular" | "unsafe-path" | "io";
}

export interface CursorRulesStatusResult {
  readonly status: CursorRulesStatus;
  readonly message: string;
  readonly rulesPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
  readonly previewContent?: string;
  readonly redactedDetails?: string;
}

export interface CursorRulesPlannedWrite {
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly tempPath: string;
  readonly content?: string;
  readonly remove?: boolean;
}

export const maxCursorRulesBytes = 64 * 1024;
export const cursorRulesStartMarker = "<!-- OPENPETS:CURSOR_RULES:START -->";
export const cursorRulesEndMarker = "<!-- OPENPETS:CURSOR_RULES:END -->";

const cursorRulesFrontmatter = "---\ndescription: Use OpenPets MCP tools for lightweight coding-status feedback.\n---";

export function getCursorProjectRulesPath(projectDir: string): string {
  return join(projectDir, ".cursor", "rules", "openpets.mdc");
}

export function buildCursorOpenPetsRule(): string {
  return `${cursorRulesFrontmatter}

${cursorRulesStartMarker}
# OpenPets status feedback

You may use the OpenPets MCP tools as a brief, safe status channel during meaningful coding work.

- Use \`openpets_say\` sparingly for major milestones, blocking states, completion, or when review is needed.
- Prefer \`openpets_react\` over speech for lightweight progress such as thinking, working, testing, success, or error.
- Keep messages short, user-facing, and safe.
- Do not send prompts, tool input/output, code, logs, stack traces, credentials, private file contents, URLs, file paths, or other sensitive content through OpenPets.
- Do not spam every internal step; use OpenPets only for meaningful progress changes and continue normally if a status update is unnecessary.
- If OpenPets is unavailable, continue the coding task without failing.
${cursorRulesEndMarker}
`;
}

export function buildCursorRulesPreview(): string {
  return buildCursorOpenPetsRule();
}

export function readCursorOpenPetsRules(projectDir: string): CursorRulesReadResult | CursorRulesError {
  try {
    const rulesPath = getCursorProjectRulesPath(projectDir);
    const pathSafety = assertSafeRulesPath(projectDir, rulesPath);
    if (!pathSafety.ok) return pathSafety;

    const existing = assertSafeExistingRulesFile(rulesPath, true);
    if (!existing.ok) return existing;

    if (!existsSync(rulesPath)) return { ok: true, content: "", exists: false };

    const content = readFileSync(rulesPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > maxCursorRulesBytes) {
      return { ok: false, message: "Cursor OpenPets rule file exceeds 64 KiB limit.", reason: "size" };
    }

    return { ok: true, content, exists: true };
  } catch (error) {
    return { ok: false, message: `IO error: ${error instanceof Error ? error.message : String(error)}`, reason: "io" };
  }
}

export function classifyCursorRulesStatus(
  readResult: CursorRulesReadResult | CursorRulesError,
  rulesPath: string,
  expectedContent = buildCursorOpenPetsRule()
): CursorRulesStatusResult {
  if (!readResult.ok) {
    return {
      status: readResult.reason === "io" ? "error" : "invalid",
      message: cursorRulesErrorMessage(readResult.reason),
      rulesPath,
      canInstall: false,
      canReplace: false,
      canRemove: false,
      redactedDetails: readResult.message,
    };
  }

  if (!readResult.exists) {
    return {
      status: "missing",
      message: "Cursor OpenPets project rule is not installed.",
      rulesPath,
      canInstall: true,
      canReplace: false,
      canRemove: false,
      previewContent: expectedContent,
    };
  }

  const managedShape = classifyManagedRuleShape(readResult.content);
  if (managedShape !== "managed") {
    return {
      status: "conflict",
      message: managedShape,
      rulesPath,
      canInstall: false,
      canReplace: true,
      canRemove: false,
      redactedDetails: "Existing .cursor/rules/openpets.mdc is not an exact OpenPets-managed rules file.",
    };
  }

  if (normalizeNewlines(readResult.content) === normalizeNewlines(expectedContent)) {
    return {
      status: "installed",
      message: "Cursor OpenPets project rule is installed and up to date.",
      rulesPath,
      canInstall: false,
      canReplace: false,
      canRemove: true,
      previewContent: expectedContent,
    };
  }

  return {
    status: "needs-update",
    message: "Cursor OpenPets project rule needs update.",
    rulesPath,
    canInstall: true,
    canReplace: true,
    canRemove: true,
    previewContent: expectedContent,
  };
}

export function isManagedCursorOpenPetsRule(content: string): boolean {
  return classifyManagedRuleShape(content) === "managed";
}

export function planCursorRulesInstall(projectDir: string, allowReplace = false): CursorRulesPlannedWrite | CursorRulesError {
  const rulesPath = getCursorProjectRulesPath(projectDir);
  const existing = readCursorOpenPetsRules(projectDir);
  if (!existing.ok) return existing;
  const status = classifyCursorRulesStatus(existing, rulesPath);

  if (status.status === "invalid" || status.status === "error") {
    return { ok: false, message: status.message, reason: "io" };
  }
  if (status.status === "conflict" && !allowReplace) {
    return { ok: false, message: "Cannot install: .cursor/rules/openpets.mdc has user content. Use --force to replace only that file.", reason: "unsafe-path" };
  }
  if (status.status === "installed") {
    return { ok: false, message: "Cursor OpenPets project rule is already installed.", reason: "io" };
  }

  return buildRulesWritePlan(projectDir, buildCursorOpenPetsRule());
}

export function planCursorRulesReplace(projectDir: string): CursorRulesPlannedWrite | CursorRulesError {
  const rulesPath = getCursorProjectRulesPath(projectDir);
  const existing = readCursorOpenPetsRules(projectDir);
  if (!existing.ok) return existing;
  const status = classifyCursorRulesStatus(existing, rulesPath);

  if (status.status === "invalid" || status.status === "error") {
    return { ok: false, message: status.message, reason: "io" };
  }
  if (status.status === "missing") {
    return { ok: false, message: "Cannot replace: Cursor OpenPets project rule is not installed. Use install instead.", reason: "io" };
  }
  if (status.status === "installed") {
    return { ok: false, message: "Cannot replace: Cursor OpenPets project rule is already installed.", reason: "io" };
  }

  return buildRulesWritePlan(projectDir, buildCursorOpenPetsRule());
}

export function planCursorRulesRemove(projectDir: string): CursorRulesPlannedWrite | CursorRulesError {
  const rulesPath = getCursorProjectRulesPath(projectDir);
  const existing = readCursorOpenPetsRules(projectDir);
  if (!existing.ok) return existing;
  const status = classifyCursorRulesStatus(existing, rulesPath);

  if (status.status === "missing") return { ok: false, message: "Cursor OpenPets project rule is not installed.", reason: "io" };
  if (status.status === "conflict") return { ok: false, message: "Cannot remove: .cursor/rules/openpets.mdc is not managed by OpenPets.", reason: "unsafe-path" };
  if (status.status === "invalid" || status.status === "error") return { ok: false, message: status.message, reason: "io" };

  return buildRulesWritePlan(projectDir, undefined, true);
}

export function executeCursorRulesWrite(plan: CursorRulesPlannedWrite): void {
  const parent = resolve(plan.targetPath, "..");
  const parentSafety = assertSafeParentDirectory(parent);
  if (!parentSafety.ok) throw new Error(parentSafety.message);

  const targetSafety = assertSafeExistingRulesFile(plan.targetPath, true);
  if (!targetSafety.ok) throw new Error(targetSafety.message);

  mkdirSync(parent, { recursive: true, mode: 0o700 });

  if (plan.backupPath && existsSync(plan.targetPath)) {
    const backupFd = openSync(plan.backupPath, "wx", 0o600);
    try {
      writeFileSync(backupFd, readFileSync(plan.targetPath));
    } finally {
      closeSync(backupFd);
    }
  }

  if (plan.remove) {
    rmSync(plan.targetPath);
    return;
  }

  if (typeof plan.content !== "string") throw new Error("Cursor rules write plan is missing content.");
  const fd = openSync(plan.tempPath, "wx", 0o600);
  try {
    writeFileSync(fd, plan.content, "utf8");
  } finally {
    closeSync(fd);
  }

  renameSync(plan.tempPath, plan.targetPath);
  try { chmodSync(plan.targetPath, 0o600); } catch { /* best effort */ }
}

function buildRulesWritePlan(projectDir: string, content?: string, remove = false): CursorRulesPlannedWrite | CursorRulesError {
  const rulesPath = getCursorProjectRulesPath(projectDir);
  const pathSafety = assertSafeRulesPath(projectDir, rulesPath);
  if (!pathSafety.ok) return pathSafety;

  const existing = assertSafeExistingRulesFile(rulesPath, true);
  if (!existing.ok) return existing;

  const parent = resolve(rulesPath, "..");
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const backupPath = existsSync(rulesPath) ? uniquePath(`${rulesPath}.openpets-backup-${stamp}.mdc`) : undefined;
  const tempPath = uniquePath(join(parent, `.openpets-rules-${stamp}.tmp`));

  return { targetPath: rulesPath, backupPath, tempPath, content, remove };
}

function classifyManagedRuleShape(content: string): "managed" | string {
  const normalized = normalizeNewlines(content);
  if (countOccurrences(normalized, cursorRulesStartMarker) !== 1 || countOccurrences(normalized, cursorRulesEndMarker) !== 1) {
    return "Cursor OpenPets rule file has missing or duplicate managed markers.";
  }

  const start = normalized.indexOf(cursorRulesStartMarker);
  const end = normalized.indexOf(cursorRulesEndMarker);
  if (start < 0 || end < 0 || start > end) return "Cursor OpenPets rule file has malformed managed markers.";

  const before = normalized.slice(0, start).trim();
  const after = normalized.slice(end + cursorRulesEndMarker.length).trim();
  if (before !== cursorRulesFrontmatter) return "Cursor OpenPets rule file has unknown frontmatter or user content before the managed block.";
  if (after !== "") return "Cursor OpenPets rule file has user content after the managed block.";

  return "managed";
}

function cursorRulesErrorMessage(reason: CursorRulesError["reason"]): string {
  const messages: Record<CursorRulesError["reason"], string> = {
    size: "Cursor OpenPets rule file is too large.",
    symlink: "Cursor OpenPets rule path is a symlink.",
    "not-regular": "Cursor OpenPets rule path is not a regular file.",
    "unsafe-path": "Cursor OpenPets rule path is unsafe.",
    io: "Failed to read Cursor OpenPets rule file.",
  };
  return messages[reason];
}

function assertSafeRulesPath(projectDir: string, rulesPath: string): CursorRulesError | { readonly ok: true } {
  const projectRoot = resolve(projectDir);
  const expected = resolve(getCursorProjectRulesPath(projectRoot));
  const resolvedRulesPath = resolve(rulesPath);
  if (resolvedRulesPath !== expected) {
    return { ok: false, message: "Cursor rules path must be <project>/.cursor/rules/openpets.mdc.", reason: "unsafe-path" };
  }
  return assertSafeParentDirectory(resolve(rulesPath, ".."));
}

function assertSafeExistingRulesFile(path: string, allowMissing = false): CursorRulesError | { readonly ok: true } {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return allowMissing ? { ok: true } : { ok: false, message: "Cursor rules file does not exist.", reason: "io" };
  if (stat.isSymbolicLink()) return { ok: false, message: "Cursor rules file is a symlink.", reason: "symlink" };
  if (!stat.isFile()) return { ok: false, message: "Cursor rules path is not a regular file.", reason: "not-regular" };
  if (stat.size > maxCursorRulesBytes) return { ok: false, message: "Cursor rules file exceeds 64 KiB limit.", reason: "size" };
  return { ok: true };
}

function assertSafeParentDirectory(path: string): CursorRulesError | { readonly ok: true } {
  if (path.split(/[\\/]+/u).includes("..")) {
    return { ok: false, message: "Cursor rules parent path must not contain parent traversal segments.", reason: "unsafe-path" };
  }

  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const parts = absolutePath.slice(root.length).split(/[\\/]+/u).filter(Boolean);
  let current = root;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) return { ok: false, message: "Cursor rules parent must not contain symlink segments.", reason: "symlink" };
    if (!stat.isDirectory()) return { ok: false, message: "Cursor rules parent path segment must be a directory.", reason: "unsafe-path" };
  }

  return { ok: true };
}

function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${path}.${index}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("Unable to allocate unique temp path.");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

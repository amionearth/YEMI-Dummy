import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureImportLine, ensureManagedImport, installClaudeOpenPetsMemory, openPetsClaudeImportLine, removeImportLine, removeOpenPetsMemoryBlock, uninstallClaudeOpenPetsMemory, upsertOpenPetsMemoryBlock } from "../src/claude-memory.js";

assert.equal(ensureImportLine("", openPetsClaudeImportLine), `${openPetsClaudeImportLine}\n`);
assert.equal(ensureImportLine("# User notes\n", openPetsClaudeImportLine), `# User notes\n\n${openPetsClaudeImportLine}\n`);
assert.equal(ensureImportLine(`# User notes\n${openPetsClaudeImportLine}\n${openPetsClaudeImportLine}\n`, openPetsClaudeImportLine), `# User notes\n\n${openPetsClaudeImportLine}\n`);
assert.equal(removeImportLine(`# User notes\n\n${openPetsClaudeImportLine}\n`, openPetsClaudeImportLine), "# User notes\n");
assert.match(upsertOpenPetsMemoryBlock("custom\n", "<!-- OPENPETS:START -->\nmanaged\n<!-- OPENPETS:END -->\n"), /custom[\s\S]*managed/);
assert.equal((upsertOpenPetsMemoryBlock("<!-- OPENPETS:START -->\nold\n<!-- OPENPETS:END -->\n\n<!-- OPENPETS:START -->\nolder\n<!-- OPENPETS:END -->\n", "<!-- OPENPETS:START -->\nnew\n<!-- OPENPETS:END -->\n").match(/OPENPETS:START/g) ?? []).length, 1);
assert.match(ensureManagedImport("# User notes\n"), /OPENPETS:IMPORT:START[\s\S]*@~\/\.claude\/openpets\.md[\s\S]*OPENPETS:IMPORT:END/);
assert.equal(ensureManagedImport(`${openPetsClaudeImportLine}\n`), `${openPetsClaudeImportLine}\n`, "user-owned import line should not be wrapped as managed.");
assert.equal(removeOpenPetsMemoryBlock("custom\n<!-- OPENPETS:START -->\nmanaged\n<!-- OPENPETS:END -->\n"), "custom\n");

const dir = mkdtempSync(join(tmpdir(), "openpets-claude-memory-"));
try {
  const claudeDir = join(dir, ".claude");
  const claudeMd = join(claudeDir, "CLAUDE.md");
  const openpetsMd = join(claudeDir, "openpets.md");
  mkdirSync(claudeDir);
  writeFileSync(claudeMd, "# Existing Claude instructions\n\nKeep this.\n", "utf8");

  const installed = installClaudeOpenPetsMemory(dir);
  assert.equal(installed.changed, true);
  assert.match(readFileSync(claudeMd, "utf8"), /Keep this\.[\s\S]*@~\/\.claude\/openpets\.md/);
  assert.match(readFileSync(openpetsMd, "utf8"), /openpets_say/);

  const reinstalled = installClaudeOpenPetsMemory(dir);
  assert.equal(reinstalled.changed, false);
  assert.equal((readFileSync(claudeMd, "utf8").match(/@~\/\.claude\/openpets\.md/g) ?? []).length, 1);
  assert.match(readFileSync(claudeMd, "utf8"), /OPENPETS:IMPORT:START/);

  writeFileSync(openpetsMd, `${readFileSync(openpetsMd, "utf8")}\nUser custom note.\n`, "utf8");
  const uninstalled = uninstallClaudeOpenPetsMemory(dir);
  assert.equal(uninstalled.changed, true);
  assert.doesNotMatch(readFileSync(claudeMd, "utf8"), /openpets\.md/);
  assert.equal(existsSync(openpetsMd), true, "customized openpets.md should be preserved after managed block removal.");
  assert.match(readFileSync(openpetsMd, "utf8"), /User custom note/);

  const userImportHome = join(dir, "user-import-home");
  const userClaudeDir = join(userImportHome, ".claude");
  mkdirSync(userClaudeDir, { recursive: true });
  writeFileSync(join(userClaudeDir, "CLAUDE.md"), `# User-owned import\n${openPetsClaudeImportLine}\n`, "utf8");
  writeFileSync(join(userClaudeDir, "openpets.md"), "User-owned content.\n", "utf8");
  installClaudeOpenPetsMemory(userImportHome);
  assert.doesNotMatch(readFileSync(join(userClaudeDir, "CLAUDE.md"), "utf8"), /OPENPETS:IMPORT:START/, "pre-existing import should remain user-owned.");
  uninstallClaudeOpenPetsMemory(userImportHome);
  assert.match(readFileSync(join(userClaudeDir, "CLAUDE.md"), "utf8"), /@~\/\.claude\/openpets\.md/, "user-owned import should not be removed.");
  assert.match(readFileSync(join(userClaudeDir, "openpets.md"), "utf8"), /User-owned content/, "user-owned openpets.md content should be preserved.");

  const symlinkHome = join(dir, "symlink-home");
  const symlinkTarget = join(dir, "outside");
  mkdirSync(symlinkHome);
  mkdirSync(symlinkTarget);
  symlinkSync(symlinkTarget, join(symlinkHome, ".claude"));
  assert.throws(() => installClaudeOpenPetsMemory(symlinkHome));

  const symlinkFileHome = join(dir, "symlink-file-home");
  mkdirSync(join(symlinkFileHome, ".claude"), { recursive: true });
  writeFileSync(join(dir, "outside-file"), "x", "utf8");
  symlinkSync(join(dir, "outside-file"), join(symlinkFileHome, ".claude", "CLAUDE.md"));
  assert.throws(() => installClaudeOpenPetsMemory(symlinkFileHome));

  const oversizedHome = join(dir, "oversized-home");
  mkdirSync(join(oversizedHome, ".claude"), { recursive: true });
  writeFileSync(join(oversizedHome, ".claude", "CLAUDE.md"), "x".repeat(1024 * 1024 + 1), "utf8");
  assert.throws(() => installClaudeOpenPetsMemory(oversizedHome));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("Claude memory validation passed.");

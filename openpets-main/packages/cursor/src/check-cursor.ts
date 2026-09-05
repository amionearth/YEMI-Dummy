import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildCursorOpenPetsRule,
  buildCursorRulesPreview,
  classifyCursorRulesStatus,
  cursorRulesEndMarker,
  cursorRulesStartMarker,
  executeCursorRulesWrite,
  getCursorProjectRulesPath,
  isManagedCursorOpenPetsRule,
  maxCursorRulesBytes,
  planCursorRulesInstall,
  planCursorRulesRemove,
  planCursorRulesReplace,
  readCursorOpenPetsRules,
} from "./cursor-rules.js";
import {
  buildCursorMcpEntry,
  formatCursorMcpConfig,
  getCursorGlobalMcpPath,
  getCursorProjectMcpPath,
  isValidPetId,
  validateOpenPetsPetId,
} from "./cursor-mcp.js";
import {
  classifyCursorMcpStatus,
  executeCursorMcpWrite,
  maxCursorConfigBytes,
  planCursorMcpInstall,
  planCursorMcpRemove,
  planCursorMcpReplace,
  readCursorMcpConfig,
} from "./cursor-status.js";
import { buildOpenPetsOnlyPreview, redactCursorConfig } from "./cursor-previews.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "openpets-cursor-")));

try {
  // Test pet ID validation
  assert.equal(isValidPetId("fixer"), true);
  assert.equal(isValidPetId("my_pet-123"), true);
  assert.equal(isValidPetId("a"), true);
  assert.equal(isValidPetId("a".repeat(64)), true);
  assert.equal(isValidPetId(""), false);
  assert.equal(isValidPetId("-invalid"), false);
  assert.equal(isValidPetId("_invalid"), false);
  assert.equal(isValidPetId("invalid/slash"), false);
  assert.equal(isValidPetId("a".repeat(65)), false);
  assert.equal(validateOpenPetsPetId("fixer"), "fixer");
  assert.throws(() => validateOpenPetsPetId("bad/pet"));
  assert.throws(() => validateOpenPetsPetId(""));

  // Test MCP entry building
  const publishedEntry = buildCursorMcpEntry({ mcpVersion: "2.0.6", petId: "fixer" });
  assert.deepEqual(publishedEntry, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
  });

  const publishedNoPet = buildCursorMcpEntry({ mcpVersion: "2.0.6" });
  assert.deepEqual(publishedNoPet, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@open-pets/mcp@2.0.6"],
  });
  assert.throws(() => buildCursorMcpEntry({ mcpVersion: "latest" }));

  const localEntry = buildCursorMcpEntry({
    mcpVersion: "2.0.6",
    petId: "helper",
    commandMode: "local",
    mcpEntryPath: join(root, "mcp.js"),
  });
  assert.deepEqual(localEntry, {
    type: "stdio",
    command: "node",
    args: [join(root, "mcp.js"), "--pet", "helper"],
  });

  assert.throws(() => buildCursorMcpEntry({ mcpVersion: "2.0.6", commandMode: "local", mcpEntryPath: "relative.js" }));

  // Test config formatting
  const formatted = formatCursorMcpConfig({ mcpVersion: "2.0.6", petId: "fixer" });
  assert.deepEqual(formatted, {
    mcpServers: {
      openpets: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
      },
    },
  });

  // Test path helpers
  assert.equal(getCursorGlobalMcpPath(join(root, "home")), join(root, "home", ".cursor", "mcp.json"));
  assert.equal(getCursorProjectMcpPath(join(root, "project")), join(root, "project", ".cursor", "mcp.json"));

  // Test missing config classification
  const missingPath = join(root, "missing", "mcp.json");
  const missingResult = readCursorMcpConfig(missingPath);
  assert.equal(missingResult.ok, true);
  if (missingResult.ok) {
    assert.equal(missingResult.exists, false);
    assert.deepEqual(missingResult.config, {});
  }

  const missingStatus = classifyCursorMcpStatus(missingResult, missingPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(missingStatus.status, "missing");
  assert.equal(missingStatus.canInstall, true);
  assert.equal(missingStatus.canReplace, false);
  assert.equal(missingStatus.canRemove, false);

  const unsafeBasePath = join(root, "file-parent");
  writeFileSync(unsafeBasePath, "not a directory", "utf8");
  const unsafeMissingPath = join(unsafeBasePath, ".cursor", "mcp.json");
  const unsafeMissingResult = readCursorMcpConfig(unsafeMissingPath);
  assert.equal(unsafeMissingResult.ok, false);
  if (!unsafeMissingResult.ok) {
    assert.equal(unsafeMissingResult.reason, "unsafe-path");
  }
  const unsafeMissingStatus = classifyCursorMcpStatus(unsafeMissingResult, unsafeMissingPath, { mcpVersion: "2.0.6" });
  assert.equal(unsafeMissingStatus.status, "invalid");
  assert.equal(unsafeMissingStatus.canInstall, false);

  // Test empty config classification
  const emptyDir = join(root, "empty");
  mkdirSync(emptyDir);
  const emptyPath = join(emptyDir, "mcp.json");
  writeFileSync(emptyPath, "", "utf8");
  const emptyResult = readCursorMcpConfig(emptyPath);
  assert.equal(emptyResult.ok, true);
  if (emptyResult.ok) {
    assert.equal(emptyResult.exists, true);
    assert.deepEqual(emptyResult.config, {});
  }

  const emptyStatus = classifyCursorMcpStatus(emptyResult, emptyPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(emptyStatus.status, "missing");
  assert.equal(emptyStatus.canInstall, true);

  // Test installed status
  const installedDir = join(root, "installed");
  mkdirSync(installedDir);
  const installedPath = join(installedDir, "mcp.json");
  const installedConfig = formatCursorMcpConfig({ mcpVersion: "2.0.6", petId: "fixer" });
  writeFileSync(installedPath, JSON.stringify(installedConfig, null, 2), "utf8");

  const installedResult = readCursorMcpConfig(installedPath);
  assert.equal(installedResult.ok, true);
  const installedStatus = classifyCursorMcpStatus(installedResult, installedPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(installedStatus.status, "installed");
  assert.equal(installedStatus.canInstall, false);
  assert.equal(installedStatus.canReplace, false);
  assert.equal(installedStatus.canRemove, true);
  const installedReplacePlan = planCursorMcpReplace(installedPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("ok" in installedReplacePlan, true);
  if ("ok" in installedReplacePlan) {
    assert.equal(installedReplacePlan.ok, false);
  }

  // Test needs-update status for old version
  const oldVersionDir = join(root, "old-version");
  mkdirSync(oldVersionDir);
  const oldVersionPath = join(oldVersionDir, "mcp.json");
  const oldVersionConfig = formatCursorMcpConfig({ mcpVersion: "2.0.5", petId: "fixer" });
  writeFileSync(oldVersionPath, JSON.stringify(oldVersionConfig, null, 2), "utf8");

  const oldVersionResult = readCursorMcpConfig(oldVersionPath);
  const oldVersionStatus = classifyCursorMcpStatus(oldVersionResult, oldVersionPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(oldVersionStatus.status, "needs-update");
  assert.equal(oldVersionStatus.canInstall, true);
  assert.equal(oldVersionStatus.canReplace, true);
  assert.equal(oldVersionStatus.canRemove, true);

  // Test needs-update status for different pet
  const diffPetDir = join(root, "diff-pet");
  mkdirSync(diffPetDir);
  const diffPetPath = join(diffPetDir, "mcp.json");
  const diffPetConfig = formatCursorMcpConfig({ mcpVersion: "2.0.6", petId: "helper" });
  writeFileSync(diffPetPath, JSON.stringify(diffPetConfig, null, 2), "utf8");

  const diffPetResult = readCursorMcpConfig(diffPetPath);
  const diffPetStatus = classifyCursorMcpStatus(diffPetResult, diffPetPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(diffPetStatus.status, "needs-update");

  // Test conflict status for non-OpenPets openpets entry
  const conflictDir = join(root, "conflict");
  mkdirSync(conflictDir);
  const conflictPath = join(conflictDir, "mcp.json");
  const conflictConfig = {
    mcpServers: {
      openpets: { type: "stdio", command: "custom", args: ["mcp"] },
    },
  };
  writeFileSync(conflictPath, JSON.stringify(conflictConfig, null, 2), "utf8");

  const conflictResult = readCursorMcpConfig(conflictPath);
  const conflictStatus = classifyCursorMcpStatus(conflictResult, conflictPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(conflictStatus.status, "conflict");
  assert.equal(conflictStatus.canInstall, false);
  assert.equal(conflictStatus.canReplace, true);
  assert.equal(conflictStatus.canRemove, false);

  const unpinnedDir = join(root, "unpinned");
  mkdirSync(unpinnedDir);
  const unpinnedPath = join(unpinnedDir, "mcp.json");
  writeFileSync(unpinnedPath, JSON.stringify({ mcpServers: { openpets: { type: "stdio", command: "npx", args: ["-y", "@open-pets/mcp@latest"] } } }), "utf8");
  const unpinnedStatus = classifyCursorMcpStatus(readCursorMcpConfig(unpinnedPath), unpinnedPath, { mcpVersion: "2.0.6" });
  assert.equal(unpinnedStatus.status, "conflict");

  // Test invalid status for parse error
  const parseErrorDir = join(root, "parse-error");
  mkdirSync(parseErrorDir);
  const parseErrorPath = join(parseErrorDir, "mcp.json");
  writeFileSync(parseErrorPath, "{ invalid json", "utf8");

  const parseErrorResult = readCursorMcpConfig(parseErrorPath);
  assert.equal(parseErrorResult.ok, false);
  if (!parseErrorResult.ok) {
    assert.equal(parseErrorResult.reason, "parse");
  }

  const parseErrorStatus = classifyCursorMcpStatus(parseErrorResult, parseErrorPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(parseErrorStatus.status, "invalid");
  assert.equal(parseErrorStatus.canInstall, false);

  // Test invalid status for oversized file
  const oversizedDir = join(root, "oversized");
  mkdirSync(oversizedDir);
  const oversizedPath = join(oversizedDir, "mcp.json");
  const largeContent = JSON.stringify({ data: "x".repeat(maxCursorConfigBytes + 1000) });
  writeFileSync(oversizedPath, largeContent, "utf8");

  const oversizedResult = readCursorMcpConfig(oversizedPath);
  assert.equal(oversizedResult.ok, false);
  if (!oversizedResult.ok) {
    assert.equal(oversizedResult.reason, "size");
  }

  // Test symlink rejection
  const symlinkDir = join(root, "symlink-test");
  mkdirSync(symlinkDir);
  const realFile = join(symlinkDir, "real.json");
  const symlinkFile = join(symlinkDir, "symlink.json");
  writeFileSync(realFile, "{}", "utf8");
  symlinkSync(realFile, symlinkFile);

  const symlinkResult = readCursorMcpConfig(symlinkFile);
  assert.equal(symlinkResult.ok, false);
  if (!symlinkResult.ok) {
    assert.equal(symlinkResult.reason, "symlink");
  }

  const danglingConfigSymlink = join(symlinkDir, "dangling-config.json");
  symlinkSync(join(symlinkDir, "missing-config.json"), danglingConfigSymlink);
  const danglingConfigResult = readCursorMcpConfig(danglingConfigSymlink);
  assert.equal(danglingConfigResult.ok, false);
  if (!danglingConfigResult.ok) {
    assert.equal(danglingConfigResult.reason, "symlink");
  }

  // Test non-regular file rejection
  const nonRegularDir = join(root, "non-regular");
  mkdirSync(nonRegularDir);
  const directoryAsConfig = join(nonRegularDir, "mcp.json");
  mkdirSync(directoryAsConfig);
  const nonRegularResult = readCursorMcpConfig(directoryAsConfig);
  assert.equal(nonRegularResult.ok, false);
  if (!nonRegularResult.ok) {
    assert.equal(nonRegularResult.reason, "not-regular");
  }
  const nonRegularPlan = planCursorMcpInstall(directoryAsConfig, { mcpVersion: "2.0.6" });
  assert.equal("ok" in nonRegularPlan, true);
  if ("ok" in nonRegularPlan) {
    assert.equal(nonRegularPlan.ok, false);
  }

  const ioStatus = classifyCursorMcpStatus({ ok: false, reason: "io", message: "simulated io failure" }, join(root, "io", "mcp.json"), { mcpVersion: "2.0.6" });
  assert.equal(ioStatus.status, "error");
  assert.equal(ioStatus.canInstall, false);
  assert.equal(ioStatus.canReplace, false);
  assert.equal(ioStatus.canRemove, false);

  // Test non-object top-level config
  const nonObjectDir = join(root, "non-object");
  mkdirSync(nonObjectDir);
  const nonObjectPath = join(nonObjectDir, "mcp.json");
  writeFileSync(nonObjectPath, "[]", "utf8");

  const nonObjectResult = readCursorMcpConfig(nonObjectPath);
  assert.equal(nonObjectResult.ok, false);
  if (!nonObjectResult.ok) {
    assert.equal(nonObjectResult.reason, "invalid-schema");
  }

  // Test non-object mcpServers
  const badServersDir = join(root, "bad-servers");
  mkdirSync(badServersDir);
  const badServersPath = join(badServersDir, "mcp.json");
  writeFileSync(badServersPath, JSON.stringify({ mcpServers: [] }), "utf8");

  const badServersResult = readCursorMcpConfig(badServersPath);
  assert.equal(badServersResult.ok, false);
  if (!badServersResult.ok) {
    assert.equal(badServersResult.reason, "invalid-schema");
  }

  // Test malformed mcpServers.openpets (not an object)
  const malformedEntryDir = join(root, "malformed-entry");
  mkdirSync(malformedEntryDir);
  const malformedEntryPath = join(malformedEntryDir, "mcp.json");
  writeFileSync(malformedEntryPath, JSON.stringify({ mcpServers: { openpets: "string" } }), "utf8");

  const malformedEntryResult = readCursorMcpConfig(malformedEntryPath);
  assert.equal(malformedEntryResult.ok, true);
  const malformedEntryStatus = classifyCursorMcpStatus(malformedEntryResult, malformedEntryPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal(malformedEntryStatus.status, "conflict");

  // Test backup creation
  const backupDir = join(root, "backup");
  mkdirSync(backupDir);
  const backupPath = join(backupDir, "mcp.json");
  const originalContent = JSON.stringify({ mcpServers: { other: { type: "stdio", command: "test", args: [] } } }, null, 2);
  writeFileSync(backupPath, originalContent, "utf8");

  const installPlan = planCursorMcpInstall(backupPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("targetPath" in installPlan, true);
  if ("targetPath" in installPlan) {
    assert.equal(installPlan.backupPath !== undefined, true);
    executeCursorMcpWrite(installPlan);
    assert.equal(existsSync(backupPath), true);
    assert.equal(existsSync(installPlan.backupPath!), true);
    const backupContent = readFileSync(installPlan.backupPath!, "utf8");
    assert.equal(backupContent, originalContent);
  }

  // Test atomic write result
  const atomicDir = join(root, "atomic");
  mkdirSync(atomicDir);
  const atomicPath = join(atomicDir, "mcp.json");

  const atomicPlan = planCursorMcpInstall(atomicPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("targetPath" in atomicPlan, true);
  if ("targetPath" in atomicPlan) {
    executeCursorMcpWrite(atomicPlan);
    assert.equal(existsSync(atomicPath), true);
    const writtenContent = JSON.parse(readFileSync(atomicPath, "utf8"));
    assert.deepEqual(writtenContent.mcpServers.openpets, {
      type: "stdio",
      command: "npx",
      args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
    });
  }

  // Test uninstall removes only OpenPets entry
  const uninstallDir = join(root, "uninstall");
  mkdirSync(uninstallDir);
  const uninstallPath = join(uninstallDir, "mcp.json");
  const uninstallConfig = {
    mcpServers: {
      openpets: { type: "stdio", command: "npx", args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"] },
      other: { type: "stdio", command: "test", args: [] },
    },
    otherField: "keep",
  };
  writeFileSync(uninstallPath, JSON.stringify(uninstallConfig, null, 2), "utf8");

  const removePlan = planCursorMcpRemove(uninstallPath);
  assert.equal("targetPath" in removePlan, true);
  if ("targetPath" in removePlan) {
    executeCursorMcpWrite(removePlan);
    const removedContent = JSON.parse(readFileSync(uninstallPath, "utf8"));
    assert.equal(removedContent.mcpServers.openpets, undefined);
    assert.deepEqual(removedContent.mcpServers.other, { type: "stdio", command: "test", args: [] });
    assert.equal(removedContent.otherField, "keep");
  }

  // Test no write on invalid
  const noWriteInvalidDir = join(root, "no-write-invalid");
  mkdirSync(noWriteInvalidDir);
  const noWriteInvalidPath = join(noWriteInvalidDir, "mcp.json");
  writeFileSync(noWriteInvalidPath, "{ invalid", "utf8");

  const noWriteInvalidPlan = planCursorMcpInstall(noWriteInvalidPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("ok" in noWriteInvalidPlan, true);
  if ("ok" in noWriteInvalidPlan) {
    assert.equal(noWriteInvalidPlan.ok, false);
  }

  // Test no write on conflict unless explicit replace
  const noWriteConflictDir = join(root, "no-write-conflict");
  mkdirSync(noWriteConflictDir);
  const noWriteConflictPath = join(noWriteConflictDir, "mcp.json");
  writeFileSync(noWriteConflictPath, JSON.stringify({ mcpServers: { openpets: { type: "stdio", command: "custom", args: [] } } }), "utf8");

  const noWriteConflictPlan = planCursorMcpInstall(noWriteConflictPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("ok" in noWriteConflictPlan, true);
  if ("ok" in noWriteConflictPlan) {
    assert.equal(noWriteConflictPlan.ok, false);
  }
  const noRemoveConflictPlan = planCursorMcpRemove(noWriteConflictPath);
  assert.equal("ok" in noRemoveConflictPlan, true);
  if ("ok" in noRemoveConflictPlan) {
    assert.equal(noRemoveConflictPlan.ok, false);
  }

  // Test explicit replace overwrites only openpets and preserves unrelated servers
  const replaceDir = join(root, "replace");
  mkdirSync(replaceDir);
  const replacePath = join(replaceDir, "mcp.json");
  const replaceConfig = {
    mcpServers: {
      openpets: { type: "stdio", command: "custom", args: [] },
      other: { type: "stdio", command: "test", args: [] },
    },
    topLevelField: "preserve",
  };
  writeFileSync(replacePath, JSON.stringify(replaceConfig, null, 2), "utf8");

  const replacePlan = planCursorMcpReplace(replacePath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("targetPath" in replacePlan, true);
  if ("targetPath" in replacePlan) {
    executeCursorMcpWrite(replacePlan);
    const replacedContent = JSON.parse(readFileSync(replacePath, "utf8"));
    assert.deepEqual(replacedContent.mcpServers.openpets, {
      type: "stdio",
      command: "npx",
      args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
    });
    assert.deepEqual(replacedContent.mcpServers.other, { type: "stdio", command: "test", args: [] });
    assert.equal(replacedContent.topLevelField, "preserve");
  }

  // Test preview redaction
  const redactedConfig = {
    mcpServers: {
      openpets: { type: "stdio", command: "npx", args: ["-y", "@open-pets/mcp@2.0.6"] },
      other: {
        type: "stdio",
        command: "test",
        args: ["--token=secret123", "--api-key=abc"],
        env: { SECRET: "hidden", TOKEN: "hidden" },
        headers: { Authorization: "Bearer token123" },
      },
    },
  };

  const redacted = redactCursorConfig(redactedConfig);
  assert.deepEqual(redacted.mcpServers?.openpets, { type: "stdio", command: "npx", args: ["-y", "@open-pets/mcp@2.0.6"] });
  const otherServer = redacted.mcpServers?.other as Record<string, unknown>;
  assert.deepEqual(otherServer.args, ["--token=[REDACTED]", "--api-key=[REDACTED]"]);
  assert.equal(otherServer.env, "[REDACTED]");
  assert.equal(otherServer.headers, "[REDACTED]");

  // Test recursive and case-insensitive redaction
  const recursiveConfig = {
    mcpServers: {
      server1: {
        type: "stdio",
        command: "test",
        ENV: { secretValue: "hidden" },
        Auth: { password: "secret" },
        nested: {
          TOKEN: "bearer123",
          credentials: { apiKey: "key123" },
        },
      },
    },
  };

  const recursiveRedacted = redactCursorConfig(recursiveConfig);
  const server1 = recursiveRedacted.mcpServers?.server1 as Record<string, unknown>;
  assert.equal(server1.ENV, "[REDACTED]");
  assert.equal(server1.Auth, "[REDACTED]");
  const nested = server1.nested as Record<string, unknown>;
  assert.equal(nested.TOKEN, "[REDACTED]");
  assert.equal(nested.credentials, "[REDACTED]");

  // Test URL with token-like query params redaction
  const urlConfig = {
    mcpServers: {
      server1: {
        type: "stdio",
        command: "test",
        args: ["https://example.com/api?token=secret&other=value"],
      },
    },
  };

  const urlRedacted = redactCursorConfig(urlConfig);
  const urlServer = urlRedacted.mcpServers?.server1 as Record<string, unknown>;
  const urlArgs = urlServer.args as string[];
  assert.ok(urlArgs[0].includes("[REDACTED]"));
  assert.ok(!urlArgs[0].includes("secret"));

  // Test OpenPets-only preview
  const preview = buildOpenPetsOnlyPreview({ mcpVersion: "2.0.6", petId: "fixer" });
  assert.deepEqual(preview.openpets, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
  });

  // Test existing unrelated MCP servers preserved during install
  const preserveDir = join(root, "preserve");
  mkdirSync(preserveDir);
  const preservePath = join(preserveDir, "mcp.json");
  const preserveConfig = {
    mcpServers: {
      other: { type: "stdio", command: "test", args: [] },
    },
    topLevel: "keep",
  };
  writeFileSync(preservePath, JSON.stringify(preserveConfig, null, 2), "utf8");

  const preservePlan = planCursorMcpInstall(preservePath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("targetPath" in preservePlan, true);
  if ("targetPath" in preservePlan) {
    executeCursorMcpWrite(preservePlan);
    const preservedContent = JSON.parse(readFileSync(preservePath, "utf8"));
    assert.deepEqual(preservedContent.mcpServers.other, { type: "stdio", command: "test", args: [] });
    assert.equal(preservedContent.topLevel, "keep");
    assert.deepEqual(preservedContent.mcpServers.openpets, {
      type: "stdio",
      command: "npx",
      args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
    });
  }

  // Test symlink parent rejection
  const symlinkParentDir = join(root, "symlink-parent");
  const realParent = join(root, "real-parent");
  mkdirSync(realParent);
  symlinkSync(realParent, symlinkParentDir);

  const symlinkParentPath = join(symlinkParentDir, "mcp.json");
  const symlinkParentPlan = planCursorMcpInstall(symlinkParentPath, { mcpVersion: "2.0.6", petId: "fixer" });
  assert.equal("ok" in symlinkParentPlan, true);
  if ("ok" in symlinkParentPlan) {
    assert.equal(symlinkParentPlan.ok, false);
  }

  // Test nested symlink ancestor rejection for missing and existing config files
  const nestedReal = join(root, "nested-real");
  mkdirSync(join(nestedReal, "sub", ".cursor"), { recursive: true });
  const nestedLink = join(root, "nested-link");
  symlinkSync(nestedReal, nestedLink);
  const nestedMissingThroughLink = join(nestedLink, "missing", ".cursor", "mcp.json");
  const nestedMissingResult = readCursorMcpConfig(nestedMissingThroughLink);
  assert.equal(nestedMissingResult.ok, false);
  if (!nestedMissingResult.ok) {
    assert.equal(nestedMissingResult.reason, "symlink");
  }
  const nestedExistingThroughLink = join(nestedLink, "sub", ".cursor", "mcp.json");
  writeFileSync(join(nestedReal, "sub", ".cursor", "mcp.json"), "{}", "utf8");
  const nestedExistingResult = readCursorMcpConfig(nestedExistingThroughLink);
  assert.equal(nestedExistingResult.ok, false);
  if (!nestedExistingResult.ok) {
    assert.equal(nestedExistingResult.reason, "symlink");
  }

  const danglingLink = join(root, "dangling-link");
  symlinkSync(join(root, "missing-target"), danglingLink);
  const danglingPath = join(danglingLink, ".cursor", "mcp.json");
  const danglingResult = readCursorMcpConfig(danglingPath);
  assert.equal(danglingResult.ok, false);
  if (!danglingResult.ok) {
    assert.equal(danglingResult.reason, "symlink");
  }

  const traversalPath = `${nestedLink}/../traversal/.cursor/mcp.json`;
  const traversalResult = readCursorMcpConfig(traversalPath);
  assert.equal(traversalResult.ok, false);
  if (!traversalResult.ok) {
    assert.equal(traversalResult.reason, "unsafe-path");
  }

  // Test empty mcpServers kept as empty object after remove
  const emptyAfterRemoveDir = join(root, "empty-after-remove");
  mkdirSync(emptyAfterRemoveDir);
  const emptyAfterRemovePath = join(emptyAfterRemoveDir, "mcp.json");
  writeFileSync(emptyAfterRemovePath, JSON.stringify({ mcpServers: { openpets: { type: "stdio", command: "npx", args: ["-y", "@open-pets/mcp@2.0.6"] } } }), "utf8");

  const emptyRemovePlan = planCursorMcpRemove(emptyAfterRemovePath);
  assert.equal("targetPath" in emptyRemovePlan, true);
  if ("targetPath" in emptyRemovePlan) {
    executeCursorMcpWrite(emptyRemovePlan);
    const emptyRemovedContent = JSON.parse(readFileSync(emptyAfterRemovePath, "utf8"));
    assert.deepEqual(emptyRemovedContent.mcpServers, {});
  }

  // Test Cursor rules path and content generation
  const rulesProject = join(root, "rules-project");
  mkdirSync(rulesProject);
  const rulesPath = getCursorProjectRulesPath(rulesProject);
  assert.equal(rulesPath, join(rulesProject, ".cursor", "rules", "openpets.mdc"));
  const expectedRule = buildCursorOpenPetsRule();
  assert.equal(buildCursorRulesPreview(), expectedRule);
  assert.match(expectedRule, /description: Use OpenPets MCP tools/);
  assert.doesNotMatch(expectedRule, /alwaysApply:\s*true/);
  assert.match(expectedRule, /openpets_say/);
  assert.match(expectedRule, /Do not send prompts, tool input\/output/);

  const missingRulesResult = readCursorOpenPetsRules(rulesProject);
  assert.equal(missingRulesResult.ok, true);
  if (missingRulesResult.ok) {
    assert.equal(missingRulesResult.exists, false);
  }
  const missingRulesStatus = classifyCursorRulesStatus(missingRulesResult, rulesPath);
  assert.equal(missingRulesStatus.status, "missing");
  assert.equal(missingRulesStatus.canInstall, true);
  assert.equal(missingRulesStatus.canReplace, false);
  assert.equal(missingRulesStatus.canRemove, false);

  const rulesInstallPlan = planCursorRulesInstall(rulesProject);
  assert.equal("targetPath" in rulesInstallPlan, true);
  if ("targetPath" in rulesInstallPlan) {
    executeCursorRulesWrite(rulesInstallPlan);
    assert.equal(readFileSync(rulesPath, "utf8"), expectedRule);
  }

  const installedRulesStatus = classifyCursorRulesStatus(readCursorOpenPetsRules(rulesProject), rulesPath);
  assert.equal(installedRulesStatus.status, "installed");
  assert.equal(installedRulesStatus.canInstall, false);
  assert.equal(installedRulesStatus.canRemove, true);
  assert.equal(isManagedCursorOpenPetsRule(expectedRule), true);

  const changedManagedRule = expectedRule.replace("major milestones", "meaningful milestones");
  writeFileSync(rulesPath, changedManagedRule, "utf8");
  const needsUpdateRulesStatus = classifyCursorRulesStatus(readCursorOpenPetsRules(rulesProject), rulesPath);
  assert.equal(needsUpdateRulesStatus.status, "needs-update");
  const updateRulesPlan = planCursorRulesInstall(rulesProject);
  assert.equal("targetPath" in updateRulesPlan, true);
  if ("targetPath" in updateRulesPlan) {
    assert.equal(updateRulesPlan.backupPath !== undefined, true);
    executeCursorRulesWrite(updateRulesPlan);
    assert.equal(readFileSync(rulesPath, "utf8"), expectedRule);
    assert.equal(existsSync(updateRulesPlan.backupPath!), true);
  }

  const removeRulesPlan = planCursorRulesRemove(rulesProject);
  assert.equal("targetPath" in removeRulesPlan, true);
  if ("targetPath" in removeRulesPlan) {
    executeCursorRulesWrite(removeRulesPlan);
    assert.equal(existsSync(rulesPath), false);
    assert.equal(existsSync(join(rulesProject, ".cursor", "rules")), true);
    assert.equal(existsSync(removeRulesPlan.backupPath!), true);
  }

  // Test rules conflicts and marker/frontmatter edge cases
  mkdirSync(join(rulesProject, ".cursor", "rules"), { recursive: true });
  writeFileSync(rulesPath, "User-authored Cursor rule\n", "utf8");
  const unmanagedStatus = classifyCursorRulesStatus(readCursorOpenPetsRules(rulesProject), rulesPath);
  assert.equal(unmanagedStatus.status, "conflict");
  assert.equal(unmanagedStatus.canInstall, false);
  assert.equal(unmanagedStatus.canReplace, true);
  assert.equal(unmanagedStatus.canRemove, false);
  const noWriteRulesConflict = planCursorRulesInstall(rulesProject);
  assert.equal("ok" in noWriteRulesConflict, true);
  if ("ok" in noWriteRulesConflict) {
    assert.equal(noWriteRulesConflict.ok, false);
  }
  const noRemoveRulesConflict = planCursorRulesRemove(rulesProject);
  assert.equal("ok" in noRemoveRulesConflict, true);
  if ("ok" in noRemoveRulesConflict) {
    assert.equal(noRemoveRulesConflict.ok, false);
  }
  const replaceRulesPlan = planCursorRulesReplace(rulesProject);
  assert.equal("targetPath" in replaceRulesPlan, true);
  if ("targetPath" in replaceRulesPlan) {
    assert.equal(replaceRulesPlan.backupPath !== undefined, true);
    executeCursorRulesWrite(replaceRulesPlan);
    assert.equal(readFileSync(rulesPath, "utf8"), expectedRule);
    assert.equal(readFileSync(replaceRulesPlan.backupPath!, "utf8"), "User-authored Cursor rule\n");
  }

  const duplicateMarkers = expectedRule.replace(cursorRulesEndMarker, `${cursorRulesEndMarker}\n${cursorRulesEndMarker}`);
  const reversedMarkers = `---\ndescription: Use OpenPets MCP tools for lightweight coding-status feedback.\n---\n\n${cursorRulesEndMarker}\nbody\n${cursorRulesStartMarker}\n`;
  const missingMarker = expectedRule.replace(cursorRulesStartMarker, "");
  const userBefore = `User note\n${expectedRule}`;
  const userAfter = `${expectedRule}\nUser note\n`;
  const unknownFrontmatter = expectedRule.replace("---\ndescription", "---\nalwaysApply: true\ndescription");
  for (const content of [duplicateMarkers, reversedMarkers, missingMarker, userBefore, userAfter, unknownFrontmatter]) {
    writeFileSync(rulesPath, content, "utf8");
    const status = classifyCursorRulesStatus(readCursorOpenPetsRules(rulesProject), rulesPath);
    assert.equal(status.status, "conflict");
  }

  // Test rules invalid path, symlink, non-regular, and oversized handling
  const rulesFileParentProject = join(root, "rules-file-parent");
  mkdirSync(rulesFileParentProject);
  writeFileSync(join(rulesFileParentProject, ".cursor"), "not a dir", "utf8");
  const rulesFileParentResult = readCursorOpenPetsRules(rulesFileParentProject);
  assert.equal(rulesFileParentResult.ok, false);
  if (!rulesFileParentResult.ok) assert.equal(rulesFileParentResult.reason, "unsafe-path");

  const rulesSymlinkProject = join(root, "rules-symlink");
  const rulesSymlinkOutside = join(root, "rules-outside");
  mkdirSync(rulesSymlinkProject);
  mkdirSync(rulesSymlinkOutside);
  symlinkSync(rulesSymlinkOutside, join(rulesSymlinkProject, ".cursor"));
  const rulesSymlinkResult = readCursorOpenPetsRules(rulesSymlinkProject);
  assert.equal(rulesSymlinkResult.ok, false);
  if (!rulesSymlinkResult.ok) assert.equal(rulesSymlinkResult.reason, "symlink");

  const rulesFileSymlinkProject = join(root, "rules-file-symlink");
  mkdirSync(join(rulesFileSymlinkProject, ".cursor", "rules"), { recursive: true });
  const rulesFileSymlinkTarget = join(root, "rules-file-target.mdc");
  writeFileSync(rulesFileSymlinkTarget, expectedRule, "utf8");
  symlinkSync(rulesFileSymlinkTarget, getCursorProjectRulesPath(rulesFileSymlinkProject));
  const rulesFileSymlinkResult = readCursorOpenPetsRules(rulesFileSymlinkProject);
  assert.equal(rulesFileSymlinkResult.ok, false);
  if (!rulesFileSymlinkResult.ok) assert.equal(rulesFileSymlinkResult.reason, "symlink");
  const rulesFileSymlinkPlan = planCursorRulesInstall(rulesFileSymlinkProject);
  assert.equal("ok" in rulesFileSymlinkPlan, true);
  if ("ok" in rulesFileSymlinkPlan) assert.equal(rulesFileSymlinkPlan.ok, false);

  const danglingRulesSymlinkProject = join(root, "rules-dangling-symlink");
  mkdirSync(join(danglingRulesSymlinkProject, ".cursor", "rules"), { recursive: true });
  symlinkSync(join(root, "missing-rules-target.mdc"), getCursorProjectRulesPath(danglingRulesSymlinkProject));
  const danglingRulesResult = readCursorOpenPetsRules(danglingRulesSymlinkProject);
  assert.equal(danglingRulesResult.ok, false);
  if (!danglingRulesResult.ok) assert.equal(danglingRulesResult.reason, "symlink");

  const nonRegularRulesProject = join(root, "rules-non-regular");
  mkdirSync(join(nonRegularRulesProject, ".cursor", "rules"), { recursive: true });
  mkdirSync(getCursorProjectRulesPath(nonRegularRulesProject));
  const nonRegularRules = readCursorOpenPetsRules(nonRegularRulesProject);
  assert.equal(nonRegularRules.ok, false);
  if (!nonRegularRules.ok) assert.equal(nonRegularRules.reason, "not-regular");
  const nonRegularRulesInstallPlan = planCursorRulesInstall(nonRegularRulesProject);
  assert.equal("ok" in nonRegularRulesInstallPlan, true);
  if ("ok" in nonRegularRulesInstallPlan) assert.equal(nonRegularRulesInstallPlan.ok, false);
  assert.equal(lstatSync(getCursorProjectRulesPath(nonRegularRulesProject)).isDirectory(), true);

  const oversizedRulesProject = join(root, "rules-oversized");
  mkdirSync(join(oversizedRulesProject, ".cursor", "rules"), { recursive: true });
  writeFileSync(getCursorProjectRulesPath(oversizedRulesProject), "x".repeat(maxCursorRulesBytes + 1), "utf8");
  const oversizedRules = readCursorOpenPetsRules(oversizedRulesProject);
  assert.equal(oversizedRules.ok, false);
  if (!oversizedRules.ok) assert.equal(oversizedRules.reason, "size");
  const oversizedBefore = readFileSync(getCursorProjectRulesPath(oversizedRulesProject), "utf8");
  const oversizedInstallPlan = planCursorRulesInstall(oversizedRulesProject);
  assert.equal("ok" in oversizedInstallPlan, true);
  if ("ok" in oversizedInstallPlan) assert.equal(oversizedInstallPlan.ok, false);
  const oversizedRemovePlan = planCursorRulesRemove(oversizedRulesProject);
  assert.equal("ok" in oversizedRemovePlan, true);
  if ("ok" in oversizedRemovePlan) assert.equal(oversizedRemovePlan.ok, false);
  assert.equal(readFileSync(getCursorProjectRulesPath(oversizedRulesProject), "utf8"), oversizedBefore);

  console.error("Cursor validation passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

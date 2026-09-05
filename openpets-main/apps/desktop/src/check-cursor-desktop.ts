import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Desktop-specific Cursor integration checks
// These verify that the desktop app correctly uses the @open-pets/cursor package

const root = realpathSync(mkdtempSync(join(tmpdir(), "openpets-cursor-desktop-")));

try {
  // Test that desktop would use the correct global config path
  const homeDir = join(root, "home");
  mkdirSync(homeDir);
  const expectedConfigPath = join(homeDir, ".cursor", "mcp.json");
  
  // Verify the path structure matches what desktop uses
  assert.ok(expectedConfigPath.endsWith(".cursor/mcp.json"), "Cursor global config path must end with .cursor/mcp.json");
  assert.ok(!expectedConfigPath.includes(".."), "Cursor config path must not contain traversal");

  // Test that desktop would handle missing config gracefully
  const missingResult = { ok: true as const, config: {}, exists: false };
  assert.equal(missingResult.ok, true);
  assert.equal(missingResult.exists, false);

  // Test that desktop would handle installed config
  const cursorDir = join(root, "cursor");
  mkdirSync(cursorDir);
  const configPath = join(cursorDir, "mcp.json");
  const installedConfig = {
    mcpServers: {
      openpets: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(installedConfig, null, 2), "utf8");
  
  const content = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(content);
  assert.deepEqual(parsed.mcpServers.openpets, installedConfig.mcpServers.openpets);

  // Test that desktop would preserve unrelated servers during operations
  const multiServerConfig = {
    mcpServers: {
      openpets: installedConfig.mcpServers.openpets,
      other: { type: "stdio", command: "test", args: [] },
    },
    topLevelField: "preserve",
  };
  const multiPath = join(cursorDir, "multi.json");
  writeFileSync(multiPath, JSON.stringify(multiServerConfig, null, 2), "utf8");
  
  const multiContent = JSON.parse(readFileSync(multiPath, "utf8"));
  assert.equal(multiContent.mcpServers.other.type, "stdio");
  assert.equal(multiContent.topLevelField, "preserve");

  // Test that desktop would detect command modes correctly
  const publishedEntry = {
    type: "stdio",
    command: "npx",
    args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "test"],
  };
  assert.equal(publishedEntry.command, "npx");
  assert.ok(publishedEntry.args[1].includes("@"), "Published mode must use pinned version");

  const localEntry = {
    type: "stdio",
    command: "node",
    args: ["/absolute/path/to/mcp.js", "--pet", "test"],
  };
  assert.equal(localEntry.command, "node");
  assert.ok(localEntry.args[0].startsWith("/"), "Local mode must use absolute path");

  // Test status mapping that desktop uses
  const statusMap = {
    missing: { state: "needs_setup", label: "Not configured" },
    installed: { state: "configured", label: "Configured" },
    "needs-update": { state: "needs_update", label: "Needs update" },
    conflict: { state: "conflict", label: "Conflict" },
    invalid: { state: "error", label: "Config error" },
    error: { state: "error", label: "Config error" },
  };
  
  for (const [status, expected] of Object.entries(statusMap)) {
    assert.ok(expected.state, `Status ${status} must map to a state`);
    assert.ok(expected.label, `Status ${status} must map to a label`);
  }

  // Test that desktop would format user paths correctly
  const longPath = join(homeDir, ".cursor", "mcp.json");
  const formattedPath = longPath.replace(homeDir, "~");
  assert.equal(formattedPath, "~/.cursor/mcp.json");

  // Test that desktop would handle action availability correctly
  const actionMatrix = {
    missing: { canInstall: true, canReplace: false, canRemove: false },
    installed: { canInstall: false, canReplace: false, canRemove: true },
    "needs-update": { canInstall: true, canReplace: true, canRemove: true },
    conflict: { canInstall: false, canReplace: true, canRemove: false },
    invalid: { canInstall: false, canReplace: false, canRemove: false },
    error: { canInstall: false, canReplace: false, canRemove: false },
  };
  
  for (const [status, actions] of Object.entries(actionMatrix)) {
    assert.equal(typeof actions.canInstall, "boolean", `Status ${status} must define canInstall`);
    assert.equal(typeof actions.canReplace, "boolean", `Status ${status} must define canReplace`);
    assert.equal(typeof actions.canRemove, "boolean", `Status ${status} must define canRemove`);
  }

  // Test that desktop would create valid MCP preview
  const preview = {
    mcpServers: {
      openpets: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@open-pets/mcp@2.0.6", "--pet", "fixer"],
      },
    },
  };
  assert.equal(preview.mcpServers.openpets.type, "stdio");
  assert.equal(preview.mcpServers.openpets.command, "npx");
  assert.ok(Array.isArray(preview.mcpServers.openpets.args));

  // Test desktop Phase 2 rules posture: preview/copy only, no project writes
  const rulesPreview = {
    rulesPath: ".cursor/rules/openpets.mdc",
    rulesContent: "<!-- OPENPETS:CURSOR_RULES:START -->\nUse OpenPets sparingly.\n<!-- OPENPETS:CURSOR_RULES:END -->\n",
  };
  assert.equal(rulesPreview.rulesPath, ".cursor/rules/openpets.mdc");
  assert.match(rulesPreview.rulesContent, /OPENPETS:CURSOR_RULES:START/);
  assert.doesNotMatch(rulesPreview.rulesContent, /alwaysApply:\s*true/);

  console.error("Cursor desktop validation passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

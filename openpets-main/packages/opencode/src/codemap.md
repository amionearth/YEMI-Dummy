# packages/opencode/src/

## Files

- **index.ts**: Barrel export (6 lines). Re-exports all public modules.
- **plugin.ts**: OpenCode plugin definition (10 lines). Default export with `id` and `server` factory.
- **opencode-plugin-runtime.ts**: Plugin hook implementations (229 lines). `createOpenPetsOpenCodeHooks()`, event classification, tool reaction mapping, lease management, throttling.
- **opencode-config.ts**: Config file management (221 lines). Path resolution, JSONC parsing, safe file operations, atomic writes with backups.
- **opencode-project-setup.ts**: Project-level setup (182 lines). `prepareOpenCodeProjectSetup()`, `writePreparedOpenCodeProjectSetup()`, instruction block management.
- **opencode-global-setup.ts**: Global setup management (354 lines). `prepareOpenCodeGlobalSetup()`, `prepareOpenCodeGlobalRemove()`, cleanup writes, doctor command, config precedence handling, global state classification.
- **opencode-status.ts**: Status classification (147 lines). `classifyOpenCodeMcpStatus()`, `classifyOpenCodeInstructionsStatus()`, `classifyOpenCodePluginStatus()`, managed MCP/plugin/instruction detection helpers, OpenPets-like entry detection.
- **opencode-previews.ts**: Config entry builders (55 lines). `buildOpenCodeMcpEntry()`, `buildOpenCodePluginPreview()`, `buildOpenCodeInstructionPath()`, `formatOpenCodeMcpConfig()`, `validateOpenPetsPetArg()`.
- **check-opencode-foundation.ts**: Contract validation (excluded from detailed documentation).
- **check-opencode-plugin.ts**: Plugin contract validation (excluded from detailed documentation).

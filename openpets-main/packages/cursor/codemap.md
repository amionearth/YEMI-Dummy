# Package: @open-pets/cursor

## Responsibility

Pure Node.js package for Cursor editor integration file management. Manages OpenPets MCP entries in Cursor's `mcp.json` configuration files and optional project-local Cursor rules guidance. Provides safe, atomic file operations with validation, backup, and redaction capabilities.

## Design/Patterns

### Config Path Resolution
- **Global config**: `<homeDir>/.cursor/mcp.json` - user-wide MCP settings
- **Project config**: `<projectDir>/.cursor/mcp.json` - project-specific MCP settings
- **Rules path**: `<projectDir>/.cursor/rules/openpets.mdc` - project-local Cursor rules
- All APIs accept explicit `configPath` for custom locations

### Safety-First File Operations
- Strict JSON only (no JSONC comments)
- Maximum config size: 256 KiB (rules: 64 KiB)
- Reject symlinks at any path level (config file, parent directories, ancestors)
- Reject non-regular files (directories, sockets, etc.)
- Validate parent directories before creating `.cursor` folders
- Atomic writes using temp files and atomic rename
- Automatic backup creation before modifications
- Private file permissions (0o600) where supported

### Status Classification (MCP & Rules)
- `missing`: No config file or no OpenPets entry exists
- `installed`: Matching OpenPets entry present and up-to-date
- `needs-update`: Old version, different pet, or content drift
- `conflict`: Non-OpenPets entry blocking installation
- `invalid`: Parse error, oversized, unsafe path, malformed schema
- `error`: Unexpected I/O failure

### MCP Entry Format
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@open-pets/mcp@VERSION", "--pet", "PET_ID"]
}
```

### Managed Entry Detection
- Published mode: `npx -y @open-pets/mcp@SEMVER [--pet PET]`
- Local mode: `node <absolute-path> [--pet PET]`
- Validates semantic versioning and pet ID format
- Rejects unpinned versions (e.g., `@latest`)

### Sensitive Data Redaction
Recursive, case-insensitive redaction of:
- Keys: `env`, `headers`, `auth`, `authorization`, `token`, `secret`, `password`, `credentials`
- URL query parameters matching sensitive patterns
- String values containing `token=`, `api_key=`, `secret=`, `password=`, `auth=`

### Cursor Rules Management
- Exact whole-file ownership requires recognized frontmatter
- Requires exactly one ordered `OPENPETS:CURSOR_RULES:START/END` marker pair
- Rejects duplicate, reversed, or missing markers
- Rejects user content before/after managed block
- Desktop uses preview/copy only; CLI writes project-local rules

## Flow

### MCP Installation Flow
1. **Read** existing config via `readCursorMcpConfig(path)`
2. **Classify** status via `classifyCursorMcpStatus(result, path, expected)`
3. **Plan** operation via `planCursorMcpInstall(path, options, allowReplace?)`
4. **Execute** write via `executeCursorMcpWrite(plan)`
5. Atomic write creates temp file, backs up existing, renames to target

### MCP Replacement Flow
1. Read and classify existing config
2. Verify status is `needs-update`, `conflict`, or `installed`
3. Plan replace via `planCursorMcpReplace(path, options)`
4. Execute preserves unrelated MCP servers and top-level fields

### MCP Removal Flow
1. Read and classify existing config
2. Verify entry is managed by OpenPets (not conflict)
3. Plan remove via `planCursorMcpRemove(path)`
4. Execute removes only `mcpServers.openpets`, preserves other servers
5. Empty `mcpServers` kept as `{}` after removal

### Rules Installation Flow
1. **Read** existing rules via `readCursorOpenPetsRules(projectDir)`
2. **Classify** status via `classifyCursorRulesStatus(result, path, expected?)`
3. **Plan** via `planCursorRulesInstall(projectDir, allowReplace?)`
4. **Execute** via `executeCursorRulesWrite(plan)`
5. Managed content includes frontmatter + START/END markers

### Preview/Redaction Flow
1. Build preview via `buildOpenPetsOnlyPreview(options)`
2. Redact sensitive config via `redactCursorConfig(config)`
3. Safe for logging and UI display

## Integration

### Entry Points
- `src/index.ts`: Public API exports (re-exports all modules)
- `src/cursor-mcp.ts`: MCP entry builders and path utilities
- `src/cursor-status.ts`: Status classification and config read/write operations
- `src/cursor-previews.ts`: Config preview and redaction helpers
- `src/cursor-rules.ts`: Project-local Cursor rules preview/status/write/remove helpers
- `src/check-cursor.ts`: Contract validation tests (runs via `npm test`)

### Exported APIs

**From cursor-mcp.ts:**
- `buildCursorMcpEntry(options)`: Build MCP entry object
- `formatCursorMcpConfig(options)`: Build full config with openpets entry
- `getCursorGlobalMcpPath(homeDir)`: Get global config path
- `getCursorProjectMcpPath(projectDir)`: Get project config path
- `validateOpenPetsPetId(id)`: Validate and return pet ID
- `isValidPetId(id)`: Check if pet ID is valid

**From cursor-status.ts:**
- `classifyCursorMcpStatus(result, path, expected)`: Classify config status
- `readCursorMcpConfig(path)`: Read and validate config file
- `planCursorMcpInstall(path, options, allowReplace?)`: Plan install operation
- `planCursorMcpReplace(path, options)`: Plan replace operation
- `planCursorMcpRemove(path)`: Plan remove operation
- `executeCursorMcpWrite(plan)`: Execute planned write atomically
- `isManagedOpenPetsMcpEntry(value)`: Check if entry is OpenPets-managed
- `maxCursorConfigBytes`: 256 KiB limit constant

**From cursor-previews.ts:**
- `buildOpenPetsOnlyPreview(options)`: Build OpenPets-only preview
- `redactCursorConfig(config)`: Redact sensitive fields from config

**From cursor-rules.ts:**
- `getCursorProjectRulesPath(projectDir)`: Get project rules path
- `buildCursorOpenPetsRule()`: Build managed Cursor rules content
- `buildCursorRulesPreview()`: Build copyable rules preview
- `readCursorOpenPetsRules(projectDir)`: Safely read managed rules file
- `classifyCursorRulesStatus(result, path, expected?)`: Classify rules status
- `planCursorRulesInstall(projectDir, allowReplace?)`: Plan project rules install/update
- `planCursorRulesReplace(projectDir)`: Plan explicit replacement
- `planCursorRulesRemove(projectDir)`: Plan managed rules removal
- `executeCursorRulesWrite(plan)`: Execute rules write/remove atomically
- `isManagedCursorOpenPetsRule(content)`: Check managed marker/frontmatter shape
- `maxCursorRulesBytes`: 64 KiB limit constant

### Package Scripts
- `npm test`: Run contract validation tests (`node dist/check-cursor.js`)
- `npm run check`: Full typecheck + build + test pipeline
- `npm run typecheck`: TypeScript type checking only
- `npm run build`: Compile TypeScript to `dist/`

### Downstream Consumers
- Desktop app: Uses preview/redaction APIs for UI display
- CLI tools: Uses planning/execution APIs for install/remove operations
- Both use status classification to determine available actions

### Test Coverage
`check-cursor.ts` validates:
- Pet ID validation (valid/invalid patterns, length limits)
- MCP entry building (published/local modes, version validation)
- Config formatting and path helpers
- All status classifications (missing, empty, installed, needs-update, conflict, invalid)
- Parse errors, oversized files, symlink rejection
- Non-object schema rejection (top-level, mcpServers, entries)
- Backup creation and atomic write behavior
- Uninstall preserves unrelated entries and top-level fields
- No writes on invalid/error status
- No conflict write without explicit replace
- Explicit replace preserves unrelated servers/fields
- Recursive and case-insensitive redaction
- URL token parameter redaction
- Symlink parent/ancestor rejection
- Empty mcpServers preservation after remove
- Cursor project rules generation and path resolution
- Rules missing/installed/needs-update/conflict classification
- Rules duplicate/reversed/missing marker handling
- Rules frontmatter conflict detection
- Rules symlink parent/file, dangling symlink, non-regular, oversized rejection
- Rules backup, atomic write, replace, remove, and no-write invalid behavior
</content>
# Source: packages/cursor/src

## Responsibility

Source modules for Cursor editor integration. Each module handles a specific concern: MCP entry construction, status classification, safe file I/O, preview generation, and project rules management.

## Design/Patterns

### Module Separation
- `cursor-mcp.ts`: Pure functions for MCP entry construction, no side effects
- `cursor-status.ts`: File system operations with safety checks and atomic writes
- `cursor-previews.ts`: Config transformation for display (redaction, filtering)
- `cursor-rules.ts`: Markdown rules file management with marker-based ownership
- `index.ts`: Clean re-export barrel, no additional logic
- `check-cursor.ts`: Comprehensive contract tests, self-contained validation

### Type Safety
- Strict readonly interfaces for all public APIs
- Discriminated unions for result types (`ok: true/false`)
- Unknown input validation before processing
- No `any` types in public interfaces

### Error Handling
- All file operations return `Result | Error` discriminated unions
- Error reasons are typed literals for programmatic handling
- Human-readable messages for UI display
- No thrown errors in public APIs (except execute functions)

### File System Safety
- `lstatSync` with `throwIfNoEntry: false` for existence checks
- `realpathSync` avoided (symlink rejection instead)
- `mkdirSync` with `recursive: true, mode: 0o700` for secure directory creation
- `openSync` with `wx` flag for exclusive temp file creation
- `renameSync` for atomic moves
- `chmodSync` best-effort for permissions

### UUID Generation
- Uses `randomUUID()` from `node:crypto` for unique temp/backup paths
- Combined with `process.pid` and `Date.now()` for collision resistance

## Flow

### Config Read Flow (cursor-status.ts)
```
readCursorMcpConfig(path)
  → assertSafeParentDirectory(dirname(path))
  → assertSafeExistingConfigFile(path, allowMissing=true)
  → existsSync check
  → readFileSync (if exists)
  → size check (max 256 KiB)
  → JSON.parse
  → schema validation (isRecord, mcpServers shape)
  → return { ok: true, config, exists }
```

### Status Classification Flow (cursor-status.ts)
```
classifyCursorMcpStatus(result, path, expected)
  → if !result.ok: map reason to status (invalid/error)
  → if !exists: return missing
  → extract mcpServers.openpets
  → if undefined: return missing
  → if not isRecord: return conflict (malformed)
  → build expected entry
  → if isSameMcpEntry: return installed
  → if isManagedOpenPetsMcpEntry: return needs-update
  → return conflict (non-OpenPets entry)
```

### Write Plan Flow (cursor-status.ts)
```
planCursorMcpInstall(path, options, allowReplace)
  → readCursorMcpConfig(path)
  → classifyCursorMcpStatus(result, path, options)
  → validate status allows install
  → build new entry
  → merge with existing config (preserve other servers)
  → buildWritePlan(path, JSON.stringify(newConfig))
    → assertSafeParentDirectory
    → assertSafeExistingConfigFile
    → generate unique backup path (if exists)
    → generate unique temp path
    → return { targetPath, backupPath?, tempPath, content }
```

### Execute Write Flow (cursor-status.ts)
```
executeCursorMcpWrite(plan)
  → validate parent directory safety
  → validate target file safety
  → JSON.parse content (double-check validity)
  → mkdirSync parent (recursive, 0o700)
  → if backupPath && exists(target): copy to backup
  → openSync tempPath (wx, 0o600)
  → writeFileSync temp content
  → closeSync temp
  → renameSync(tempPath, targetPath)
  → chmodSync target (best effort 0o600)
```

### Redaction Flow (cursor-previews.ts)
```
redactCursorConfig(config)
  → for each key in config:
    → if key === "mcpServers": redactMcpServers(value)
    → else: redactValue(value)

redactMcpEntry(entry)
  → for each [key, value] in entry:
    → if sensitiveKeys.includes(lowerKey): "[REDACTED]"
    → if key === "args" && Array: map redactStringValue
    → if isRecord(value): recurse redactMcpEntry
    → else: redactValue(value)

redactStringValue(str)
  → if length > 1000: "[REDACTED-LONG-STRING]"
  → if matches sensitivePatterns: replace values with [REDACTED]
  → if looks like URL with query: redactUrlParams
  → return original
```

### Rules Read Flow (cursor-rules.ts)
```
readCursorOpenPetsRules(projectDir)
  → getCursorProjectRulesPath(projectDir)
  → assertSafeRulesPath(projectDir, rulesPath)
  → assertSafeExistingRulesFile(rulesPath, allowMissing=true)
  → if !exists: return { ok: true, content: "", exists: false }
  → readFileSync
  → size check (max 64 KiB)
  → return { ok: true, content, exists: true }
```

### Rules Classification Flow (cursor-rules.ts)
```
classifyCursorRulesStatus(result, path, expected?)
  → if !result.ok: map to error/invalid status
  → if !exists: return missing
  → classifyManagedRuleShape(content)
    → count markers (must be exactly 1 each)
    → check order (START before END)
    → check before === frontmatter
    → check after === ""
  → if shape !== "managed": return conflict
  → if content === expected: return installed
  → return needs-update
```

## Integration

### Module Dependencies
```
cursor-mcp.ts (no dependencies)
  ↓
cursor-status.ts imports cursor-mcp.ts
  ↓
cursor-previews.ts imports cursor-mcp.ts
cursor-rules.ts (no dependencies)
  ↓
index.ts exports all four modules
check-cursor.ts imports all modules for testing
```

### Public API Surface
All exports are explicit. No internal utilities are exported:
- `cursor-mcp.ts`: 7 exported functions + 4 types + 2 constants
- `cursor-status.ts`: 7 exported functions + 6 types + 1 constant
- `cursor-previews.ts`: 2 exported functions + 2 types
- `cursor-rules.ts`: 10 exported functions + 6 types + 3 constants

### Test Integration
`check-cursor.ts` is a standalone test file that:
- Creates temp directories using `mkdtempSync`
- Runs assertions using `node:assert/strict`
- Cleans up via `rmSync` in finally block
- Exits with error code on failure (non-zero)
- Prints "Cursor validation passed." on success

### Build Output
- TypeScript compiles to `dist/*.js` with `.js` extensions preserved
- Type definitions emitted to `dist/*.d.ts`
- Package exports point to `dist/index.js` and `dist/index.d.ts`
- Test file compiled to `dist/check-cursor.js` and run directly

### Node.js APIs Used
- `node:path`: `join`, `dirname`, `resolve`, `parse`, `isAbsolute`
- `node:fs`: `readFileSync`, `writeFileSync`, `existsSync`, `lstatSync`, `mkdirSync`, `renameSync`, `rmSync`, `chmodSync`, `openSync`, `closeSync`, `symlinkSync` (tests only)
- `node:crypto`: `randomUUID`
- `node:os`: `tmpdir`
- `node:assert/strict`: `assert`, `equal`, `deepEqual`, `throws`, `match`, `doesNotMatch`, `ok`
</content>
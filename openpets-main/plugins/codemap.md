# plugins/

## Responsibility

Root source workspace for first-party OpenPets plugins. It contains reviewed plugin products before packaging, catalog sync, and R2 upload; current runtime code treats these as SDK v3 plugin packages with manifests, JavaScript entries, assets, tests, and optional locale catalogs.

## Design/Patterns

- **Package-Per-Plugin Boundary**: Each plugin is an independent folder with `openpets.plugin.json`, `index.js`, optional `assets/`, optional `locales/`, and a local `test.js` harness.
- **Manifest-First Contract**: Desktop install/dev loading starts from `openpets.plugin.json` and validates SDK version, permissions, commands, config schema, assets, panels, and entry paths before executing plugin code.
- **Companion-First SDK v3**: Official plugins use host-rendered bubbles/alerts/HUDs, schedules, commands, storage, assets, and localized `$t:` keys instead of injecting UI into pet windows.
- **Reviewed Catalog Source**: The folder is the product source consumed by plugin checks/package/publish scripts; generated catalog and ZIP artifacts live outside this source boundary.

## Data & Control Flow

1. A developer edits an official plugin folder under `plugins/official/{pluginId}/`.
2. `pnpm dev:desktop:plugins` points desktop dev mode at `plugins/official`; `plugin-local-loader.ts` validates folders and snapshots manifests for hot reload.
3. `apps/desktop/src/plugin-service.ts` loads approved manifests, and `plugin-runtime.ts` starts each JavaScript entry through the sandboxed plugin host.
4. Plugin code calls SDK namespaces (`ctx.ui`, `ctx.pet`, `ctx.schedule`, `ctx.storage`, `ctx.commands`, `ctx.assets`, `ctx.t`, etc.); the desktop bridge validates permissions and renders host-owned effects.
5. Release tooling packages each plugin's manifest, entry, declared assets, panels, and locales into deterministic ZIP/catalog output for reviewed distribution.

## Integration Points

- **Desktop runtime**: `apps/desktop/src/plugin-local-loader.ts`, `plugin-package.ts`, `plugin-service.ts`, `plugin-runtime.ts`, `plugin-js-host.ts`, and `plugin-sdk-bridge.ts` consume these packages.
- **Published SDK**: `packages/sdk/` defines the plugin-facing API and test harness used by official plugin `test.js` files.
- **CLI tooling**: `packages/cli/src/plugin-templates.ts` and `plugin-validate.ts` scaffold and validate plugin folders using the same manifest conventions.
- **Detailed map**: [official/codemap.md](official/codemap.md)

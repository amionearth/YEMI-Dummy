# apps/desktop/src/i18n/

## Responsibility

Orchestrates internationalization (i18n) for the desktop client. Resolves language preferences based on system settings and user configurations, translates main-process interface texts (such as tray options and pet speech/status labels), and serves localized translation bundles to renderer windows via IPC.

## Design/Patterns

- **Decoupled Catalog**: Isolates pure, dependency-free locale definition mapping and interpolation helpers (`catalog.ts`) from Electron main-process infrastructure (`index.ts`). This ensures translations can be resolved in standalone environments (e.g., node testing).
- **Graceful Fallback**: Maps BCP-47 locale strings to supported locales (defaulting to English for missing files/keys) so that unresolved templates degrade cleanly to English matches instead of failing.
- **Lazy Runtime Loading**: Electron modules are loaded dynamically at runtime to prevent side-effects during startup or automated main-process unit testing.

## Data & Control Flow

1. **Initialization**: During startup, `main.ts` sets up settings configuration, which calls `setLocaleFromPreference()` mapping `"system"` against OS locale fetched from `app.getLocale()`.
2. **Translation**: Callsites query `t(key, vars)` which delegates lookup to `translate()`, interpolating brace tokens (`{name}`) dynamically.
3. **Renderer Hydration**: Main-process listeners in `windows.ts` handle the `openpets:get-i18n` IPC hook, calling `getActiveMessages()` to return the resolved dictionary to the Control Center React UI.

## Integration Points

- **Submodules**: Compiles locale labels from `locales/codemap.md` and speech reaction pools from `reactions/codemap.md`.
- **Desktop Main**: Utilized by `windows.ts`, `tray.ts`, and `pet-window.ts` to localize interactive UI elements.
- **App State**: Coordinates with `app-state.ts` to fetch and update the user's BCP-47 active lang choice.

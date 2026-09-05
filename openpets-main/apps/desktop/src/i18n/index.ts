// Main-process i18n facade: holds the active locale (derived from the user's
// stored preference + the OS locale) and exposes `t()` for main-process call
// sites such as the tray. Renderer windows do not import this; they receive a
// resolved message map over IPC (see windows.ts `openpets:get-i18n`).
//
// `electron` is loaded lazily (via createRequire, inside `systemLocale()`)
// rather than imported at module scope: this facade is pulled into the plugin
// runtime graph (plugin-i18n -> i18n/index) and must be importable under plain
// Node in the test suite, where the `electron` shim has no named `app` export.
import { createRequire } from "node:module";

import {
  getMessages,
  resolvePreference,
  translate,
  type Locale,
  type LocalePreference,
  type MessageKey,
  type Messages,
} from "./catalog.js";

export type { Locale, LocalePreference, MessageKey, Messages } from "./catalog.js";
export { LOCALE_LABELS, SUPPORTED_LOCALES, isSupportedLocale } from "./catalog.js";

let activeLocale: Locale = "en";

const require = createRequire(import.meta.url);

function systemLocale(): string {
  try {
    const { app } = require("electron") as typeof import("electron");
    return app.getLocale() || "en";
  } catch {
    // `electron` is unavailable outside the Electron runtime (e.g. tests), and
    // app.getLocale() throws before `ready`; callers re-apply after startup.
    return "en";
  }
}

/** Apply a stored preference, resolving `"system"` against the OS locale. */
export function setLocaleFromPreference(preference: LocalePreference): Locale {
  activeLocale = resolvePreference(preference, systemLocale());
  return activeLocale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/**
 * BCP-47 tag for the HTML `lang` attribute. Our locale ids are already valid
 * language tags (e.g. `zh-Hans`, `pt-BR`), so this returns the active locale —
 * but the indirection lets locale and lang diverge later without churn.
 */
export function getActiveLocaleLang(): string {
  return activeLocale;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(activeLocale, key, vars);
}

/** Resolved message map for the active locale (for sending to the renderer). */
export function getActiveMessages(): Messages {
  return getMessages(activeLocale);
}

import React, { createContext, useContext } from "react";

// Renderer-side i18n. The renderer never imports the catalog source (it lives
// under the main-process rootDir); instead it receives a fully-resolved message
// map over IPC (`openpets:get-i18n`) and looks strings up here. Missing keys
// fall back to the key itself so a partial wiring is visible, not blank.
export type I18nSnapshot = {
  locale: string;
  localePreference: string;
  availableLocales: { value: string; label: string }[];
  messages: Record<string, string>;
};

export type I18nContextValue = {
  locale: string;
  localePreference: string;
  availableLocales: { value: string; label: string }[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  reload: () => void;
};

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

const fallback: I18nContextValue = {
  locale: "en",
  localePreference: "system",
  availableLocales: [],
  t: (key) => key,
  reload: () => {},
};

const I18nContext = createContext<I18nContextValue>(fallback);

export function I18nProvider({ snapshot, onReload, children }: { snapshot: I18nSnapshot | null; onReload: () => void; children: React.ReactNode }) {
  const value: I18nContextValue = snapshot
    ? {
        locale: snapshot.locale,
        localePreference: snapshot.localePreference,
        availableLocales: snapshot.availableLocales,
        t: (key, vars) => interpolate(snapshot.messages[key] ?? key, vars),
        reload: onReload,
      }
    : { ...fallback, reload: onReload };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

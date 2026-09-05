/**
 * Drift guard between the runtime plugin SDK and the published
 * `@open-pets/plugin-sdk` type contract.
 *
 * These are compile-time assertions: if the runtime's plugin-facing surface
 * (namespaces) or the JavaScript permission set ever diverges from what the
 * published package promises authors, `tsc` fails here. Keep the package and
 * the bridge in lockstep.
 */
import type { OpenPetsContext, OpenPetsPermission } from "@open-pets/plugin-sdk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginJavascriptPermission } from "./plugin-manifest.js";
import type { PluginSdkApi } from "./plugin-sdk-bridge.js";
import type { sdkCallHandlers } from "./plugin-js-host.js";
import { pluginSdkAsyncRoutes, pluginSdkSyncRoutes, type PluginSdkRoute } from "./plugin-sdk-routes.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Every namespace the published SDK exposes (ctx.pet, ctx.schedule, …) must
// exist on the runtime API, and the runtime must expose nothing extra.
type _NamespacesMatch = Expect<Equal<keyof PluginSdkApi, keyof OpenPetsContext>>;

// The JavaScript plugin permission union must match the published contract.
type _PermissionsMatch = Expect<Equal<PluginJavascriptPermission, OpenPetsPermission>>;
type _HostRoutesMatch = Expect<Equal<keyof typeof sdkCallHandlers, PluginSdkRoute>>;

// Reference the aliases so unused-type tooling never strips the guard.
export type PluginSdkConformance = [_NamespacesMatch, _PermissionsMatch, _HostRoutesMatch];

const preload = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "plugin-sdk-preload.cjs"), "utf8");
const preloadAsyncRoutes = extractPreloadAsyncRoutes(preload);
const preloadSyncRoutes = extractLiteralFirstArgs(preload, "callSync");
const hostOnlyRoutes = new Set<string>(["assets.resolve"]);
const expectedPreloadAsyncRoutes = new Set(pluginSdkAsyncRoutes.filter((route) => !hostOnlyRoutes.has(route)));
assertSetEqual("Plugin SDK preload async routes", preloadAsyncRoutes, expectedPreloadAsyncRoutes);
assertSetEqual("Plugin SDK preload sync routes", preloadSyncRoutes, new Set(pluginSdkSyncRoutes));

console.error("Plugin SDK conformance validation passed.");

function extractPreloadAsyncRoutes(source: string): Set<string> {
  const routes = new Set<string>([...extractLiteralFirstArgs(source, "call"), ...extractSubscriptionRoutes(source)]);
  if (/call\(`log\.\$\{level\}`/.test(source)) for (const level of ["debug", "info", "warn", "error"]) routes.add(`log.${level}`);
  return routes;
}

function extractSubscriptionRoutes(source: string): Set<string> {
  const routes = new Set<string>();
  const pattern = /\bsubscription\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) { routes.add(match[1] ?? ""); routes.add(match[2] ?? ""); }
  return routes;
}

function extractLiteralFirstArgs(source: string, callee: string): Set<string> {
  const routes = new Set<string>();
  const pattern = new RegExp(`\\b${callee}\\(\\s*"([^"]+)"`, "g");
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) routes.add(match[1] ?? "");
  return routes;
}

function assertSetEqual(label: string, actual: Set<string>, expected: Set<string>): void {
  const missing = [...expected].filter((route) => !actual.has(route)).sort();
  const extra = [...actual].filter((route) => !expected.has(route)).sort();
  if (missing.length > 0 || extra.length > 0) throw new Error(`${label} drift. Missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`);
}

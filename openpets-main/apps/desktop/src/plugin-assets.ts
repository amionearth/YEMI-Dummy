import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";
import sharp from "sharp";

import { pluginAssetMaxBytes, pluginPanelMaxBytes, type OpenPetsJavascriptPluginManifest, type PluginAssetKind } from "./plugin-manifest.js";
import { SUPPORTED_LOCALES } from "./i18n/catalog.js";

/** Per-locale size cap for bundled `locales/<locale>.json` catalogs. */
const pluginLocaleMaxBytes = 256 * 1024;

/** One file a v3 manifest declares (asset or panel page). */
export type DeclaredPluginFile = {
  readonly kind: PluginAssetKind | "panel";
  readonly name: string;
  readonly relPath: string;
  readonly maxBytes: number;
};

export type TrustedPluginSprite = { pluginId: string; assetName: string; layout: { frameWidth: number; frameHeight: number; frames: number; durationMs: number }; version: string };
export type PluginAssetRequest = { pluginId: string; assetName: string; version: string };

/** Parse the only renderer-visible plugin asset route. All other paths are denied. */
export function parsePluginSpriteRequest(requestUrl: string, method: string): PluginAssetRequest | undefined {
  if (method !== "GET" && method !== "HEAD") return undefined;
  let url: URL;
  try { url = new URL(requestUrl); } catch { return undefined; }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "openpets-plugin-asset:" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(url.hostname) || parts.length !== 2 || parts[0] !== "sprites" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(parts[1]) || url.hash || [...url.searchParams.keys()].some((key) => key !== "v")) return undefined;
  const version = url.searchParams.get("v");
  return version ? { pluginId: url.hostname, assetName: parts[1], version } : undefined;
}

/** Path-module independent containment predicate (testable with node:path.win32). */
export function isPathContained(root: string, target: string, relativePath: (from: string, to: string) => string = relative): boolean {
  const pathFromRoot = relativePath(root, target);
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith("../") && !pathFromRoot.startsWith("..\\") && !pathFromRoot.startsWith("/") && !pathFromRoot.startsWith("\\") && !/^[A-Za-z]:[\\/]/.test(pathFromRoot);
}

/** All bundled files a v3 plugin declares beyond manifest + entry. */
export function collectDeclaredPluginFiles(manifest: OpenPetsJavascriptPluginManifest): DeclaredPluginFile[] {
  if (manifest.manifestVersion !== 3) return [];
  const files: DeclaredPluginFile[] = [];
  const kinds: PluginAssetKind[] = ["icons", "images", "svgs", "sprites", "sounds"];
  for (const kind of kinds) {
    for (const [name, declaration] of Object.entries(manifest.assets?.[kind] ?? {})) {
      const relPath = kind === "sprites" ? declaration.path : declaration;
      files.push({ kind, name, relPath, maxBytes: pluginAssetMaxBytes[kind] });
    }
  }
  for (const [name, relPath] of Object.entries(manifest.panels ?? {})) {
    files.push({ kind: "panel", name, relPath, maxBytes: pluginPanelMaxBytes });
  }
  return files;
}

/**
 * Install-time SVG sanitization (§6): strip script, foreignObject, event
 * handler attributes, and external/javascript references. The output is the
 * only SVG ever handed to a pet window.
 */
export function sanitizeSvgText(svg: string): string {
  let out = svg;
  // Drop processing risks wholesale.
  out = out.replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, "");
  out = out.replace(/<foreignObject\b[\s\S]*?(?:<\/foreignObject\s*>|$)/gi, "");
  out = out.replace(/<!ENTITY[\s\S]*?>/gi, "");
  // Strip on* event handler attributes.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  // Strip external or javascript hrefs; keep same-document fragment refs.
  out = out.replace(/\s(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, "");
  out = out.replace(/\s(href|xlink:href)\s*=\s*'(?!#)[^']*'/gi, "");
  // No external style imports or url() loads.
  out = out.replace(/@import[^;]*;/gi, "");
  out = out.replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, "none");
  return out;
}

const panelCsp = "default-src 'none'; script-src 'unsafe-inline' file:; style-src 'unsafe-inline' file:; img-src file: data:; media-src file: data:; font-src file: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

/**
 * Inject the panel sandbox CSP into plugin panel HTML at install time so the
 * loaded file: document is locked down even before the session-level request
 * filter applies.
 */
export function injectPanelCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${panelCsp}">`;
  const withoutExisting = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, "");
  if (/<head[^>]*>/i.test(withoutExisting)) return withoutExisting.replace(/<head[^>]*>/i, (match) => `${match}${meta}`);
  if (/<html[^>]*>/i.test(withoutExisting)) return withoutExisting.replace(/<html[^>]*>/i, (match) => `${match}<head>${meta}</head>`);
  return `${meta}${withoutExisting}`;
}

/** Validate and transform a declared file's bytes before publishing. */
export function preparePluginFileBytes(file: DeclaredPluginFile, bytes: Buffer): Buffer {
  if (bytes.byteLength > file.maxBytes) throw new Error(`Plugin ${file.kind} file is too large: ${file.relPath}`);
  if (file.kind === "svgs" || (file.kind === "icons" && file.relPath.toLowerCase().endsWith(".svg"))) {
    return Buffer.from(sanitizeSvgText(bytes.toString("utf8")), "utf8");
  }
  if (file.kind === "panel") {
    return Buffer.from(injectPanelCsp(bytes.toString("utf8")), "utf8");
  }
  return bytes;
}

/** Verify sprite bytes at package boundaries, before a renderer can request them. */
export async function validatePluginSpriteBytes(file: DeclaredPluginFile, bytes: Buffer, manifest: OpenPetsJavascriptPluginManifest): Promise<void> {
  if (file.kind !== "sprites") return;
  const sprite = manifest.assets?.sprites?.[file.name];
  if (!sprite) throw new Error(`Plugin sprite is not declared: ${file.name}`);
  const metadata = await sharp(bytes, { limitInputPixels: 4_194_304, animated: false }).metadata();
  if (metadata.format !== "webp" || metadata.width !== sprite.frameWidth * sprite.frames || metadata.height !== sprite.frameHeight) throw new Error(`Plugin sprite dimensions are invalid: ${file.relPath}`);
}

/** Read all declared files from a plugin source folder, validated and prepared. */
export async function readDeclaredPluginFiles(manifest: OpenPetsJavascriptPluginManifest, realSourceFolder: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const file of collectDeclaredPluginFiles(manifest)) {
    const filePath = join(realSourceFolder, file.relPath);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Plugin declared file is invalid: ${file.relPath}`);
    if (stat.size > file.maxBytes) throw new Error(`Plugin ${file.kind} file is too large: ${file.relPath}`);
    const realPath = await fs.realpath(filePath);
    if (realPath !== filePath) throw new Error(`Plugin declared file is invalid: ${file.relPath}`);
    const bytes = preparePluginFileBytes(file, await fs.readFile(filePath));
    await validatePluginSpriteBytes(file, bytes, manifest);
    out.set(file.relPath, bytes);
  }
  // Plugin i18n catalogs live under `locales/<locale>.json` by convention (not
  // manifest-declared); copy any that exist so install dirs ship translations.
  for (const locale of SUPPORTED_LOCALES) {
    const relPath = `locales/${locale}.json`;
    const filePath = join(realSourceFolder, relPath);
    let stat;
    try { stat = await fs.lstat(filePath); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (stat.size > pluginLocaleMaxBytes) throw new Error(`Plugin locale file is too large: ${relPath}`);
    const realPath = await fs.realpath(filePath);
    if (realPath !== filePath) throw new Error(`Plugin locale file is invalid: ${relPath}`);
    out.set(relPath, await fs.readFile(filePath));
  }
  return out;
}

/** Write prepared declared files into a (temp) install directory. */
export async function writeDeclaredPluginFiles(targetDir: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const [relPath, bytes] of files) {
    const filePath = join(targetDir, relPath);
    await fs.mkdir(join(filePath, ".."), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, bytes, { mode: 0o600 });
  }
}

/** Resolve a declared asset name to its on-disk path inside an install dir. */
export function resolveDeclaredAssetPath(manifest: OpenPetsJavascriptPluginManifest, installPath: string, kind: PluginAssetKind, name: string): string {
  const declared = manifest.manifestVersion === 3 ? manifest.assets?.[kind]?.[name] : undefined;
  const relPath = kind === "sprites" && declared && typeof declared === "object" ? declared.path : declared as string | undefined;
  if (!relPath) throw new Error(`Plugin asset is not declared: ${kind}/${name}`);
  const root = resolve(installPath);
  const path = resolve(root, relPath);
  if (!isPathContained(root, path)) throw new Error(`Plugin asset escapes install path: ${kind}/${name}`);
  return path;
}

export function resolveTrustedPluginSprite(manifest: OpenPetsJavascriptPluginManifest, pluginId: string, assetName: string): TrustedPluginSprite {
  const sprite = manifest.manifestVersion === 3 ? manifest.assets?.sprites?.[assetName] : undefined;
  if (!sprite) throw new Error("Delivery courier is not declared by this plugin.");
  return { pluginId, assetName, layout: { frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight, frames: sprite.frames, durationMs: sprite.durationMs }, version: manifest.version };
}

/** Resolve a declared panel name to its on-disk path inside an install dir. */
export function resolveDeclaredPanelPath(manifest: OpenPetsJavascriptPluginManifest, installPath: string, name: string): string {
  const relPath = manifest.manifestVersion === 3 ? manifest.panels?.[name] : undefined;
  if (!relPath) throw new Error(`Plugin panel is not declared: ${name}`);
  return join(installPath, relPath);
}

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";

export type UserSoundRef = { kind: "user-sound"; id: string; name?: string };
export type UserSoundEntry = { path: string; name?: string };

export const userSoundMimeByExtension: Readonly<Record<string, string>> = { ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
export const maxUserSoundBytes = 1024 * 1024;
export const userSoundIdPattern = /^[a-f0-9]{32}$/;

export class UserSoundStore {
  readonly root: string;
  readonly #cache = new Map<string, UserSoundEntry>();

  constructor(root: string) {
    this.root = root;
  }

  async importFromPath(pluginId: string, sourcePath: string, opts: { name?: string } = {}): Promise<UserSoundRef> {
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile() || stat.size > maxUserSoundBytes) throw new Error("Plugin sound file is missing or too large.");
    const ext = extname(sourcePath).toLowerCase();
    if (!userSoundMimeByExtension[ext]) throw new Error("Plugin sound format is not supported.");
    const bytes = await fs.readFile(sourcePath);
    const id = createHash("sha256").update(pluginId).update("\0").update(bytes).digest("hex").slice(0, 32);
    const dir = join(this.root, safeSegment(pluginId));
    await fs.mkdir(dir, { recursive: true });
    const dest = join(dir, `${id}${ext}`);
    await fs.writeFile(dest, bytes, { flag: "w" });
    const entry = { path: dest, name: opts.name ?? basename(sourcePath) };
    this.#cache.set(cacheKey(pluginId, id), entry);
    return { kind: "user-sound", id, name: entry.name };
  }

  async resolvePath(pluginId: string, id: string): Promise<string> {
    assertUserSoundId(id);
    const entry = await this.load(pluginId, id);
    if (entry) return entry.path;
    throw new Error("User sound reference is invalid.");
  }

  async load(pluginId: string, id: string): Promise<UserSoundEntry | undefined> {
    assertUserSoundId(id);
    const key = cacheKey(pluginId, id);
    const cached = this.#cache.get(key);
    if (cached) return cached;
    const dir = join(this.root, safeSegment(pluginId));
    for (const ext of Object.keys(userSoundMimeByExtension)) {
      const path = join(dir, `${safeSegment(id)}${ext}`);
      try {
        const stat = await fs.stat(path);
        if (stat.isFile()) {
          const entry = { path, name: undefined };
          this.#cache.set(key, entry);
          return entry;
        }
      } catch { /* try next extension */ }
    }
    return undefined;
  }

  async forget(pluginId: string, ref: { id: string }): Promise<void> {
    assertUserSoundId(ref.id);
    const key = cacheKey(pluginId, ref.id);
    const entry = this.#cache.get(key) ?? await this.load(pluginId, ref.id);
    this.#cache.delete(key);
    if (entry) await fs.unlink(entry.path).catch(() => undefined);
  }

  async clearPlugin(pluginId: string): Promise<void> {
    const prefix = `${pluginId}\0`;
    for (const key of [...this.#cache.keys()]) if (key.startsWith(prefix)) this.#cache.delete(key);
    await fs.rm(join(this.root, safeSegment(pluginId)), { recursive: true, force: true });
  }
}

export function safeSegment(value: string): string { return value.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80); }
export function isValidUserSoundId(value: unknown): value is string { return typeof value === "string" && userSoundIdPattern.test(value); }
export function assertUserSoundId(value: string): void { if (!isValidUserSoundId(value)) throw new Error("User sound reference is invalid."); }

function cacheKey(pluginId: string, id: string): string { return `${pluginId}\0${id}`; }

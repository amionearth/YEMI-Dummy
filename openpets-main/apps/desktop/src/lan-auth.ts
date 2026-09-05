import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const persistedLanAuthVersion = 1;
const minTokenLength = 12;
const maxTokenLength = 256;

export type LanAuthSource = "env" | "stored" | "generated" | "none";

export type LanAuthConfig = {
  readonly token: string | null;
  readonly source: LanAuthSource;
  readonly insecure: boolean;
  readonly tokenHint: string | null;
};

type PersistedLanAuth = {
  readonly version: 1;
  readonly token: string;
  readonly updatedAt: number;
};

export function getPersistedLanAuthPath(userDataPath: string): string {
  return join(userDataPath, "lan-auth.json");
}

export function resolveLanAuthConfig(userDataPath: string, env: NodeJS.ProcessEnv, options: { readonly serverMode: boolean; readonly generateIfMissing?: boolean }): LanAuthConfig {
  const envToken = normalizeLanToken(env.OPENPETS_LAN_TOKEN);
  if (envToken) return toConfig(envToken, "env", false);

  const allowInsecure = normalizeBoolean(env.OPENPETS_LAN_ALLOW_INSECURE);
  if (allowInsecure) return { token: null, source: "none", insecure: true, tokenHint: null };

  if (!options.serverMode) return { token: null, source: "none", insecure: false, tokenHint: null };

  const persistedToken = readPersistedLanAuth(userDataPath)?.token ?? null;
  if (persistedToken) return toConfig(persistedToken, "stored", false);

  if (options.generateIfMissing === false) return { token: null, source: "none", insecure: false, tokenHint: null };

  const generatedToken = generateLanToken();
  writePersistedLanAuth(userDataPath, generatedToken);
  return toConfig(generatedToken, "generated", false);
}

export function normalizeLanToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token.length >= minTokenLength && token.length <= maxTokenLength ? token : null;
}

export function readPersistedLanAuth(userDataPath: string): PersistedLanAuth | null {
  const path = getPersistedLanAuthPath(userDataPath);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const token = normalizeLanToken(parsed.token);
    if (!token) return null;
    return {
      version: persistedLanAuthVersion,
      token,
      updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : 0,
    };
  } catch {
    return null;
  }
}

function writePersistedLanAuth(userDataPath: string, token: string): void {
  const path = getPersistedLanAuthPath(userDataPath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(path), 0o700); } catch { /* best effort on platforms without POSIX modes */ }
  const payload: PersistedLanAuth = {
    version: persistedLanAuthVersion,
    token,
    updatedAt: Date.now(),
  };
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(tempPath, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
  renameSync(tempPath, path);
  try { chmodSync(path, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
}

function generateLanToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function toConfig(token: string, source: LanAuthSource, insecure: boolean): LanAuthConfig {
  return { token, source, insecure, tokenHint: token.slice(-4) };
}

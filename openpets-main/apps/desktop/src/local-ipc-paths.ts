import { lstatSync, mkdirSync, writeFileSync, renameSync, rmSync, chmodSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

import { app } from "electron";

import { openPetsIpcProtocol, openPetsIpcVersion } from "./local-ipc-protocol.js";

export interface OpenPetsDiscoveryFile {
  readonly protocolVersion: 1;
  readonly protocol: "openpets-ipc";
  readonly endpoint: string;
  readonly token: string;
  readonly appVersion: string;
  readonly pid: number;
  readonly platform: NodeJS.Platform;
}

export type IpcEndpoint =
  | { readonly kind: "tcp"; readonly host: string; readonly port: number }
  | { readonly kind: "path"; readonly path: string };

export function getDiscoveryFilePath(): string {
  if (process.env.OPENPETS_DISCOVERY_FILE) {
    return process.env.OPENPETS_DISCOVERY_FILE;
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "OpenPets", "runtime", "ipc.json");
  }

  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "OpenPets", "runtime", "ipc.json");
  }

  const xdg = getSecureXdgRuntimeDir();
  if (xdg) {
    return join(xdg, "openpets", "ipc.json");
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "OpenPets", "runtime", "ipc.json");
}

export interface IpcEndpointConfig {
  readonly bindEndpoint: IpcEndpoint;
  readonly advertisedEndpoint: string;
}

export function createIpcEndpoint(): string {
  const config = getIpcEndpointConfig();
  return config.advertisedEndpoint;
}

export function getIpcEndpointConfig(): IpcEndpointConfig {
  const bindEnv = process.env.OPENPETS_IPC_BIND;
  const endpointEnv = process.env.OPENPETS_IPC_ENDPOINT;

  // Case 1: Both BIND and ENDPOINT set - BIND for listening, ENDPOINT for advertising
  if (bindEnv && endpointEnv) {
    const bindParsed = parseIpcEndpoint(bindEnv, { allowPortZero: true, allowNonLoopback: true });
    if (bindParsed.kind !== "tcp") {
      throw new Error("OPENPETS_IPC_BIND only supports TCP endpoints (e.g., tcp://0.0.0.0:37645 or tcp://127.0.0.1:37645).");
    }
    validateBindHost(bindParsed.host);
    const advertisedParsed = parseIpcEndpoint(endpointEnv, { allowPortZero: false, allowNonLoopback: true });
    if (advertisedParsed.kind !== "tcp") {
      throw new Error("OPENPETS_IPC_ENDPOINT must be a TCP endpoint when used with OPENPETS_IPC_BIND.");
    }
    // Advertised endpoint must have a concrete host (not 0.0.0.0)
    if (advertisedParsed.host === "0.0.0.0") {
      throw new Error("OPENPETS_IPC_ENDPOINT must specify a concrete IPv4 address (not 0.0.0.0) when used as the advertised endpoint.");
    }
    validateAdvertisedHost(advertisedParsed.host);
    if (bindParsed.port !== 0 && advertisedParsed.port !== bindParsed.port) {
      throw new Error("OPENPETS_IPC_ENDPOINT must use the same port as OPENPETS_IPC_BIND unless OPENPETS_IPC_BIND uses port 0.");
    }
    return { bindEndpoint: bindParsed, advertisedEndpoint: endpointEnv };
  }

  // Case 2: Only BIND set - use for both binding and advertising (if loopback)
  if (bindEnv) {
    const bindParsed = parseIpcEndpoint(bindEnv, { allowPortZero: true, allowNonLoopback: true });
    if (bindParsed.kind !== "tcp") {
      throw new Error("OPENPETS_IPC_BIND only supports TCP endpoints (e.g., tcp://0.0.0.0:37645 or tcp://127.0.0.1:37645).");
    }
    validateBindHost(bindParsed.host);
    // If binding to 0.0.0.0, we need a separate advertised endpoint
    if (bindParsed.host === "0.0.0.0") {
      throw new Error("When OPENPETS_IPC_BIND is set to 0.0.0.0, you must also set OPENPETS_IPC_ENDPOINT to specify the advertised endpoint (e.g., the WSL host IP).");
    }
    validateAdvertisedHost(bindParsed.host);
    return { bindEndpoint: bindParsed, advertisedEndpoint: bindEnv };
  }

  // Case 3: Only ENDPOINT set - invalid. ENDPOINT only advertises; BIND opts into TCP listening.
  if (endpointEnv) {
    throw new Error("OPENPETS_IPC_ENDPOINT only controls the advertised discovery endpoint. Set OPENPETS_IPC_BIND to opt into TCP IPC listening.");
  }

  // Case 4: No env vars - use platform default
  if (process.platform === "win32") {
    const pipePath = `\\\\.\\pipe\\openpets-${randomEndpointPart()}-${process.pid}`;
    return { bindEndpoint: { kind: "path", path: pipePath }, advertisedEndpoint: pipePath };
  }

  const runtimeDir = getSocketRuntimeDir();
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  ensurePrivateRuntimeDir(runtimeDir);
  const socketPath = join(runtimeDir, `openpets-${process.pid}.sock`);
  return { bindEndpoint: { kind: "path", path: socketPath }, advertisedEndpoint: socketPath };
}

export function parseIpcEndpoint(endpoint: string, options: { readonly allowPortZero?: boolean; readonly allowNonLoopback?: boolean } = {}): IpcEndpoint {
  if (endpoint.length < 1 || endpoint.length > 240) throw new Error("OpenPets IPC endpoint length is invalid.");
  if (endpoint.includes("\0")) throw new Error("OpenPets IPC endpoint contains NUL.");

  if (endpoint.startsWith("tcp://")) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error("OpenPets TCP IPC endpoint is invalid.");
    }

    if (url.protocol !== "tcp:" || url.username || url.password || (url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) {
      throw new Error("OpenPets TCP IPC endpoint must be tcp://<host>:<port> with no credentials, path, query, or fragment.");
    }

    const host = url.hostname;
    if (!isValidIpv4(host)) {
      throw new Error("OpenPets TCP IPC endpoint host must be a valid IPv4 address (127.0.0.1, 0.0.0.0, or a concrete address).");
    }

    if (!options.allowNonLoopback && host !== "127.0.0.1") {
      throw new Error("OpenPets TCP IPC endpoint must bind to loopback host 127.0.0.1.");
    }

    const port = Number(url.port);
    const minPort = options.allowPortZero ? 0 : 1;
    if (!Number.isInteger(port) || port < minPort || port > 65_535 || String(port) !== url.port) {
      throw new Error("OpenPets TCP IPC endpoint port is invalid.");
    }

    return { kind: "tcp", host, port };
  }

  return { kind: "path", path: endpoint };
}

function isValidIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return String(num) === part && num >= 0 && num <= 255;
  });
}

function validateAdvertisedHost(host: string): void {
  // Reject 0.0.0.0 as it's not a valid target address
  if (host === "0.0.0.0") {
    throw new Error("Advertised endpoint cannot use 0.0.0.0; specify a concrete IPv4 address.");
  }

  // Reject hostnames (contain letters)
  if (/[a-zA-Z]/.test(host)) {
    throw new Error("Advertised endpoint host must be an IPv4 address, not a hostname.");
  }

  // Check if it's a private/local address
  if (!isPrivateOrLocalIpv4(host)) {
    throw new Error(`Advertised endpoint host ${host} is not a private/local IPv4 address. Only loopback (127.0.0.1), private (10.x.x.x, 172.16-31.x.x, 192.168.x.x), or link-local (169.254.x.x) addresses are allowed.`);
  }
}

function validateBindHost(host: string): void {
  if (host === "0.0.0.0") return;
  if (!isPrivateOrLocalIpv4(host)) {
    throw new Error(`OPENPETS_IPC_BIND host ${host} is not a private/local IPv4 address. Only 0.0.0.0, loopback (127.0.0.1), private (10.x.x.x, 172.16-31.x.x, 192.168.x.x), or link-local (169.254.x.x) addresses are allowed.`);
  }
}

function isPrivateOrLocalIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4) return false;

  // Loopback: 127.0.0.0/8
  if (parts[0] === 127) return true;

  // Private: 10.0.0.0/8
  if (parts[0] === 10) return true;

  // Private: 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // Private: 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;

  // Link-local: 169.254.0.0/16
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
}

export function writeDiscoveryFile(endpoint: string, token: string): OpenPetsDiscoveryFile {
  const discovery: OpenPetsDiscoveryFile = {
    protocolVersion: openPetsIpcVersion,
    protocol: openPetsIpcProtocol,
    endpoint,
    token,
    appVersion: app.getVersion(),
    pid: process.pid,
    platform: process.platform,
  };

  const path = getDiscoveryFilePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(path), 0o700); } catch { /* best effort */ }
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(discovery, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(tempPath, 0o600); } catch { /* best effort */ }
  renameSync(tempPath, path);
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return discovery;
}

export function removeDiscoveryFile(discovery: OpenPetsDiscoveryFile | null): void {
  if (!discovery) return;
  const path = getDiscoveryFilePath();
  try {
    const current = JSON.parse(readFileSync(path, "utf8")) as Partial<OpenPetsDiscoveryFile>;
    if (current.pid !== discovery.pid || current.token !== discovery.token || current.endpoint !== discovery.endpoint) {
      return;
    }
    rmSync(path, { force: true });
  } catch {
    // best-effort cleanup only
  }
}

export function cleanupUnixSocket(endpoint: string): void {
  if (endpoint.startsWith("tcp://")) return;
  if (process.platform === "win32") return;
  try {
    rmSync(endpoint, { force: true });
  } catch {
    // bind will report a real failure if cleanup was required but impossible
  }
}

export function protectUnixSocket(endpoint: string): void {
  if (endpoint.startsWith("tcp://")) return;
  if (process.platform === "win32") return;
  try { chmodSync(endpoint, 0o600); } catch { /* best effort */ }
}

function getSocketRuntimeDir(): string {
  const xdg = process.platform === "linux" ? getSecureXdgRuntimeDir() : null;
  if (xdg) {
    return join(xdg, "openpets");
  }

  return join("/tmp", `openpets-${getUserIdForPath()}`);
}

function getSecureXdgRuntimeDir(): string | null {
  const dir = process.env.XDG_RUNTIME_DIR;
  if (!dir) return null;

  try {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return null;
    if ((stat.mode & 0o777) !== 0o700) return null;
    return dir;
  } catch {
    return null;
  }
}

function ensurePrivateRuntimeDir(dir: string): void {
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`OpenPets IPC runtime path is not a safe directory: ${dir}`);
  }

  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`OpenPets IPC runtime directory is not owned by the current user: ${dir}`);
  }

  try { chmodSync(dir, 0o700); } catch { /* best effort */ }
  const updated = lstatSync(dir);
  if ((updated.mode & 0o777) !== 0o700) {
    throw new Error(`OpenPets IPC runtime directory is not private: ${dir}`);
  }
}

function getUserIdForPath(): string {
  if (typeof process.getuid === "function") return String(process.getuid());
  try { return userInfo().username.replace(/[^a-zA-Z0-9_-]/g, "_"); } catch { return "user"; }
}

function randomEndpointPart(): string {
  return randomBytes(8).toString("hex");
}

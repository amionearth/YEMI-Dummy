export const openPetsIpcProtocol = "openpets-ipc";
export const openPetsIpcVersion = 1;
export const maxIpcMessageBytes = 16 * 1024;
export const connectTimeoutMs = 2_000;
export const responseTimeoutMs = 3_000;

export const allowedReactions = [
  "idle",
  "thinking",
  "working",
  "editing",
  "running",
  "testing",
  "waiting",
  "waving",
  "success",
  "error",
  "celebrating",
] as const;

export type OpenPetsReaction = typeof allowedReactions[number];
export type OpenPetsIpcMethod = "hello" | "status" | "pets.list" | "pets.install" | "lease.acquire" | "lease.heartbeat" | "lease.release" | "pet.react" | "pet.say" | "pet.showMedia" | "pets.install-local";

export interface OpenPetsIpcRequest {
  readonly id: string;
  readonly version: 1;
  readonly token: string;
  readonly method: OpenPetsIpcMethod;
  readonly params?: unknown;
}

export interface OpenPetsIpcOkResponse<T = unknown> {
  readonly id: string | null;
  readonly ok: true;
  readonly result: T;
}

export interface OpenPetsIpcErrorResponse {
  readonly id: string | null;
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type OpenPetsIpcResponse<T = unknown> = OpenPetsIpcOkResponse<T> | OpenPetsIpcErrorResponse;

export function parseIpcResponse<T = unknown>(value: unknown): OpenPetsIpcResponse<T> {
  if (!isRecord(value)) throw new OpenPetsClientError("invalid_response", "IPC response must be an object.");
  if (typeof value.id !== "string" && value.id !== null) throw new OpenPetsClientError("invalid_response", "IPC response id is invalid.");

  if (value.ok === true) {
    return { id: value.id, ok: true, result: value.result as T };
  }

  if (value.ok === false && isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string") {
    return { id: value.id, ok: false, error: { code: value.error.code, message: value.error.message } };
  }

  throw new OpenPetsClientError("invalid_response", "IPC response shape is invalid.");
}

export function validateReaction(value: string): OpenPetsReaction {
  if (!allowedReactions.includes(value as OpenPetsReaction)) {
    throw new OpenPetsClientError("invalid_reaction", "Invalid OpenPets reaction.");
  }
  return value as OpenPetsReaction;
}

export class OpenPetsClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

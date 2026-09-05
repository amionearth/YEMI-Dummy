import { pickHookSpeech, validateHookSpeech } from "@open-pets/agent-events";
import { allowedReactions, createOpenPetsClient, type OpenPetsClient, type OpenPetsReaction } from "@open-pets/client";

export interface OpenPetsPiOptions {
  readonly clientFactory?: () => OpenPetsClient;
  readonly schedule?: (work: () => Promise<void>) => void;
  readonly debug?: boolean;
  readonly debugLog?: (message: string) => void;
  readonly random?: () => number;
  readonly now?: () => number;
}

export interface OpenPetsPiRuntime {
  readonly handleEvent: (event: unknown) => void;
  readonly handleCommand: (args: string, ctx?: OpenPetsPiCommandContext) => Promise<void>;
}

export interface OpenPetsPiExtensionApi {
  readonly on?: (eventName: string, handler: (event: unknown, ctx?: unknown) => unknown) => unknown;
  readonly registerCommand?: (name: string, command: { readonly description?: string; readonly handler: (args: string, ctx?: unknown) => unknown }) => unknown;
}

export interface OpenPetsPiCommandContext {
  readonly ui?: {
    readonly notify?: (message: string, type?: "info" | "warning" | "error") => void;
  };
}

export interface PiEventDecision {
  readonly reaction?: OpenPetsReaction;
  readonly speech?: "error";
  readonly markError?: boolean;
  readonly clearError?: boolean;
}

export interface PiEventEnvelope {
  readonly type: string;
  readonly payload?: unknown;
}

export type OpenPetsPiCommand =
  | { readonly kind: "help" }
  | { readonly kind: "status" }
  | { readonly kind: "test" }
  | { readonly kind: "react"; readonly reaction: OpenPetsReaction }
  | { readonly kind: "say"; readonly message: string };

const automaticTimeoutMs = 500;
const errorSuccessSuppressionMs = 5_000;
const boundedCommandSliceLength = 300;

export const allowedPiOpenPetsCommands = ["help", "status", "test", "react", "say"] as const;

export function createOpenPetsPiExtension(pi: unknown, options: OpenPetsPiOptions = {}): OpenPetsPiRuntime {
  const runtime = createOpenPetsPiRuntime(options);
  const api = isPiApi(pi) ? pi : undefined;
  if (!api) return runtime;

  const subscribe = (eventName: string): void => {
    api.on?.(eventName, (event) => runtime.handleEvent({ type: eventName, payload: event }));
  };

  for (const eventName of ["session_start", "session_shutdown", "agent_start", "agent_end", "turn_start", "tool_execution_start", "tool_execution_end"]) {
    subscribe(eventName);
  }

  api.registerCommand?.("openpets", {
    description: "Control OpenPets desktop pet reactions and check local connection status.",
    handler: async (args, ctx) => runtime.handleCommand(args, isCommandContext(ctx) ? ctx : undefined),
  });

  return runtime;
}

export function createOpenPetsPiRuntime(options: OpenPetsPiOptions = {}): OpenPetsPiRuntime {
  const clientFactory = options.clientFactory ?? (() => createOpenPetsClient({ connectTimeoutMs: automaticTimeoutMs, responseTimeoutMs: automaticTimeoutMs }));
  const schedule = options.schedule ?? defaultSchedule;
  const debug = options.debug === true || process.env.OPENPETS_PI_DEBUG === "1";
  const debugLog = options.debugLog ?? ((message) => {
    if (debug) process.stderr.write(`${message}\n`);
  });
  let client: OpenPetsClient | undefined;
  let recentErrorAt = Number.NEGATIVE_INFINITY;
  let lastErrorSpeechAt = Number.NEGATIVE_INFINITY;

  const getClient = (): OpenPetsClient => {
    client ??= clientFactory();
    return client;
  };

  const runAutomatic = (decision: PiEventDecision | undefined): void => {
    if (!decision?.reaction) return;
    const reaction = decision.reaction;
    if (decision.markError) recentErrorAt = options.now?.() ?? Date.now();
    if (decision.clearError && (options.now?.() ?? Date.now()) - recentErrorAt < errorSuccessSuppressionMs) return;

    try {
      schedule(async () => {
        try {
          if (decision.speech === "error" && shouldSendErrorSpeech()) {
            await getClient().say(validateHookSpeech(pickHookSpeech("error", options.random)), { reaction });
            return;
          }
          await getClient().react(reaction);
        } catch (error) {
          debugLog(`OpenPets Pi extension ignored error: ${sanitizeDebugError(error)}`);
        }
      });
    } catch (error) {
      debugLog(`OpenPets Pi extension scheduling ignored error: ${sanitizeDebugError(error)}`);
    }
  };

  const shouldSendErrorSpeech = (): boolean => {
    const now = options.now?.() ?? Date.now();
    if (now - lastErrorSpeechAt < 20_000) return false;
    lastErrorSpeechAt = now;
    return true;
  };

  return {
    handleEvent(event) {
      try {
        runAutomatic(classifyPiEvent(event));
      } catch (error) {
        debugLog(`OpenPets Pi event ignored error: ${sanitizeDebugError(error)}`);
      }
    },
    async handleCommand(args, ctx) {
      try {
        const command = parseOpenPetsCommand(args);
        await executeCommand(command, getClient(), ctx);
      } catch (error) {
        notify(ctx, sanitizeUserError(error), "error");
      }
    },
  };
}

export function classifyPiEvent(event: unknown): PiEventDecision | undefined {
  const envelope = normalizePiEvent(event);
  const type = envelope.type;
  const record = isRecord(envelope.payload) ? envelope.payload : isRecord(event) ? event : {};
  switch (type) {
    case "session_start":
      return { reaction: "waving" };
    case "session_shutdown":
      return { reaction: "idle" };
    case "agent_start":
      return { reaction: "thinking" };
    case "turn_start":
      return { reaction: "working" };
    case "agent_end":
      return { reaction: "success", clearError: true };
    case "tool_execution_start": {
      const reaction = classifyPiToolExecutionStart(record.toolName, record.args);
      return reaction ? { reaction } : undefined;
    }
    case "tool_execution_end":
      return record.isError === true ? { reaction: "error", speech: "error", markError: true } : undefined;
    default:
      return undefined;
  }
}

export function normalizePiEvent(event: unknown): PiEventEnvelope {
  if (isRecord(event) && typeof event.type === "string") {
    return { type: event.type, payload: "payload" in event ? event.payload : event };
  }
  return { type: "", payload: event };
}

export function classifyPiToolExecutionStart(toolName: unknown, args?: unknown): OpenPetsReaction | undefined {
  const normalized = typeof toolName === "string" ? toolName.toLowerCase() : "";
  if (!normalized || shouldIgnoreOpenPetsTool(normalized)) return undefined;
  if (/edit|write|patch|apply/.test(normalized)) return "editing";
  if (/bash|shell|terminal|exec|command/.test(normalized)) return isTestLikeArgs(args) ? "testing" : "running";
  return "working";
}

export function shouldIgnoreOpenPetsTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9_:/.-]+/g, "_");
  return /(?:^|[_:/.-])openpets(?:[_:/.-]|$)/.test(normalized) || /^openpets_(?:status|say|react)$/.test(normalized);
}

export function parseOpenPetsCommand(args: string): OpenPetsPiCommand {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "help" || trimmed === "--help" || trimmed === "-h") return { kind: "help" };
  const [head = "", ...rest] = trimmed.split(/\s+/);
  const tail = trimmed.slice(head.length).trim();
  switch (head.toLowerCase()) {
    case "status":
      if (rest.length > 0) throw new Error("Usage: /openpets status");
      return { kind: "status" };
    case "test":
      if (rest.length > 0) throw new Error("Usage: /openpets test");
      return { kind: "test" };
    case "react": {
      if (rest.length !== 1) throw new Error("Usage: /openpets react <reaction>");
      return { kind: "react", reaction: validateReaction(rest[0] ?? "") };
    }
    case "say":
      return { kind: "say", message: validateManualSpeech(tail) };
    default:
      throw new Error(`Unknown /openpets command: ${head}`);
  }
}

export function validateManualSpeech(message: string): string {
  const trimmed = message.trim();
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(trimmed)) throw new Error("OpenPets speech must not contain secrets.");
  return validateHookSpeech(trimmed);
}

export function getPiOpenPetsHelp(): string {
  return "OpenPets commands: /openpets status, /openpets test, /openpets react <reaction>, /openpets say <message>.";
}

async function executeCommand(command: OpenPetsPiCommand, client: OpenPetsClient, ctx?: OpenPetsPiCommandContext): Promise<void> {
  switch (command.kind) {
    case "help":
      notify(ctx, getPiOpenPetsHelp(), "info");
      return;
    case "status": {
      const status = await client.status();
      notify(ctx, status.ok ? "OpenPets is connected." : `OpenPets unavailable: ${sanitizeStatusReason(status.unavailableReason)}`, status.ok ? "info" : "warning");
      return;
    }
    case "test":
      await client.say("Pi connected", { reaction: "waving" });
      notify(ctx, "OpenPets test sent.", "info");
      return;
    case "react":
      await client.react(command.reaction);
      notify(ctx, `OpenPets reaction set: ${command.reaction}`, "info");
      return;
    case "say":
      await client.say(command.message);
      notify(ctx, "OpenPets message sent.", "info");
      return;
  }
}

function isTestLikeArgs(args: unknown): boolean {
  const command = isRecord(args) && typeof args.command === "string" ? args.command.slice(0, boundedCommandSliceLength) : "";
  return /\b(test|vitest|jest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|cargo\s+test|go\s+test)\b/i.test(command);
}

function validateReaction(value: string): OpenPetsReaction {
  if (!allowedReactions.includes(value as OpenPetsReaction)) throw new Error("Invalid OpenPets reaction.");
  return value as OpenPetsReaction;
}

function notify(ctx: OpenPetsPiCommandContext | undefined, message: string, type: "info" | "warning" | "error"): void {
  ctx?.ui?.notify?.(message, type);
}

function defaultSchedule(work: () => Promise<void>): void {
  void Promise.resolve().then(work).catch(() => undefined);
}

function sanitizeDebugError(error: unknown): string {
  if (!error) return "unknown";
  if (isRecord(error) && typeof error.code === "string") return sanitizeKnownErrorCode(error.code);
  if (error instanceof Error) return error.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "Error";
  return "unknown";
}

function sanitizeKnownErrorCode(code: string): string {
  const normalized = code.toLowerCase();
  if (normalized.includes("enoent")) return "ENOENT";
  if (normalized.includes("econnrefused")) return "ECONNREFUSED";
  if (normalized.includes("connect_timeout")) return "connect_timeout";
  if (normalized.includes("response_timeout")) return "response_timeout";
  if (normalized.includes("connection_closed")) return "connection_closed";
  if (normalized.includes("unavailable")) return "unavailable";
  return "OpenPetsClientError";
}

function sanitizeUserError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 140) : "OpenPets command failed.";
}

function sanitizeStatusReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason : "not running";
  if (/ENOENT|ECONNREFUSED|connect_timeout|response_timeout|unavailable/i.test(text)) return "not running";
  return "unavailable";
}

function isPiApi(value: unknown): value is OpenPetsPiExtensionApi {
  return isRecord(value) && (typeof value.on === "function" || typeof value.registerCommand === "function");
}

function isCommandContext(value: unknown): value is OpenPetsPiCommandContext {
  return isRecord(value) && (value.ui === undefined || isRecord(value.ui));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

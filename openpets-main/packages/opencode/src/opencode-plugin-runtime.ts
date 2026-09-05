import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { createOpenPetsClient, type OpenPetsClient, type OpenPetsReaction } from "@open-pets/client";
import { pickHookSpeech, type HookSpeechCategory, validateHookSpeech } from "@open-pets/agent-events";

import { sanitizeOpenCodeExcludedReactions, validateOpenPetsPetArg } from "./opencode-previews.js";

export interface OpenCodePluginOptions {
  readonly pet?: string;
  readonly debug?: boolean;
  /** Reactions the user wants suppressed. Excluded reactions are silently dropped before any IPC or throttle work. */
  readonly excludeReactions?: readonly OpenPetsReaction[];
}

export interface OpenCodePluginRuntimeOptions extends OpenCodePluginOptions {
  readonly clientFactory?: () => OpenPetsClient;
  readonly schedule?: (work: () => Promise<void>) => void;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly throttlePath?: string;
  readonly debugLog?: (message: string) => void;
}

export interface OpenCodePluginDecision {
  readonly reaction?: OpenPetsReaction;
  readonly speechCategory?: HookSpeechCategory;
}

export type OpenCodeHooks = {
  readonly event: (input: { readonly event: unknown }) => void;
  readonly "chat.message": (input: unknown, output: unknown) => void;
  readonly "tool.execute.before": (input: { readonly tool?: string }, output: { readonly args?: unknown }) => void;
  readonly "tool.execute.after": (input: { readonly tool?: string }, output: unknown) => void;
};

const speechCooldownMs = 20_000;
const permissionCooldownMs = 3_000;
const reactionCooldownMs = 10_000;

export function isReactionExcluded(reaction: OpenPetsReaction, excludedSet: ReadonlySet<string>): boolean {
  return excludedSet.has(reaction);
}

export function createOpenPetsOpenCodeHooks(options: OpenCodePluginRuntimeOptions = {}): OpenCodeHooks {
  const pet = options.pet === undefined ? undefined : validateOpenPetsPetArg(options.pet);
  const clientFactory = options.clientFactory ?? (() => createOpenPetsClient({ connectTimeoutMs: 500, responseTimeoutMs: 500 }));
  const schedule = options.schedule ?? defaultSchedule;
  const debug = options.debug === true || process.env.OPENPETS_DEBUG === "1";
  const debugLog = options.debugLog ?? ((message) => { if (debug) process.stderr.write(`${message}\n`); });
  const excludedReactions = buildExcludedReactionsSet(options.excludeReactions);
  let client: OpenPetsClient | undefined;
  let lease: { readonly leaseId: string; readonly expiresAt?: number } | undefined;

  const run = (decision: OpenCodePluginDecision | undefined): void => {
    if (!decision?.reaction) return;
    if (isReactionExcluded(decision.reaction, excludedReactions)) return;
    const reaction = decision.reaction;
    try {
      schedule(async () => {
        try {
          const shouldSpeak = decision.speechCategory ? shouldSendSpeech(decision.speechCategory, options) : false;
          const shouldReact = shouldSendReaction(reaction, options);
          if (!shouldSpeak && !shouldReact) return;

          client ??= clientFactory();
          const leaseId = pet ? await getLeaseId(client, pet) : undefined;
          if (decision.speechCategory && shouldSpeak) {
            await client.say(validateHookSpeech(pickHookSpeech(decision.speechCategory, options.random)), { reaction, leaseId });
            return;
          }
          await client.react(reaction, { leaseId });
        } catch (error) {
          debugLog(`OpenPets OpenCode plugin ignored error: ${sanitizeDebugError(error)}`);
        }
      });
    } catch (error) {
      debugLog(`OpenPets OpenCode plugin scheduling ignored error: ${sanitizeDebugError(error)}`);
    }
  };

  const getLeaseId = async (hit: OpenPetsClient, requestedPetId: string): Promise<string | undefined> => {
    if (lease && (!lease.expiresAt || lease.expiresAt - Date.now() > 2_000)) return lease.leaseId;
    try {
      const next = await hit.acquireLease({ requestedPetId });
      lease = { leaseId: next.leaseId, expiresAt: next.expiresAt };
      return next.leaseId;
    } catch (error) {
      debugLog(`OpenPets OpenCode lease unavailable: ${sanitizeDebugError(error)}`);
      return undefined;
    }
  };

  return {
    event(input) {
      try {
        run(classifyOpenCodeBusEvent(input.event));
      } catch (error) {
        debugLog(`OpenPets OpenCode event ignored error: ${sanitizeDebugError(error)}`);
      }
    },
    "chat.message"() {
      run({ reaction: "thinking" });
    },
    "tool.execute.before"(input, output) {
      const tool = typeof input.tool === "string" ? input.tool : "";
      if (shouldIgnoreOpenPetsTool(tool)) return;
      run({ reaction: classifyOpenCodeToolReaction(tool, output.args) });
    },
    "tool.execute.after"() {
      // Intentionally quiet for now; session.error/session.status events provide less noisy completion signals.
    },
  };
}

export function classifyOpenCodeToolReaction(toolName: string, args?: unknown): OpenPetsReaction | undefined {
  const normalized = toolName.toLowerCase();
  if (/edit|write|patch|apply_patch/.test(normalized)) return "editing";
  if (/bash|shell|terminal/.test(normalized)) return isTestLikeToolArgs(args) ? "testing" : undefined;
  return undefined;
}

export function classifyOpenCodeBusEvent(event: unknown): OpenCodePluginDecision | undefined {
  const type = getEventType(event);
  if (type === "permission.asked") return shouldIgnoreOpenPetsTool(getEventPermission(event) ?? "") ? undefined : { reaction: "waiting", speechCategory: "permission" };
  if (type === "session.error") return { reaction: "error", speechCategory: "error" };
  if (type === "session.status" && getEventStatusType(event) === "idle") return { reaction: "success" };
  return undefined;
}

export function shouldIgnoreOpenPetsTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return /(?:^|[_:-])openpets_(?:openpets_)?(?:status|say|react)$/.test(normalized) || /^openpets_(?:status|say|react)$/.test(normalized);
}

export function getDefaultOpenCodeThrottlePath(): string {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "OpenPets", "opencode-hook-throttle.json");
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  if (stateHome) return join(stateHome, "openpets", "opencode-hook-throttle.json");
  return join(tmpdir(), `openpets-${safeUid()}`, "opencode-hook-throttle.json");
}

function shouldSendSpeech(category: HookSpeechCategory, options: OpenCodePluginRuntimeOptions): boolean {
  const now = options.now?.() ?? Date.now();
  const cooldown = category === "permission" ? permissionCooldownMs : speechCooldownMs;
  return shouldSendThrottleKey(category, cooldown, now, options.throttlePath ?? getDefaultOpenCodeThrottlePath());
}

function shouldSendReaction(reaction: OpenPetsReaction, options: OpenCodePluginRuntimeOptions): boolean {
  const now = options.now?.() ?? Date.now();
  return shouldSendThrottleKey(`reaction:${reaction}`, reactionCooldownMs, now, options.throttlePath ?? getDefaultOpenCodeThrottlePath());
}

function shouldSendThrottleKey(key: string, cooldown: number, now: number, path: string): boolean {
  const state = readThrottleState(path);
  const previous = typeof state[key] === "number" ? state[key] : 0;
  if (now - previous < cooldown) return false;
  state[key] = now;
  writeThrottleState(path, state);
  return true;
}

function buildExcludedReactionsSet(excludeReactions?: readonly OpenPetsReaction[]): ReadonlySet<string> {
  const valid = sanitizeOpenCodeExcludedReactions(excludeReactions);
  return valid.length > 0 ? new Set(valid) : emptySet;
}

const emptySet: ReadonlySet<string> = new Set();

function isTestLikeToolArgs(args: unknown): boolean {
  const command = isRecord(args) && typeof args.command === "string" ? args.command.slice(0, 300) : "";
  return /\b(test|vitest|jest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|cargo\s+test|go\s+test)\b/i.test(command);
}

function getEventType(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (typeof event.type === "string") return event.type;
  if (isRecord(event.payload) && typeof event.payload.type === "string") return event.payload.type;
  return undefined;
}

function getEventStatusType(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  const properties = isRecord(event.properties) ? event.properties : isRecord(event.payload) && isRecord(event.payload.properties) ? event.payload.properties : undefined;
  const status = isRecord(properties?.status) ? properties.status : undefined;
  return typeof status?.type === "string" ? status.type : undefined;
}

function getEventPermission(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  const properties = isRecord(event.properties) ? event.properties : isRecord(event.payload) && isRecord(event.payload.properties) ? event.payload.properties : undefined;
  if (typeof properties?.permission === "string") return properties.permission;
  if (Array.isArray(properties?.patterns)) {
    const hit = properties.patterns.find((pattern) => typeof pattern === "string" && shouldIgnoreOpenPetsTool(pattern));
    if (typeof hit === "string") return hit;
  }
  return undefined;
}

function readThrottleState(path: string): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return {};
    const state: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if ((key === "thinking" || key === "success" || key === "error" || key === "permission" || key.startsWith("reaction:")) && typeof value === "number" && Number.isFinite(value)) state[key] = value;
    }
    return state;
  } catch {
    return {};
  }
}

function writeThrottleState(path: string, state: Record<string, number>): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, path);
  } catch {
    // Best effort only; throttling must never break hooks.
  }
}

function defaultSchedule(work: () => Promise<void>): void {
  queueMicrotask(() => { void work(); });
}

function sanitizeDebugError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"']{2,}/g, "<path>")
    .replace(/\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .slice(0, 200);
}

function safeUid(): string {
  try { return String(userInfo().uid); } catch { return "user"; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

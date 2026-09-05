import type { PluginBubbleCallbacks, PluginBubbleDescriptor, PluginBubbleDismissReason, PluginBubbleHostHandle } from "./plugin-sdk-bridge.js";

/**
 * Bubble arbiter (§1.4/§1.5): with several enabled plugins all wanting the
 * bubble, this layer decides who is showing. Two slots per pet:
 *
 * - transient — the rotating bubble; a priority queue with do-not-interrupt
 *   for sticky/urgent content and coalescing of identical back-to-back text.
 * - pinned — a single persistent bubble rendered above the transient slot;
 *   replace semantics honour priority (a low pin cannot evict a higher one).
 *
 * The arbiter is pure scheduling logic. Rendering is delegated to a
 * {@link PetBubbleSink} the Electron layer provides; tests provide a recorder.
 */

export type ArbiterSlot = "transient" | "pinned";

export type ActiveBubble = {
  readonly token: string;
  readonly pluginId: string;
  readonly bubble: PluginBubbleDescriptor;
};

export interface PetBubbleSink {
  /** Render (or clear with null) a slot's content on the pet surface. */
  present(slot: ArbiterSlot, content: ActiveBubble | null): void;
}

type Entry = {
  token: string;
  pluginId: string;
  bubble: PluginBubbleDescriptor;
  callbacks: PluginBubbleCallbacks;
  pinned: boolean;
  timeout: NodeJS.Timeout | null;
  dismissed: boolean;
};

const priorityRank: Record<PluginBubbleDescriptor["priority"], number> = { low: 0, normal: 1, high: 2, urgent: 3 };
const defaultDurationMs = 6_000;
const maxQueueLength = 16;

let nextToken = 0;

export class PetBubbleArbiter {
  readonly #sink: PetBubbleSink;
  readonly #entries = new Map<string, Entry>();
  #current: Entry | null = null;
  #pinned: Entry | null = null;
  readonly #queue: Entry[] = [];

  constructor(sink: PetBubbleSink) {
    this.#sink = sink;
  }

  /** Tokens are prefixed so dismiss callbacks can be routed by the window layer. */
  static isArbiterToken(token: string): boolean {
    return token.startsWith("plugin-bubble:");
  }

  show(pluginId: string, bubble: PluginBubbleDescriptor, callbacks: PluginBubbleCallbacks): PluginBubbleHostHandle {
    const token = `plugin-bubble:${++nextToken}`;
    const entry: Entry = { token, pluginId, bubble, callbacks, pinned: bubble.pin === true, timeout: null, dismissed: false };
    this.#entries.set(token, entry);
    if (entry.pinned) this.#takePinnedSlot(entry);
    else this.#enqueue(entry);
    return {
      id: token,
      update: async (patch) => this.#update(entry, patch),
      dismiss: async () => this.#finish(entry, "manual"),
      pin: async () => { if (!entry.dismissed && !entry.pinned) { this.#removeFromTransient(entry); entry.pinned = true; this.#takePinnedSlot(entry); } },
      unpin: async () => { if (!entry.dismissed && entry.pinned) this.#finish(entry, "unpinned"); },
    };
  }

  /** Routed from the pet window when a rendered bubble fires an action. */
  handleAction(token: string, actionId: string): void {
    const entry = this.#entries.get(token);
    if (!entry || entry.dismissed) return;
    entry.callbacks.onAction(actionId);
    const action = entry.bubble.actions?.find((candidate) => candidate.id === actionId);
    if (!action || action.dismissesBubble) this.#finish(entry, "click");
  }

  /** Routed from the pet window when a rendered bubble's input submits. */
  handleSubmit(token: string, values: Record<string, string | number>): void {
    const entry = this.#entries.get(token);
    if (!entry || entry.dismissed) return;
    entry.callbacks.onSubmit(values);
  }

  /** Routed from the pet window when the user click-dismisses a bubble. */
  handleDismissed(token: string): void {
    const entry = this.#entries.get(token);
    if (entry) this.#finish(entry, "click");
  }

  /** Drop every bubble owned by a plugin (plugin stop/reload). */
  clearPlugin(pluginId: string): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.pluginId === pluginId) this.#finish(entry, "manual");
    }
  }

  snapshot(): { current: ActiveBubble | null; pinned: ActiveBubble | null; queued: number } {
    return {
      current: this.#current ? toActive(this.#current) : null,
      pinned: this.#pinned ? toActive(this.#pinned) : null,
      queued: this.#queue.length,
    };
  }

  #enqueue(entry: Entry): void {
    // Coalesce: identical text from the same plugin back-to-back is dropped.
    const tail = this.#queue[this.#queue.length - 1] ?? this.#current;
    if (tail && !tail.dismissed && tail.pluginId === entry.pluginId && tail.bubble.text !== undefined && tail.bubble.text === entry.bubble.text && tail.bubble.markdownHtml === entry.bubble.markdownHtml) {
      this.#entries.delete(entry.token);
      entry.dismissed = true;
      entry.callbacks.onDismiss("replaced");
      return;
    }
    if (this.#queue.length >= maxQueueLength) {
      const evicted = this.#queue.shift()!;
      this.#finishQueued(evicted, "replaced");
    }
    if (this.#current === null) {
      this.#display(entry);
      return;
    }
    const currentRank = priorityRank[this.#current.bubble.priority];
    const incomingRank = priorityRank[entry.bubble.priority];
    const interruptible = !(this.#current.bubble.sticky === true || this.#current.bubble.priority === "urgent");
    if (incomingRank > currentRank && interruptible) {
      const displaced = this.#current;
      this.#queue.unshift(entry);
      this.#finish(displaced, "replaced");
      return;
    }
    this.#queue.push(entry);
    this.#queue.sort((a, b) => priorityRank[b.bubble.priority] - priorityRank[a.bubble.priority]);
  }

  #display(entry: Entry): void {
    this.#current = entry;
    this.#sink.present("transient", toActive(entry));
    if (!entry.bubble.sticky) {
      const duration = entry.bubble.durationMs ?? defaultDurationMs;
      entry.timeout = setTimeout(() => this.#finish(entry, "timeout"), duration);
      entry.timeout.unref?.();
    } else if (entry.bubble.durationMs !== undefined) {
      entry.timeout = setTimeout(() => this.#finish(entry, "timeout"), entry.bubble.durationMs);
      entry.timeout.unref?.();
    }
  }

  #takePinnedSlot(entry: Entry): void {
    const existing = this.#pinned;
    if (existing && existing !== entry) {
      // Priority applies: a lower pin cannot evict a higher one.
      if (priorityRank[entry.bubble.priority] < priorityRank[existing.bubble.priority]) {
        this.#finishDetached(entry, "replaced");
        return;
      }
      this.#pinned = null;
      this.#finishDetached(existing, "replaced");
    }
    this.#pinned = entry;
    this.#sink.present("pinned", toActive(entry));
    if (entry.bubble.durationMs !== undefined) {
      entry.timeout = setTimeout(() => this.#finish(entry, "timeout"), entry.bubble.durationMs);
      entry.timeout.unref?.();
    }
  }

  #update(entry: Entry, patch: PluginBubbleDescriptor): void {
    if (entry.dismissed) return;
    entry.bubble = { ...entry.bubble, ...stripUndefined(patch), priority: patch.priority ?? entry.bubble.priority };
    if (this.#pinned === entry) this.#sink.present("pinned", toActive(entry));
    else if (this.#current === entry) this.#sink.present("transient", toActive(entry));
  }

  #removeFromTransient(entry: Entry): void {
    if (entry.timeout) { clearTimeout(entry.timeout); entry.timeout = null; }
    const queued = this.#queue.indexOf(entry);
    if (queued >= 0) this.#queue.splice(queued, 1);
    if (this.#current === entry) {
      this.#current = null;
      this.#advance();
    }
  }

  #finish(entry: Entry, reason: PluginBubbleDismissReason): void {
    if (entry.dismissed) return;
    entry.dismissed = true;
    if (entry.timeout) { clearTimeout(entry.timeout); entry.timeout = null; }
    this.#entries.delete(entry.token);
    const queued = this.#queue.indexOf(entry);
    if (queued >= 0) this.#queue.splice(queued, 1);
    if (this.#pinned === entry) {
      this.#pinned = null;
      this.#sink.present("pinned", null);
    }
    if (this.#current === entry) {
      this.#current = null;
      this.#advance();
    }
    entry.callbacks.onDismiss(reason);
  }

  /** Finish without touching the slots (the entry never occupied one). */
  #finishDetached(entry: Entry, reason: PluginBubbleDismissReason): void {
    if (entry.dismissed) return;
    entry.dismissed = true;
    if (entry.timeout) { clearTimeout(entry.timeout); entry.timeout = null; }
    this.#entries.delete(entry.token);
    entry.callbacks.onDismiss(reason);
  }

  #finishQueued(entry: Entry, reason: PluginBubbleDismissReason): void {
    this.#finishDetached(entry, reason);
  }

  #advance(): void {
    const next = this.#queue.shift();
    if (next) this.#display(next);
    else this.#sink.present("transient", null);
  }
}

function toActive(entry: Entry): ActiveBubble {
  return { token: entry.token, pluginId: entry.pluginId, bubble: entry.bubble };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as Partial<T>;
}

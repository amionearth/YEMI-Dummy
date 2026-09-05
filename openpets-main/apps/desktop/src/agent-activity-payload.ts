/**
 * Pure, electron-free helper for building the `agent:activity` plugin event
 * payload. Extracted from plugin-events-source.ts so it can be unit-tested
 * under plain Node without an Electron mock.
 */

export interface AgentActivityInput {
  readonly kind: string;
  readonly reaction?: string;
  readonly petId?: string;
  readonly surface?: "default" | "agent";
}

export interface AgentActivityPayload {
  kind: string;
  reaction: string | undefined;
  active: boolean;
  petId: string;
  surface: "default" | "agent";
}

/**
 * Builds the canonical `agent:activity` event payload.
 * - `active` is `true` for any kind other than `"idle"`.
 * - `petId` falls back to `"default"` when not supplied.
 * - `surface` distinguishes the default-pet surface from agent/session pets.
 */
export function buildAgentActivityPayload(input: AgentActivityInput): AgentActivityPayload {
  const surface = input.surface ?? (input.petId ? "agent" : "default");
  return {
    kind: input.kind,
    reaction: input.reaction,
    active: input.kind !== "idle",
    petId: input.petId ?? "default",
    surface,
  };
}

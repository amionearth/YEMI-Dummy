import { getAppStateSnapshot, recordOpenPetsActivity } from "./app-state.js";
import { applyExternalPetMoveBy, applyExternalPetMoveToHome, applyExternalPetReaction, applyExternalPetSay, applyExternalPetWander, type PetMoveOptions, type PetReactionOptions, type PetWanderOptions } from "./default-pet-controller.js";
import { debug } from "./logger.js";
import type { OpenPetsReaction } from "./local-ipc-protocol.js";

export interface PluginPetApi {
  speak(message: string): void | Promise<void>;
  react(reaction: OpenPetsReaction, options?: PetReactionOptions): void | Promise<void>;
  moveBy(options: PetMoveOptions): void | Promise<void>;
  wander(options: PetWanderOptions): void | Promise<void>;
  moveToHome(): void | Promise<void>;
}

export const defaultPluginPetApi: PluginPetApi = {
  speak(message) {
    applyExternalPetSay(message);
    recordPluginPetActivity({ kind: "say" });
  },
  react(reaction, options) {
    applyExternalPetReaction(reaction, options);
    recordPluginPetActivity({ kind: "react", reaction });
  },
  moveBy(options) { applyExternalPetMoveBy(options); },
  wander(options) { applyExternalPetWander(options); },
  moveToHome() { applyExternalPetMoveToHome(); },
};

function recordPluginPetActivity(activity: { readonly kind: "say"; readonly reaction?: undefined } | { readonly kind: "react"; readonly reaction: OpenPetsReaction }): void {
  try {
    const state = getAppStateSnapshot();
    recordOpenPetsActivity({ ...activity, petId: state.preferences.defaultPetId });
  } catch (error) {
    debug("plugin", "activity record failed", { error: error instanceof Error ? error.message : String(error), kind: activity.kind, reaction: activity.reaction });
  }
}

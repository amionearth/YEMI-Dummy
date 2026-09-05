import type { PluginAssetKind, PluginPermission } from "./plugin-manifest.js";
import type { PluginHostCapabilities } from "./plugin-sdk-bridge.js";
import type { PluginRuntimeState } from "./plugin-sdk-state.js";
import { pluginNamedHostSounds } from "./plugin-sdk-types.js";

export type PluginAudioApi = ReturnType<typeof createPluginAudioApi>;

export function createPluginAudioApi(options: {
  readonly pluginId: string;
  readonly state: PluginRuntimeState;
  readonly capabilities: PluginHostCapabilities;
  readonly requirePermission: (permission: PluginPermission) => void;
  readonly audioPerMinute: number;
  readonly resolveAssetRef: (ref: unknown, kinds: readonly PluginAssetKind[]) => { path: string };
}) {
  const { pluginId, state, capabilities, requirePermission, audioPerMinute, resolveAssetRef } = options;

  const play = async (sound: unknown, playOptions?: unknown) => {
    requirePermission("audio");
    state.audioWindow.tick(audioPerMinute, "audio");
    check(capabilities.settings.audioAllowed(), "Plugin sound is disabled in settings.");
    check(!capabilities.settings.inQuietHours(), "Quiet hours are active.");
    const volume = clampNumber(Number(isRecord(playOptions) && playOptions.volume !== undefined ? playOptions.volume : 0.6), 0, 1);
    if (typeof sound === "string") {
      check(pluginNamedHostSounds.has(sound), `Unknown host sound: ${sound}`);
      await capabilities.audio.play({ kind: "named", name: sound }, volume);
    } else if (isRecord(sound) && sound.kind === "user-sound" && typeof sound.id === "string") {
      await capabilities.audio.play({ kind: "user-sound", pluginId, id: sound.id }, volume);
    } else {
      await capabilities.audio.play({ kind: "file", path: resolveAssetRef(sound, ["sounds"]).path }, volume);
    }
  };

  return {
    play,
    importUserSound: async (file: unknown, opts?: unknown) => {
      requirePermission("audio");
      requirePermission("files");
      const fileId = isRecord(file) && typeof file.fileId === "string" ? file.fileId : String(file);
      check(state.pickedFiles.has(fileId), "Plugin file handle is invalid.");
      const importOptions = isRecord(opts) ? opts : {};
      return capabilities.audio.importUserSound(pluginId, fileId, { name: importOptions.name === undefined ? undefined : String(importOptions.name).slice(0, 80) });
    },
    forgetUserSound: async (ref: unknown) => {
      requirePermission("audio");
      if (!isRecord(ref) || ref.kind !== "user-sound" || typeof ref.id !== "string") throw new Error("Invalid user sound reference.");
      await capabilities.audio.forgetUserSound(pluginId, { kind: "user-sound", id: ref.id });
    },
    stop: async () => { requirePermission("audio"); await capabilities.audio.stop(); },
  };
}

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function clampNumber(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

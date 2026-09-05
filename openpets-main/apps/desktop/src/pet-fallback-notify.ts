// Helper for the "silent pet fallback" warning notification.
//
// When an agent requests a specific pet by ID and the lease manager silently
// falls back to the default pet (because the requested pet is not installed,
// has an invalid ID, or is broken), we surface a native Electron notification
// once per unique requestedPetId so the user understands why window confinement
// is not activating.
//
// electron and logger are lazy-loaded (createRequire) so this module is safe to
// import from the test suite under plain Node (where ESM electron has no named
// exports).

import { createRequire } from "node:module";

import { t } from "./i18n/index.js";

const nodeRequire = createRequire(import.meta.url);

/** Fallback reasons that indicate the user explicitly asked for a pet that is unavailable. */
const WARN_FALLBACK_REASONS = new Set(["pet_not_installed", "invalid_pet_id", "pet_broken"]);

type LoggerModule = typeof import("./logger.js");

function getLogger(): LoggerModule {
  return nodeRequire("./logger.js") as LoggerModule;
}

/**
 * Returns true if a fallback warning notification should be shown for this
 * combination of requestedPetId / fallbackReason, taking the dedup set into
 * account. Does NOT mutate the set.
 */
export function shouldWarnFallback(
  requestedPetId: string | undefined,
  fallbackReason: string | undefined,
  alreadyWarned: Set<string>,
): boolean {
  if (!requestedPetId) return false;
  if (!fallbackReason || !WARN_FALLBACK_REASONS.has(fallbackReason)) return false;
  if (alreadyWarned.has(requestedPetId)) return false;
  return true;
}

/**
 * Fire a native Electron notification warning the user that their requested pet
 * is unavailable and the default pet is being used instead.
 *
 * - Deduped: notifies at most once per requestedPetId via the provided Set.
 * - Non-blocking: notification failures are caught and logged.
 * - No-op when requestedPetId is falsy or the fallback reason is not one that
 *   indicates a user-requested-but-unavailable pet.
 */
export function warnPetFallback(
  requestedPetId: string | undefined,
  fallbackReason: string | undefined,
  alreadyWarned: Set<string>,
): void {
  if (!shouldWarnFallback(requestedPetId, fallbackReason, alreadyWarned)) return;

  // requestedPetId is definitely a string here (shouldWarnFallback checks).
  const petId = requestedPetId as string;

  const { warn, debug } = getLogger();
  warn("ipc", "requested pet unavailable, using default", { requestedPetId: petId, fallbackReason });

  try {
    // Lazy-load Notification to stay importable outside Electron (e.g. tests).
    const { Notification } = nodeRequire("electron") as typeof import("electron");

    if (!Notification.isSupported()) {
      debug("ipc", "pet fallback notification skipped", { reason: "unsupported" });
      alreadyWarned.add(petId);
      return;
    }

    const title = t("pet.fallback.unavailableTitle", { petId });
    const body = t("pet.fallback.unavailableBody", { petId });
    new Notification({ title, body, silent: true }).show();
  } catch (err) {
    debug("ipc", "pet fallback notification failed", { error: err instanceof Error ? err.message : String(err) });
  }

  alreadyWarned.add(petId);
}

export interface LanRetryOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxMissesBeforeHide: number;
  readonly warningIntervalMs: number;
}

export const defaultLanRetryOptions: LanRetryOptions = {
  baseDelayMs: 2_500,
  maxDelayMs: 15_000,
  maxMissesBeforeHide: 3,
  warningIntervalMs: 10_000,
};

export function getLanRetryDelayMs(missedPolls: number, options: LanRetryOptions = defaultLanRetryOptions): number {
  if (!Number.isFinite(missedPolls) || missedPolls <= 0) return options.baseDelayMs;
  const multiplier = 2 ** Math.min(Math.floor(missedPolls), 3);
  return Math.min(options.maxDelayMs, options.baseDelayMs * multiplier);
}

export function shouldHideLanPetAfterMisses(missedPolls: number, options: LanRetryOptions = defaultLanRetryOptions): boolean {
  return missedPolls >= options.maxMissesBeforeHide;
}

export function shouldLogLanPollFailure(now: number, lastWarningAt: number, options: LanRetryOptions = defaultLanRetryOptions): boolean {
  return lastWarningAt === 0 || now - lastWarningAt >= options.warningIntervalMs;
}

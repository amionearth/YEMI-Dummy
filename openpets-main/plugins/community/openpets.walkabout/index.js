// Walkabout (openpets.walkabout) — makes your pet roam the screen with style.
// Supports three modes: wander, follow-cursor, patrol.
/// <reference types="@open-pets/plugin-sdk" />

// ── Constants ─────────────────────────────────────────────────────────────────

export const SCHEDULE_ID = "walkabout-tick";
export const STATUS_ACTIVE = "walkabout";
export const CONFIG_KEY = "config";

/** Duration multipliers per speed setting (ms per move). */
export const SPEED_DURATION = {
  slow: 1800,
  normal: 1100,
  brisk: 600,
};

/** Wander distance per move step (px) — work-area clamped by host. */
export const WANDER_DISTANCE = 120;

/** Patrol uses fixed x-steps; y is kept from current position. */
export const PATROL_STEP_X = 220;

// ── Config helpers ─────────────────────────────────────────────────────────────

/**
 * @param {string|undefined} value
 * @returns {"wander"|"follow-cursor"|"patrol"}
 */
export function normalizeMode(value) {
  const valid = ["wander", "follow-cursor", "patrol"];
  return valid.includes(value) ? value : "wander";
}

/**
 * @param {string|undefined} value
 * @returns {"slow"|"normal"|"brisk"}
 */
export function normalizeSpeed(value) {
  const valid = ["slow", "normal", "brisk"];
  return valid.includes(value) ? value : "slow";
}

/**
 * @param {string|number|undefined} value
 * @returns {number} interval in ms
 */
export function normalizeInterval(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 120) return Math.floor(n) * 1000;
  return 10000;
}

/**
 * @param {unknown} raw
 * @returns {{ mode: string, speed: string, intervalMs: number, pauseWhenBusy: boolean }}
 */
export function cleanConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    mode: normalizeMode(c.mode),
    speed: normalizeSpeed(c.speed),
    intervalMs: normalizeInterval(c.interval ?? 10),
    pauseWhenBusy: c.pauseWhenBusy !== false,
  };
}

// ── Patrol helpers ─────────────────────────────────────────────────────────────

/**
 * Computes the next patrol target given current position.
 * Alternates left and right by PATROL_STEP_X.
 *
 * @param {{ x: number, y: number }} position
 * @param {boolean} goingRight
 * @returns {{ target: { x: number, y: number }, nextDirection: boolean }}
 */
export function nextPatrolTarget(position, goingRight) {
  const dx = goingRight ? PATROL_STEP_X : -PATROL_STEP_X;
  return {
    target: { x: position.x + dx, y: position.y },
    nextDirection: !goingRight,
  };
}

// ── Mode runners ───────────────────────────────────────────────────────────────

/**
 * Starts wander mode. Returns a stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @returns {() => void}
 */
export function startWander(ctx, cfg) {
  let active = true;
  let busy = false;

  async function step() {
    if (!active || busy) return;
    busy = true;
    try {
      await ctx.pet.wander({
        distance: WANDER_DISTANCE,
        durationMs: SPEED_DURATION[cfg.speed],
      });
    } catch (err) {
      ctx.log.warn("wander step failed", err?.message);
    } finally {
      busy = false;
    }
  }

  // Initial step after a short delay so the plugin feels alive immediately.
  const initialTimer = setTimeout(() => step(), 400);
  const intervalId = setInterval(() => step(), cfg.intervalMs);

  return function stop() {
    active = false;
    clearTimeout(initialTimer);
    clearInterval(intervalId);
  };
}

/**
 * Starts follow-cursor mode. Returns a stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @returns {() => void}
 */
export function startFollowCursor(ctx, cfg) {
  // Lag 0 = instant (brisk), 0.85 = slow trail, 0.7 = normal.
  const lagBySpeed = { slow: 0.88, normal: 0.72, brisk: 0.45 };
  const lag = lagBySpeed[cfg.speed];

  let stopped = false;
  ctx.pet.followCursor({ enabled: true, lag }).catch((err) => {
    if (!stopped) ctx.log.warn("followCursor failed", err?.message);
  });

  return function stop() {
    stopped = true;
    ctx.pet.followCursor({ enabled: false }).catch(() => {});
  };
}

/**
 * Starts patrol mode. Returns a stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @returns {() => void}
 */
export function startPatrol(ctx, cfg) {
  let active = true;
  let busy = false;
  let goingRight = true;

  async function step() {
    if (!active || busy) return;
    busy = true;
    try {
      const state = await ctx.pet.getState();
      const { target, nextDirection } = nextPatrolTarget(state.position, goingRight);
      goingRight = nextDirection;
      await ctx.pet.moveTo(target, { durationMs: SPEED_DURATION[cfg.speed], easing: "ease-in-out" });
    } catch (err) {
      ctx.log.warn("patrol step failed", err?.message);
    } finally {
      busy = false;
    }
  }

  const initialTimer = setTimeout(() => step(), 300);
  const intervalId = setInterval(() => step(), cfg.intervalMs);

  return function stop() {
    active = false;
    clearTimeout(initialTimer);
    clearInterval(intervalId);
  };
}

// ── Mode factory ───────────────────────────────────────────────────────────────

/**
 * Starts the appropriate mode and returns its stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @returns {() => void}
 */
function startModeRunner(ctx, cfg) {
  switch (cfg.mode) {
    case "follow-cursor": return startFollowCursor(ctx, cfg);
    case "patrol":        return startPatrol(ctx, cfg);
    default:              return startWander(ctx, cfg);
  }
}

export function startMode(ctx, cfg) {
  return startModeRunner(ctx, cfg);
}

// ── Plugin entry ───────────────────────────────────────────────────────────────

/**
 * Plugin registration (called by the OpenPets runtime).
 * @param {import("@open-pets/plugin-sdk").OpenPetsPluginEntry} OpenPetsPlugin
 */
export function register(OpenPetsPlugin) {
  let cleanup = () => {};

  OpenPetsPlugin.register({
    async start(ctx) {
      cleanup();
      let active = true;
      let cfg = cleanConfig(await ctx.config.get());
      let stopCurrentMode = startMode(ctx, cfg);

      // Set a visible status so the user can see the plugin is active.
      await ctx.status.set({ text: ctx.t("status.active", { mode: cfg.mode }), tone: "info" });

      // Transient-pulse busy gate — resumes automatically via timer.
      // Production never emits kind:"idle"/active:false, so the old enter/exit
      // model would pause forever. Instead: each activity pulse restarts a
      // self-cancelling timer; when it fires the pet walks again.
      /** @type {ReturnType<typeof setTimeout>|null} */
      let resumeTimer = null;
      let resumeGeneration = 0;

      // React to config changes — tear down old mode, spin up new one.
      // Also cancels any pending resume so a stale timer cannot restart a
      // mode that belongs to the old config.
      const unsubConfig = ctx.config.onChange(async (newRaw) => {
        if (!active) return;
        const newCfg = cleanConfig(newRaw);
        clearTimeout(resumeTimer);
        resumeTimer = null;
        stopCurrentMode();
        cfg = newCfg;
        stopCurrentMode = startMode(ctx, cfg);
        await ctx.status.set({ text: ctx.t("status.active", { mode: cfg.mode }), tone: "info" });
      });

      // Pause on agent:activity — transient pulse model scoped to default pet.
      // - Ignores events from other session pets (cross-session leak fix).
      // - Only reacts to active:true pulses; no active:false branch needed.
      // NOTE: walkabout drives only ctx.pet (the default pet). Multi-pet driving
      // via ctx.pets.list() is deferred — pool/lease pets are not motion-addressable.
      const unsubActivity = ctx.events.on("agent:activity", async (event) => {
        if (!cfg.pauseWhenBusy) return;
        if ((event?.surface ?? "default") !== "default") return; // ignore other surfaces
        if (event?.petId && event.petId !== "default") return;   // ignore other sessions' pets
        if (event?.active !== true) return;                    // only react to activity pulses

        const generation = ++resumeGeneration;
        stopCurrentMode();
        clearTimeout(resumeTimer);
        await ctx.status.set({ text: ctx.t("status.paused"), tone: "warning" });
        if (!active || generation !== resumeGeneration) return;

        resumeTimer = setTimeout(() => {
          if (!active || generation !== resumeGeneration) return;
          resumeTimer = null;
          stopCurrentMode();
          stopCurrentMode = startMode(ctx, cfg);
          ctx.status.set({ text: ctx.t("status.active", { mode: cfg.mode }), tone: "info" }).catch(() => {});
        }, cfg.intervalMs * 2);
      });

      cleanup = function stopWalkabout() {
        active = false;
        resumeGeneration += 1;
        clearTimeout(resumeTimer);
        resumeTimer = null;
        stopCurrentMode();
        unsubConfig();
        unsubActivity();
        ctx.status.clear().catch(() => {});
      };
    },
    stop() {
      cleanup();
      cleanup = () => {};
    },
  });
}

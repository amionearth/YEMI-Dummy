// Water Reminder (openpets.water-reminder) — a small official SDK v3 appliance.

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * 60_000;
export const SNOOZE_MS = 15 * MINUTE_MS;
export const SCHEDULE_ID = "water-reminder-next";

const PACE_MS = {
  gentle: 60 * MINUTE_MS,
  normal: 45 * MINUTE_MS,
  often: 30 * MINUTE_MS,
};

export function paceDelayMs(pace = "normal") {
  return PACE_MS[pace] ?? PACE_MS.normal;
}

function localDateKey(ms = Date.now()) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextLocalDayMs(ms = Date.now()) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

function dayIndex(ms) {
  const d = new Date(ms);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY_MS);
}

export function cleanState(value = {}) {
  const state = value && typeof value === "object" ? value : {};
  return {
    lastDrinkAt: Number.isFinite(state.lastDrinkAt) ? state.lastDrinkAt : 0,
    pausedUntil: Number.isFinite(state.pausedUntil) ? state.pausedUntil : 0,
    lastStreakCelebratedDate:
      typeof state.lastStreakCelebratedDate === "string" ? state.lastStreakCelebratedDate : "",
    streakDays: Number.isFinite(state.streakDays) && state.streakDays > 0 ? Math.floor(state.streakDays) : 0,
    nextDueAt: Number.isFinite(state.nextDueAt) ? state.nextDueAt : 0,
  };
}

async function getState(ctx) {
  return cleanState(await ctx.storage.get("state"));
}

async function saveState(ctx, state) {
  const cleaned = cleanState(state);
  await ctx.storage.set("state", cleaned);
  return cleaned;
}

export function recordDrinkState(state, now = Date.now()) {
  const current = cleanState(state);
  const today = localDateKey(now);
  if (current.lastStreakCelebratedDate === today) {
    return { ...current, lastDrinkAt: now, pausedUntil: 0 };
  }
  const previous = current.lastDrinkAt ? dayIndex(current.lastDrinkAt) : null;
  const currentDay = dayIndex(now);
  const streakDays = previous === currentDay - 1 ? current.streakDays + 1 : 1;
  return {
    ...current,
    lastDrinkAt: now,
    pausedUntil: 0,
    lastStreakCelebratedDate: today,
    streakDays,
  };
}

async function config(ctx) {
  return (await ctx.config.get()) ?? {};
}

async function scheduleNext(ctx, delayMs) {
  const state = await getState(ctx);
  const now = Date.now();
  const target = Math.max(now + Math.max(1, delayMs), state.pausedUntil || 0);
  await scheduleAt(ctx, target, state);
}

async function scheduleAt(ctx, target, state) {
  state ??= await getState(ctx);
  const now = Date.now();
  await ctx.schedule.cancel(SCHEDULE_ID);
  await saveState(ctx, { ...state, nextDueAt: target });
  await ctx.schedule.once(SCHEDULE_ID, Math.max(1, target - now), () => fireScheduledReminder(ctx, target));
}

async function fireScheduledReminder(ctx, dueAt) {
  const state = await getState(ctx);
  if (state.nextDueAt !== dueAt) return false;

  const now = Date.now();
  if (now < dueAt) {
    await scheduleAt(ctx, dueAt, state);
    return false;
  }
  return fireReminder(ctx);
}

async function scheduleFromState(ctx) {
  const state = await getState(ctx);
  const cfg = await config(ctx);
  const now = Date.now();
  const base = state.pausedUntil && state.pausedUntil > now ? state.pausedUntil : now + paceDelayMs(cfg.pace);
  await scheduleNext(ctx, Math.max(1, base - now));
}

async function recordDrink(ctx, speechKey = null) {
  const now = Date.now();
  const state = recordDrinkState(await getState(ctx), now);
  const cfg = await config(ctx);
  await scheduleAt(ctx, now + paceDelayMs(cfg.pace), state);
  if (speechKey) await ctx.pet.speak(ctx.t(speechKey, { streakDays: state.streakDays }));
  return state;
}

export async function pauseToday(ctx) {
  const pausedUntil = nextLocalDayMs();
  const state = { ...(await getState(ctx)), pausedUntil, nextDueAt: pausedUntil };
  await scheduleAt(ctx, pausedUntil, state);
  return cleanState(state);
}

let activeAlert = null;

export async function fireReminder(ctx) {
  const state = await getState(ctx);
  const now = Date.now();
  if (state.pausedUntil && state.pausedUntil > now) {
    await scheduleNext(ctx, state.pausedUntil - now);
    return false;
  }
  if (activeAlert) {
    await scheduleNext(ctx, MINUTE_MS);
    return false;
  }

  const cfg = await config(ctx);
  const waterIcon = ctx.assets.icon("water");
  const alertSpec = {
    text: ctx.t("bubble.reminder"),
    indicator: {
      icon: waterIcon,
      label: ctx.t("indicator.water"),
      tone: "info",
      color: "#0ea5e9",
      background: "#e0f2fe",
      borderColor: "#7dd3fc",
    },
    tone: "info",
    dismissOn: ["action", "petClick", "click"],
    actions: [
      { id: "done", label: ctx.t("action.done"), style: "primary" },
      { id: "later", label: ctx.t("action.later") },
    ],
  };
  if (cfg.customSound) alertSpec.sound = cfg.customSound;

  try {
    activeAlert = await ctx.ui.alert(alertSpec);
    activeAlert.onDismiss(async () => {
      if (!activeAlert) return;
      activeAlert = null;
      await scheduleNext(ctx, paceDelayMs(cfg.pace));
    });
    activeAlert.onAction(async (actionId) => {
      activeAlert = null;
      if (actionId === "done") {
        await recordDrink(ctx);
      } else if (actionId === "later") {
        const next = Date.now() + SNOOZE_MS;
        await saveState(ctx, { ...(await getState(ctx)), nextDueAt: next });
        await scheduleNext(ctx, SNOOZE_MS);
      }
    });
  } catch {
    activeAlert = null;
    await scheduleNext(ctx, paceDelayMs(cfg.pace));
    try {
      await ctx.pet.speak(ctx.t("bubble.reminder"));
    } catch {}
  }
  return true;
}

export async function reconcile(ctx) {
  await ctx.schedule.cancel(SCHEDULE_ID);
  activeAlert = null;
  await scheduleFromState(ctx);
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await reconcile(ctx);

      await ctx.commands.register(
        {
          id: "test-reminder",
          title: "$t:command.testReminder.title",
          description: "$t:command.testReminder.description",
          icon: "droplet",
        },
        () => fireReminder(ctx),
      );

      await ctx.commands.register(
        {
          id: "drink-now",
          title: "$t:command.drinkNow.title",
          description: "$t:command.drinkNow.description",
          icon: "check",
        },
        () => recordDrink(ctx, "speech.done"),
      );

      await ctx.commands.register(
        {
          id: "pause-today",
          title: "$t:command.pauseToday.title",
          description: "$t:command.pauseToday.description",
          icon: "pause",
        },
        async () => {
          await pauseToday(ctx);
          await ctx.pet.speak(ctx.t("speech.paused"));
        },
      );
    },
    async stop() {
      activeAlert = null;
    },
  });
}

// Morning & Evening Routine (openpets.day-routine) — gentle SDK v3 daily companion check-ins.

export const MORNING_SCHEDULE_ID = "day-routine-morning";
export const EVENING_SCHEDULE_ID = "day-routine-evening";
export const LAST_MORNING_KEY = "lastMorningDate";
export const LAST_EVENING_KEY = "lastEveningDate";
export const PAUSED_DATE_KEY = "pausedDate";

const DAY_MS = 24 * 60 * 60_000;

export function localDateKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseTime(value, fallback) {
  const text = typeof value === "string" ? value : fallback;
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return parseTime(fallback, "09:00");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return parseTime(fallback, "09:00");
  return { hour, minute };
}

function normalizeTime(value, fallback) {
  const { hour, minute } = parseTime(value, fallback);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function nextLocalTimeMs(time, now = Date.now()) {
  const { hour, minute } = parseTime(time, "09:00");
  const d = new Date(now);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime();
  return target > now ? target : target + DAY_MS;
}

async function config(ctx) {
  return (await ctx.config.get()) ?? {};
}

async function isPausedToday(ctx) {
  return (await ctx.storage.get(PAUSED_DATE_KEY)) === localDateKey();
}

async function scheduleOne(ctx, id, time, handler) {
  await ctx.schedule.cancel(id);
  await ctx.schedule.daily(id, normalizeTime(time, "09:00"), handler);
}

export async function scheduleRoutines(ctx) {
  const cfg = await config(ctx);
  if (cfg.enableMorning !== false) {
    await scheduleOne(ctx, MORNING_SCHEDULE_ID, cfg.morningTime || "09:00", () => fireMorning(ctx));
  } else {
    await ctx.schedule.cancel(MORNING_SCHEDULE_ID);
  }
  if (cfg.enableEvening !== false) {
    await scheduleOne(ctx, EVENING_SCHEDULE_ID, cfg.eveningTime || "21:00", () => fireEvening(ctx));
  } else {
    await ctx.schedule.cancel(EVENING_SCHEDULE_ID);
  }
}

async function speakOnceToday(ctx, storageKey, speechKey, { force = false } = {}) {
  const today = localDateKey();
  if (!force && (await ctx.storage.get(storageKey)) === today) return false;
  if (!force && (await isPausedToday(ctx))) return false;
  await ctx.storage.set(storageKey, today);
  await ctx.pet.speak(routineSpeechSpec(ctx, ctx.t(speechKey)));
  return true;
}

function routineSpeechSpec(ctx, text) {
  return {
    text,
    indicator: {
      icon: ctx.assets.icon("routine"),
      label: ctx.t("plugin.name"),
      tone: "info",
      color: "#f97316",
      background: "#ffedd5",
      borderColor: "#fdba74",
    },
    tone: "info",
  };
}

export async function fireMorning(ctx, opts = {}) {
  const fired = await speakOnceToday(ctx, LAST_MORNING_KEY, "speech.morning", opts);
  await scheduleRoutines(ctx);
  return fired;
}

export async function fireEvening(ctx, opts = {}) {
  const fired = await speakOnceToday(ctx, LAST_EVENING_KEY, "speech.evening", opts);
  await scheduleRoutines(ctx);
  return fired;
}

export async function pauseToday(ctx) {
  await ctx.storage.set(PAUSED_DATE_KEY, localDateKey());
  await ctx.pet.speak(routineSpeechSpec(ctx, ctx.t("speech.paused")));
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await scheduleRoutines(ctx);
      const routineIcon = ctx.assets.icon("routine");
      await ctx.commands.register({ id: "morning-now", title: "$t:command.morningNow.title", description: "$t:command.morningNow.description", icon: routineIcon }, () => fireMorning(ctx, { force: true }));
      await ctx.commands.register({ id: "evening-now", title: "$t:command.eveningNow.title", description: "$t:command.eveningNow.description", icon: routineIcon }, () => fireEvening(ctx, { force: true }));
      await ctx.commands.register({ id: "pause-today", title: "$t:command.pauseToday.title", description: "$t:command.pauseToday.description", icon: "pause" }, () => pauseToday(ctx));
    },
    async stop() {},
  });
}

// Mood Check-in (openpets.mood-check-in) — gentle once-a-day SDK v3 check-in.

export const STORAGE_KEY = "mood-check-in-state";
export const SCHEDULE_ID = "mood-check-in-daily";
export const DAY_MS = 24 * 60 * 60_000;
export const MAX_HISTORY = 14;
export const MOODS = ["great", "okay", "tired", "stressed"];

export function todayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function normalizeTime(value) {
  const match = typeof value === "string" ? value.match(/^(\d{1,2}):(\d{2})$/) : null;
  const hours = match ? Number(match[1]) : 16;
  const minutes = match ? Number(match[2]) : 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "16:00";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function nextCheckInMs(time = "16:00", now = Date.now()) {
  const [hours, minutes] = normalizeTime(time).split(":").map(Number);
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function cleanState(value) {
  const state = value && typeof value === "object" ? value : {};
  const history = Array.isArray(state.history)
    ? state.history
        .filter((entry) => entry && typeof entry.date === "string" && MOODS.includes(entry.mood))
        .slice(-MAX_HISTORY)
    : [];
  return {
    lastPromptDate: typeof state.lastPromptDate === "string" ? state.lastPromptDate : "",
    pausedDate: typeof state.pausedDate === "string" ? state.pausedDate : "",
    nextDueAt: typeof state.nextDueAt === "number" ? state.nextDueAt : 0,
    history,
  };
}

export function addMood(history = [], mood, now = Date.now()) {
  const date = todayKey(now);
  return [
    ...history.filter((entry) => entry.date !== date),
    { date, mood, at: now },
  ].slice(-MAX_HISTORY);
}

async function state(ctx) {
  return cleanState(await ctx.storage.get(STORAGE_KEY));
}

async function save(ctx, next) {
  await ctx.storage.set(STORAGE_KEY, cleanState(next));
}

async function config(ctx) {
  return (await ctx.config.get()) ?? {};
}

export async function scheduleNext(ctx) {
  await ctx.schedule.cancel(SCHEDULE_ID);
  const cfg = await config(ctx);
  const dueAt = nextCheckInMs(cfg.checkInTime, Date.now());
  const current = await state(ctx);
  await save(ctx, { ...current, nextDueAt: dueAt });
  await ctx.schedule.once(SCHEDULE_ID, Math.max(1, dueAt - Date.now()), () => maybeCheckIn(ctx));
}

export async function maybeCheckIn(ctx, { force = false } = {}) {
  const current = await state(ctx);
  const today = todayKey();
  if (!force && (current.pausedDate === today || current.lastPromptDate === today)) {
    await scheduleNext(ctx);
    return false;
  }
  await save(ctx, { ...current, lastPromptDate: today });
  await showCheckIn(ctx);
  await scheduleNext(ctx);
  return true;
}

async function showCheckIn(ctx) {
  const alert = await ctx.ui.alert({
    text: ctx.t("checkin.text"),
    indicator: {
      icon: ctx.assets.icon("mood"),
      label: ctx.t("indicator.label"),
      tone: "info",
      color: "#db2777",
      background: "#fce7f3",
      borderColor: "#f9a8d4",
    },
    tone: "info",
    dismissOn: ["action", "petClick", "click"],
    actions: MOODS.map((mood) => ({ id: mood, label: ctx.t(`mood.${mood}`), style: mood === "great" ? "primary" : undefined })),
  });
  alert.onAction((id) => recordMood(ctx, id));
}

export async function recordMood(ctx, mood) {
  if (!MOODS.includes(mood)) return false;
  const current = await state(ctx);
  await save(ctx, { ...current, history: addMood(current.history, mood), lastPromptDate: todayKey() });
  await ctx.pet.speak(ctx.t(`support.${mood}`));
  return true;
}

export async function pauseToday(ctx) {
  const current = await state(ctx);
  await save(ctx, { ...current, pausedDate: todayKey() });
  await ctx.schedule.cancel(SCHEDULE_ID);
  await scheduleNext(ctx);
  await ctx.pet.speak(ctx.t("speech.pausedToday"));
}

export async function showSummary(ctx) {
  const current = await state(ctx);
  const recent = current.history.slice(-7);
  if (!recent.length) {
    await ctx.pet.speak(ctx.t("summary.empty"));
    return;
  }
  const counts = Object.fromEntries(MOODS.map((mood) => [mood, recent.filter((entry) => entry.mood === mood).length]));
  const top = MOODS.reduce((best, mood) => (counts[mood] > counts[best] ? mood : best), MOODS[0]);
  await ctx.pet.speak(ctx.t("summary.recent", { count: recent.length, mood: ctx.t(`mood.${top}`) }));
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await scheduleNext(ctx);
      const icon = ctx.assets.icon("mood");
      await ctx.commands.register(
        { id: "check-in-now", title: "$t:command.checkInNow.title", description: "$t:command.checkInNow.description", icon },
        () => maybeCheckIn(ctx, { force: true }),
      );
      await ctx.commands.register(
        { id: "mood-summary", title: "$t:command.summary.title", description: "$t:command.summary.description", icon },
        () => showSummary(ctx),
      );
      await ctx.commands.register(
        { id: "pause-today", title: "$t:command.pauseToday.title", description: "$t:command.pauseToday.description", icon },
        () => pauseToday(ctx),
      );
    },
  });
}

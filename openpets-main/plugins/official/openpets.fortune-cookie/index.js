// Daily Fortune Cookie (openpets.fortune-cookie) — cozy SDK v3 daily notes.

export const SCHEDULE_ID = "fortune-cookie-daily";
export const STATE_KEY = "state";
export const DEFAULT_DAILY_TIME = "10:00";
export const FORTUNE_COUNT = 12;

export function localDateKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function normalizeDailyTime(value) {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match) return DEFAULT_DAILY_TIME;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return DEFAULT_DAILY_TIME;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function fortuneIndexForDate(dateKey, count = FORTUNE_COUNT) {
  let hash = 2166136261;
  for (const ch of String(dateKey)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, count);
}

export function cleanState(value = {}) {
  const state = value && typeof value === "object" ? value : {};
  return {
    lastShownDate: typeof state.lastShownDate === "string" ? state.lastShownDate : "",
    anotherOffset: Number.isFinite(state.anotherOffset) && state.anotherOffset >= 0 ? Math.floor(state.anotherOffset) : 0,
  };
}

async function getState(ctx) {
  return cleanState(await ctx.storage.get(STATE_KEY));
}

async function saveState(ctx, state) {
  const cleaned = cleanState(state);
  await ctx.storage.set(STATE_KEY, cleaned);
  return cleaned;
}

async function config(ctx) {
  return (await ctx.config.get()) ?? {};
}

function fortuneKey(index) {
  return `fortune.${index}`;
}

async function speakFortune(ctx, index, introKey) {
  const icon = ctx.assets.icon("fortune");
  await ctx.pet.speak({
    text: ctx.t("speech.fortune", { intro: ctx.t(introKey), fortune: ctx.t(fortuneKey(index)) }),
    indicator: {
      icon,
      label: ctx.t("plugin.name"),
      tone: "info",
      color: "#d97706",
      background: "#fef3c7",
      borderColor: "#fbbf24",
    },
    tone: "info",
  });
}

export async function showTodayFortune(ctx, { markShown = false } = {}) {
  const today = localDateKey();
  const index = fortuneIndexForDate(today);
  await speakFortune(ctx, index, "intro.today");
  if (markShown) await saveState(ctx, { ...(await getState(ctx)), lastShownDate: today });
  return index;
}

export async function showAnotherFortune(ctx) {
  const state = await getState(ctx);
  const todayIndex = fortuneIndexForDate(localDateKey());
  const nextOffset = (state.anotherOffset % Math.max(1, FORTUNE_COUNT - 1)) + 1;
  const index = (todayIndex + nextOffset) % FORTUNE_COUNT;
  await speakFortune(ctx, index, "intro.another");
  await saveState(ctx, { ...state, anotherOffset: nextOffset });
  return index;
}

export async function fireDailyFortune(ctx) {
  const today = localDateKey();
  const state = await getState(ctx);
  if (state.lastShownDate === today) return false;
  await showTodayFortune(ctx, { markShown: true });
  return true;
}

export async function reconcile(ctx) {
  await ctx.schedule.cancel(SCHEDULE_ID);
  const cfg = await config(ctx);
  await ctx.schedule.daily(SCHEDULE_ID, normalizeDailyTime(cfg.dailyTime), () => fireDailyFortune(ctx));
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await reconcile(ctx);
      const fortuneIcon = ctx.assets.icon("fortune");
      await ctx.commands.register(
        {
          id: "today-fortune",
          title: "$t:command.today.title",
          description: "$t:command.today.description",
          icon: fortuneIcon,
        },
        () => showTodayFortune(ctx),
      );
      await ctx.commands.register(
        {
          id: "another-fortune",
          title: "$t:command.another.title",
          description: "$t:command.another.description",
          icon: fortuneIcon,
        },
        () => showAnotherFortune(ctx),
      );
    },
    async stop() {},
  });
}

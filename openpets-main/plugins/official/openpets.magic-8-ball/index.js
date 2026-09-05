// Magic 8-ball (openpets.magic-8-ball) — official SDK v3 plugin.

export const HISTORY_KEY = "history";
export const MAX_HISTORY = 8;
export const ANSWER_COUNT = 16;
export const MAX_QUESTION_LENGTH = 160;

export function cleanQuestion(value) {
  return typeof value === "string"
    ? value.trim().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").slice(0, MAX_QUESTION_LENGTH).trim()
    : "";
}

export function normalizeHistory(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.answerKey === "string" && Number.isFinite(item.askedAt))
        .slice(0, MAX_HISTORY)
    : [];
}

export function pickAnswerKey(random = Math.random) {
  const index = Math.floor(Math.max(0, Math.min(0.999999, random())) * ANSWER_COUNT) + 1;
  return `answer.${index}`;
}

async function getHistory(ctx) {
  return normalizeHistory(await ctx.storage.get(HISTORY_KEY));
}

async function saveAnswer(ctx, entry) {
  const history = [entry, ...(await getHistory(ctx))].slice(0, MAX_HISTORY);
  await ctx.storage.set(HISTORY_KEY, history);
  return history;
}

function speakSpec(ctx, text) {
  const icon = ctx.assets?.icon ? ctx.assets.icon("magic8") : undefined;
  return icon
    ? {
        text,
        indicator: {
          icon,
          label: ctx.t("plugin.name"),
          tone: "info",
          color: "#7c3aed",
          background: "#ede9fe",
          borderColor: "#c4b5fd",
        },
        tone: "info",
      }
    : text;
}

export async function askMagic8Ball(ctx, values = {}) {
  const question = cleanQuestion(values.question);
  const answerKey = pickAnswerKey();
  const answer = ctx.t(answerKey);
  const speech = question
    ? ctx.t("speech.answerWithQuestion", { question, answer })
    : ctx.t("speech.answer", { answer });
  await saveAnswer(ctx, { askedAt: Date.now(), question, answerKey });
  await ctx.pet.speak(speakSpec(ctx, speech));
  return { question, answerKey, answer };
}

export async function showLastAnswer(ctx) {
  const [last] = await getHistory(ctx);
  if (!last) {
    await ctx.pet.speak(speakSpec(ctx, ctx.t("speech.noHistory")));
    return null;
  }
  const answer = ctx.t(last.answerKey);
  const speech = last.question
    ? ctx.t("speech.lastWithQuestion", { question: last.question, answer })
    : ctx.t("speech.last", { answer });
  await ctx.pet.speak(speakSpec(ctx, speech));
  return last;
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const icon = ctx.assets.icon("magic8");

      await ctx.commands.register(
        {
          id: "ask-decision",
          title: "$t:command.askDecision.title",
          description: "$t:command.askDecision.description",
          icon,
          form: {
            submitLabel: "$t:command.askDecision.submit",
            fields: [
              {
                id: "question",
                type: "textarea",
                label: "$t:form.question.label",
                description: "$t:form.question.description",
                required: false,
                maxLength: MAX_QUESTION_LENGTH,
              },
            ],
          },
        },
        (values) => askMagic8Ball(ctx, values),
      );

      await ctx.commands.register(
        {
          id: "quick-answer",
          title: "$t:command.quickAnswer.title",
          description: "$t:command.quickAnswer.description",
          icon,
        },
        () => askMagic8Ball(ctx),
      );

      await ctx.commands.register(
        {
          id: "show-last",
          title: "$t:command.showLast.title",
          description: "$t:command.showLast.description",
          icon,
        },
        () => showLastAnswer(ctx),
      );
    },
    async stop() {},
  });
}

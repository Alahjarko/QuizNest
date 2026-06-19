import { getAll, put } from "./storage/db.js";

const STORE = "modelUsage";

function nowIso() {
  return new Date().toISOString();
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createUsageId() {
  return `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const asciiCount = text.length - cjkCount;
  return Math.max(1, Math.ceil(cjkCount * 0.9 + asciiCount / 4));
}

function pickNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return 0;
}

// 多模态消息中的 image_url 可能包含数 MB 的 base64 图片数据，
// 这些不应影响 token 估算，也不会存入 IndexedDB（本函数只存 token 数）。
// 将 base64 图片替换为简短占位符，避免估算值虚高。
function stripImageUrlsFromMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (typeof msg.content === "string") return msg;
    if (!Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
          return { ...part, image_url: { url: "[image-stripped]" } };
        }
        return part;
      })
    };
  });
}

function normalizeUsage(usage, messages, completion) {
  const promptTokens = pickNumber(usage?.prompt_tokens, usage?.promptTokens, usage?.input_tokens, usage?.inputTokens);
  const completionTokens = pickNumber(
    usage?.completion_tokens,
    usage?.completionTokens,
    usage?.output_tokens,
    usage?.outputTokens
  );
  const totalTokens = pickNumber(usage?.total_tokens, usage?.totalTokens, usage?.total);

  if (promptTokens || completionTokens || totalTokens) {
    const resolvedTotal = totalTokens || promptTokens + completionTokens;
    return {
      promptTokens,
      completionTokens,
      totalTokens: resolvedTotal,
      estimated: false
    };
  }

  const strippedMessages = stripImageUrlsFromMessages(messages);
  const estimatedPrompt = estimateTokens(strippedMessages);
  const estimatedCompletion = estimateTokens(completion);
  return {
    promptTokens: estimatedPrompt,
    completionTokens: estimatedCompletion,
    totalTokens: estimatedPrompt + estimatedCompletion,
    estimated: true
  };
}

export async function recordModelUsage({ role, config, usage, messages, completion, stream = false }) {
  try {
    const normalized = normalizeUsage(usage, messages, completion);
    await put(STORE, {
      id: createUsageId(),
      date: todayKey(),
      role,
      modelName: config?.modelName || "未命名模型",
      baseUrl: config?.baseUrl || "",
      promptTokens: normalized.promptTokens,
      completionTokens: normalized.completionTokens,
      totalTokens: normalized.totalTokens,
      estimated: normalized.estimated,
      stream,
      createdAt: nowIso()
    });
  } catch (error) {
    console.warn("模型用量记录失败", error);
  }
}

export async function getModelUsageRecords() {
  return getAll(STORE);
}

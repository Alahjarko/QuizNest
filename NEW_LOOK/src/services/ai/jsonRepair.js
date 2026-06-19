export function parseAiJson(text) {
  if (typeof text !== "string") {
    throw new Error("AI 返回内容不是文本，无法解析 JSON");
  }

  const raw = text.trim();
  if (!raw) throw new Error("AI 返回内容为空");

  try {
    return JSON.parse(raw);
  } catch {
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        // Continue to the object extraction fallback below.
      }
    }

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch {
        // Fall through to the explicit error.
      }
    }
  }

  throw new Error("AI 返回内容不是合法 JSON，请检查模型能力或重试");
}

export function toPromptJson(value) {
  return JSON.stringify(value, null, 2);
}

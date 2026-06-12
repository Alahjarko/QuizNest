import { getSettings } from "../storage/db.js";
import { parseAiJson } from "./jsonRepair.js";
import { chatCompletions, chatCompletionsStream } from "../tauriBridge.js";
import { recordModelUsage } from "../modelUsageTracker.js";

const DEFAULT_TIMEOUT_MS = 180000;
const MIN_TIMEOUT_BY_ROLE = {
  question: 180000,
  grading: 120000,
  chat: 60000
};

function resolveTimeoutMs(settings, role, timeoutMs) {
  const configured = Number(timeoutMs || settings.timeoutMs || DEFAULT_TIMEOUT_MS);
  const minimum = MIN_TIMEOUT_BY_ROLE[role] || DEFAULT_TIMEOUT_MS;
  return Math.max(configured, minimum);
}

function legacyRoleModel(settings, role) {
  if (role === "grading") return settings.gradingModel;
  if (role === "chat") return settings.chatModel || settings.questionModel;
  return settings.questionModel;
}

function normalizeConfig(config = {}) {
  return {
    baseUrl: String(config.baseUrl || "").trim(),
    apiKey: String(config.apiKey || "").trim(),
    modelName: String(config.modelName || config.model || "").trim(),
    supportsVision: true
  };
}

export function resolveRoleConfig(settings, role = "question") {
  const common = {
    baseUrl: settings.commonBaseUrl || settings.baseUrl || settings.questionConfig?.baseUrl || "",
    apiKey: settings.commonApiKey || settings.apiKey || settings.questionConfig?.apiKey || "",
    modelName: legacyRoleModel(settings, role),
    supportsVision: true
  };

  if (!settings.useSeparateConfigs) {
    return normalizeConfig(common);
  }

  const roleConfig =
    role === "grading" ? settings.gradingConfig : role === "chat" ? settings.chatConfig : settings.questionConfig;
  const normalized = normalizeConfig(roleConfig);

  if (role === "chat" && !normalized.modelName) {
    const fallback = normalizeConfig(settings.questionConfig || common);
    return fallback.modelName ? fallback : normalizeConfig(common);
  }

  return {
    baseUrl: normalized.baseUrl || common.baseUrl,
    apiKey: normalized.apiKey || common.apiKey,
    modelName: normalized.modelName || common.modelName,
    supportsVision: normalized.supportsVision
  };
}

function ensureConfig(config, role) {
  if (!config.baseUrl) throw new Error("请先在设置页填写 Base URL");
  if (!config.apiKey) throw new Error("请先在设置页填写 API Key");
  if (!config.modelName) {
    const label = role === "grading" ? "判题模型" : role === "chat" ? "对话模型或出题模型" : "出题模型";
    throw new Error(`请先在设置页填写${label}名称`);
  }
}

function friendlyAiError(result, status) {
  const message = result?.message || "AI 请求失败";
  const type = result?.errorType || result?.error_type;
  const map = {
    missing_api_key: "API Key 不能为空",
    invalid_base_url: "Base URL 格式不正确",
    base_url_unavailable: "Base URL 不可用或网络连接失败",
    proxy_network_blocked: "本地代理无法访问外网，请检查网络权限、防火墙或运行环境限制",
    dns_error: "Base URL 域名无法解析，请检查地址或 DNS",
    api_key_error: "API Key 错误或无权限",
    model_or_url_error: "模型名称错误，或 Base URL 路径不兼容",
    response_format_not_supported: "当前接口不支持 response_format=json_object，请换支持 JSON 模式的模型或兼容服务",
    timeout: "网络超时",
    invalid_api_response: "模型服务返回内容不是合法 JSON",
    vision_not_supported: "当前判题模型可能不支持图片/视觉输入"
  };

  const error = new Error(map[type] || message || `AI 请求失败（HTTP ${status}）`);
  error.errorType = type;
  error.detail = message;
  return error;
}

export async function callChatCompletionWithConfig({
  config,
  role = "question",
  messages,
  json = false,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  ensureConfig(config, role);

  const result = await chatCompletions({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.modelName,
    messages,
    temperature,
    timeoutMs,
    responseFormat: json ? { type: "json_object" } : undefined
  });

  if (!result.ok) {
    throw friendlyAiError(result, 0);
  }

  const content = result.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回内容为空，未找到 choices[0].message.content");
  }

  await recordModelUsage({
    role,
    config,
    usage: result.data?.usage,
    messages,
    completion: content,
    stream: false
  });

  return content;
}

export async function callChatCompletion({ role = "question", messages, json = false, temperature = 0.2, timeoutMs }) {
  const settings = await getSettings();
  const config = resolveRoleConfig(settings, role);
  return callChatCompletionWithConfig({
    config,
    role,
    messages,
    json,
    temperature,
    timeoutMs: resolveTimeoutMs(settings, role, timeoutMs)
  });
}

export async function callJsonCompletion(options) {
  const content = await callChatCompletion({ ...options, json: true });
  return parseAiJson(content);
}

export async function callJsonCompletionWithConfig(options) {
  const content = await callChatCompletionWithConfig({ ...options, json: true });
  return parseAiJson(content);
}

export async function callChatCompletionStream({
  role = "chat",
  messages,
  temperature = 0.4,
  timeoutMs,
  onToken
}) {
  const settings = await getSettings();
  const config = resolveRoleConfig(settings, role);
  ensureConfig(config, role);

  const fullText = await chatCompletionsStream({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.modelName,
    messages,
    temperature,
    timeoutMs: resolveTimeoutMs(settings, role, timeoutMs),
    onToken,
    onError: (err) => {
      throw err;
    }
  });

  await recordModelUsage({
    role,
    config,
    messages,
    completion: fullText,
    stream: true
  });

  return fullText;
}

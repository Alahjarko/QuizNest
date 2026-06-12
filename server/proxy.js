import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(globalThis.process?.env?.PORT || 5173);
const BODY_LIMIT = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function normalizeChatCompletionUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") {
    throw Object.assign(new Error("Base URL 不能为空"), { code: "missing_base_url" });
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error("Base URL 格式不正确"), { code: "invalid_base_url" });
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw Object.assign(new Error("Base URL 必须以 http:// 或 https:// 开头"), {
      code: "invalid_base_url"
    });
  }

  if (/\/chat\/completions$/i.test(parsed.pathname)) {
    return trimmed;
  }

  if (/\/v\d+$/i.test(parsed.pathname)) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      throw Object.assign(new Error("请求体过大，请压缩图片后再试"), { code: "body_too_large" });
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("本地代理收到的请求不是合法 JSON"), { code: "invalid_request_json" });
  }
}

function classifyApiError(status, text) {
  const lower = text.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("api key")) return "api_key_error";
  if (status === 404 || lower.includes("model") || lower.includes("not found")) return "model_or_url_error";
  if (status === 400 && (lower.includes("response_format") || lower.includes("unsupported parameter"))) {
    return "response_format_not_supported";
  }
  if (
    status === 400 &&
    (lower.includes("image") ||
      lower.includes("vision") ||
      lower.includes("multimodal") ||
      lower.includes("content type"))
  ) {
    return "vision_not_supported";
  }
  return "api_error";
}

function classifyFetchFailure(error) {
  const causeCode = error?.cause?.code || "";
  const causeMessage = error?.cause?.message || "";
  const detail = [causeCode, causeMessage || error.message].filter(Boolean).join(" ");

  if (causeCode === "EACCES" || /permission|access|denied/i.test(detail)) {
    return {
      errorType: "proxy_network_blocked",
      message: "本地代理无法访问外网，可能被沙盒、系统权限、防火墙或网络策略拦截",
      detail
    };
  }

  if (/ENOTFOUND|EAI_AGAIN/i.test(causeCode)) {
    return {
      errorType: "dns_error",
      message: "Base URL 域名无法解析，请检查地址或 DNS",
      detail
    };
  }

  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(causeCode + " " + detail)) {
    return {
      errorType: "base_url_unavailable",
      message: "Base URL 不可用或网络连接失败",
      detail
    };
  }

  return {
    errorType: "base_url_unavailable",
    message: "Base URL 不可用或网络连接失败",
    detail: detail || error.message
  };
}

async function handleChatCompletions(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, errorType: error.code || "bad_request", message: error.message });
    return;
  }

  const { baseUrl, apiKey, model, messages, temperature, response_format, timeoutMs } = body;

  if (!apiKey || typeof apiKey !== "string") {
    sendJson(res, 400, { ok: false, errorType: "missing_api_key", message: "API Key 不能为空" });
    return;
  }

  if (!model || typeof model !== "string") {
    sendJson(res, 400, { ok: false, errorType: "missing_model", message: "模型名称不能为空" });
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { ok: false, errorType: "missing_messages", message: "消息不能为空" });
    return;
  }

  let url;
  try {
    url = normalizeChatCompletionUrl(baseUrl);
  } catch (error) {
    sendJson(res, 400, { ok: false, errorType: error.code || "invalid_base_url", message: error.message });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || DEFAULT_TIMEOUT_MS));

  try {
    const payload = {
      model,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.2
    };
    if (response_format) payload.response_format = response_format;

    const apiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await apiResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      sendJson(res, 502, {
        ok: false,
        errorType: "invalid_api_response",
        message: "模型服务返回内容不是合法 JSON",
        raw: text.slice(0, 800)
      });
      return;
    }

    if (!apiResponse.ok) {
      sendJson(res, apiResponse.status, {
        ok: false,
        errorType: classifyApiError(apiResponse.status, text),
        message: data?.error?.message || data?.message || `模型服务返回 HTTP ${apiResponse.status}`,
        data
      });
      return;
    }

    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (error.name === "AbortError") {
      sendJson(res, 504, { ok: false, errorType: "timeout", message: "网络超时，请稍后重试或调大超时时间" });
      return;
    }

    sendJson(res, 502, { ok: false, ...classifyFetchFailure(error) });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChatCompletionsStream(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, errorType: error.code || "bad_request", message: error.message });
    return;
  }

  const { baseUrl, apiKey, model, messages, temperature, timeoutMs } = body;

  if (!apiKey || typeof apiKey !== "string") {
    sendJson(res, 400, { ok: false, errorType: "missing_api_key", message: "API Key 不能为空" });
    return;
  }

  if (!model || typeof model !== "string") {
    sendJson(res, 400, { ok: false, errorType: "missing_model", message: "模型名称不能为空" });
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { ok: false, errorType: "missing_messages", message: "消息不能为空" });
    return;
  }

  let url;
  try {
    url = normalizeChatCompletionUrl(baseUrl);
  } catch (error) {
    sendJson(res, 400, { ok: false, errorType: error.code || "invalid_base_url", message: error.message });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || DEFAULT_TIMEOUT_MS));

  try {
    const apiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof temperature === "number" ? temperature : 0.4,
        stream: true
      }),
      signal: controller.signal
    });

    if (!apiResponse.ok) {
      const text = await apiResponse.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 800) };
      }
      sendJson(res, apiResponse.status, {
        ok: false,
        errorType: classifyApiError(apiResponse.status, text),
        message: data?.error?.message || data?.message || `模型服务返回 HTTP ${apiResponse.status}`,
        data
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const reader = apiResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    if (error.name === "AbortError") {
      sendJson(res, 504, { ok: false, errorType: "timeout", message: "网络超时，请稍后重试或调大超时时间" });
      return;
    }

    sendJson(res, 502, { ok: false, ...classifyFetchFailure(error) });
  } finally {
    clearTimeout(timeout);
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:" + PORT,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/chat-completions-stream")) {
    await handleChatCompletionsStream(req, res);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/chat-completions")) {
    await handleChatCompletions(req, res);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { ok: false, errorType: "method_not_allowed", message: "不支持的请求方法" });
});

server.listen(PORT, () => {
  console.log(`QuizNest 已启动：http://localhost:${PORT}`);
});

/**
 * Tauri Bridge - 前端与 Rust 后端的桥接层
 * 
 * 在 Tauri 桌面环境中通过 window.__TAURI__ 调用 Rust 命令；
 * 在浏览器 dev 模式中回退到 HTTP fetch。
 */

let isTauri = false;

// 检测 Tauri 环境 (withGlobalTauri: true 时可用)
if (typeof window !== "undefined" && window.__TAURI__) {
    isTauri = true;
}

function tauriInvoke(cmd, args) {
    return window.__TAURI__.core.invoke(cmd, args);
}

function tauriListen(event, handler) {
    return window.__TAURI__.event.listen(event, handler);
}

/**
 * 非流式调用 chat completions
 */
export async function chatCompletions({ baseUrl, apiKey, model, messages, temperature, timeoutMs, enableThinking, responseFormat }) {
    if (isTauri) {
        const result = await tauriInvoke("chat_completions", {
            request: {
                base_url: baseUrl,
                api_key: apiKey,
                model: model,
                messages: messages,
                temperature: temperature ?? 0.2,
                timeout_ms: timeoutMs,
                enable_thinking: enableThinking !== false,
                response_format: responseFormat
            }
        });
        return result;
    }

    // Fallback: HTTP fetch to Node.js proxy
    const response = await fetch("/api/chat-completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            baseUrl,
            apiKey,
            model,
            messages,
            temperature,
            timeoutMs,
            enableThinking: enableThinking !== false,
            response_format: responseFormat
        })
    });

    return await response.json();
}

/**
 * 流式调用 chat completions
 */
export async function chatCompletionsStream({ baseUrl, apiKey, model, messages, temperature, timeoutMs, enableThinking, onToken, onError, onDone, signal }) {
    if (isTauri) {
        let fullText = "";
        let unlistenToken = null;
        let unlistenError = null;
        let unlistenDone = null;
        let resolved = false;

        const cleanup = () => {
            if (unlistenToken) unlistenToken();
            if (unlistenError) unlistenError();
            if (unlistenDone) unlistenDone();
        };

        try {
            const [u1, u2, u3] = await Promise.all([
                tauriListen("stream-token", (event) => {
                    if (resolved) return;
                    const token = event.payload?.token;
                    const currentFull = event.payload?.full_text;
                    if (token !== undefined && token !== null) {
                        fullText = currentFull || (fullText + (token || ""));
                        onToken?.(token, fullText);
                    }
                }),
                tauriListen("stream-error", (event) => {
                    if (resolved) return;
                    resolved = true;
                    cleanup();
                    const err = new Error(event.payload?.message || "流式请求失败");
                    err.errorType = event.payload?.error_type;
                    err.detail = event.payload?.message;
                    onError?.(err);
                }),
                tauriListen("stream-done", (event) => {
                    if (resolved) return;
                    resolved = true;
                    cleanup();
                    fullText = event.payload?.full_text || fullText;
                    onDone?.(fullText);
                })
            ]);
            unlistenToken = u1;
            unlistenError = u2;
            unlistenDone = u3;

            await tauriInvoke("chat_completions_stream", {
                request: {
                    base_url: baseUrl,
                    api_key: apiKey,
                    model: model,
                    messages: messages,
                    temperature: temperature ?? 0.4,
                    enable_thinking: enableThinking !== false,
                    timeout_ms: timeoutMs
                }
            });

            if (!resolved) {
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (err) {
            if (!resolved) {
                resolved = true;
                cleanup();
                onError?.(err);
            }
        } finally {
            cleanup();
        }

        return fullText;
    }

    // Fallback: HTTP SSE fetch to Node.js proxy
    const response = await fetch("/api/chat-completions-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            baseUrl,
            apiKey,
            model,
            messages,
            temperature,
            timeoutMs,
            enableThinking: enableThinking !== false
        }),
        signal
    });

    if (!response.ok) {
        let result;
        try {
            result = await response.json();
        } catch {
            result = { message: "流式请求失败" };
        }
        throw result;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            try {
                const data = JSON.parse(payload);
                const token = data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || "";
                if (token) {
                    fullText += token;
                    onToken?.(token, fullText);
                }
            } catch {
                // Ignore malformed keep-alive chunks
            }
        }
    }

    onDone?.(fullText);
    return fullText;
}

/**
 * 检查是否在 Tauri 环境中运行
 */
export function runningInTauri() {
    return isTauri;
}

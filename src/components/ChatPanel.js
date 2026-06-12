import { openModal } from "./Modal.js";
import { callChatCompletionStream } from "../services/ai/aiClient.js";
import { getAll, getByIndex, put, remove } from "../services/storage/db.js";
import { buildChatMessages } from "../prompts/chat.js";
import { createId, formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml, renderMarkdown } from "../utils/markdown.js";
import { typesetMath } from "../utils/math.js";

let isSending = false;
let manualContext = null;

export function setManualChatContext(context) {
  manualContext = context || null;
}

export function clearManualChatContext() {
  manualContext = null;
}

export async function renderChatPanel(root, app) {
  if (!root) return;
  await renderChatSurface(root, app, "panel");
}

export async function renderChatWorkspace(root, app) {
  if (!root) return;
  await renderChatSurface(root, app, "workspace");
}

async function renderChatSurface(root, app, mode) {
  const context = manualContext || app.getContext();
  const noteId = context?.note?.id || context?.questionSet?.noteId || "global";
  const contextKey = context?.contextKey || "general";
  let messages = (await getByIndex("chatMessages", "noteId", noteId))
    .filter((message) => message.contextKey === contextKey)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const draftMessage = root.dataset.chatDraft || "";
  delete root.dataset.chatDraft;

  const chatInner = `
      <div class="chat-header">
        <div>
          <strong>QuizNest 解惑</strong>
          <span>结合当前笔记、题目和错题记录回答。</span>
        </div>
        ${mode === "panel" ? `<button class="icon-button" data-chat-close type="button" aria-label="关闭">×</button>` : ""}
      </div>
      <div class="chat-context-bar">
        <div class="context-tags">
          ${renderContextTags(context)}
        </div>
      </div>
      <div class="chat-messages" data-chat-messages>
        ${
          messages.length
            ? messages.map((message) => renderMessage(message)).join("")
            : `<div class="empty-state">可以问：“我哪里理解错了？”“用更简单的话解释一下。”或“根据这部分再出一道类似题。”</div>`
        }
      </div>
      <form class="chat-input" data-chat-form>
        <textarea name="message" rows="3" placeholder="输入你的问题..." ${isSending ? "disabled" : ""}>${escapeHtml(draftMessage)}</textarea>
        <div class="chat-input-toolbar">
          <div class="chat-input-tools">
            <button class="chat-tool-button" data-pick-context type="button" title="选择笔记、题组或题目作为上下文" ${isSending ? "disabled" : ""}>
              ${chatIcon("book-open")}
              <span>学习与解惑</span>
            </button>
            <button class="chat-tool-button" data-clear-context type="button" title="清空手动选择的学习上下文" ${manualContext && !isSending ? "" : "disabled"}>
              ${chatIcon("eraser")}
              <span>清空上下文</span>
            </button>
          </div>
          <button class="chat-send-button" type="submit" aria-label="${isSending ? "回答中" : "发送"}" title="${isSending ? "回答中" : "发送"}" ${isSending ? "disabled" : ""}>
            ${chatIcon("arrow-up")}
          </button>
        </div>
      </form>
  `;

  root.innerHTML =
    mode === "workspace"
      ? `
        <section class="page-header hero-panel">
          <div>
            <p class="eyebrow">学习与解惑</p>
            <h1>解惑</h1>
            <p>选择笔记、题组或题目作为上下文，让模型围绕你的学习材料解释概念、追问错因或补一道类似题。</p>
          </div>
        </section>
        <section class="chat-workspace" aria-label="解惑工作台">
          ${chatInner}
        </section>`
      : `
    <aside class="chat-panel ${app.isChatOpen() ? "open" : ""}" aria-label="解惑窗口">
      ${chatInner}
    </aside>
    <div class="chat-mask ${app.isChatOpen() ? "open" : ""}" data-chat-close></div>
  `;

  root.querySelectorAll("[data-chat-close]").forEach((button) => {
    button.addEventListener("click", () => app.setChatOpen(false));
  });

  root.querySelector("[data-pick-context]")?.addEventListener("click", async () => {
    await openContextPicker(app, mode);
  });

  root.querySelector("[data-clear-context]")?.addEventListener("click", () => {
    manualContext = null;
    if (mode === "workspace") app.refresh();
    else app.refreshChat();
  });

  const messagesEl = root.querySelector("[data-chat-messages]");
  scrollMessagesToBottom(messagesEl);

  if (root.chatActionHandler) {
    root.removeEventListener("click", root.chatActionHandler);
  }
  root.chatActionHandler = async (event) => {
    const actionButton = event.target.closest("[data-chat-action]");
    if (!actionButton || !root.contains(actionButton)) return;
    const messageId = actionButton.dataset.chatMessage;
    const action = actionButton.dataset.chatAction;
    const message = messages.find((item) => item.id === messageId);
    if (!message || isSending) return;

    if (action === "delete") {
      await remove("chatMessages", message.id);
      app.showToast?.("消息已删除", "success");
      root.dataset.chatDraft = root.querySelector("textarea")?.value || "";
      await renderChatSurface(root, app, mode);
      return;
    }

    if (action === "edit" && message.role === "user") {
      const index = messages.findIndex((item) => item.id === message.id);
      const idsToRemove = [message.id];
      if (messages[index + 1]?.role === "assistant") idsToRemove.push(messages[index + 1].id);
      await Promise.all(idsToRemove.map((id) => remove("chatMessages", id)));
      root.dataset.chatDraft = message.content;
      await renderChatSurface(root, app, mode);
      root.querySelector("textarea")?.focus();
      app.showToast?.("已放回输入框，可修改后重新发送", "success");
      return;
    }

    if (action === "retry" && message.role === "assistant") {
      const assistantIndex = messages.findIndex((item) => item.id === message.id);
      const userIndex = findPreviousUserIndex(messages, assistantIndex);
      if (userIndex < 0) {
        app.showToast?.("没有找到可重试的上一条提问", "error");
        return;
      }
      await remove("chatMessages", message.id);
      root.querySelector(`[data-chat-message-id="${cssEscape(message.id)}"]`)?.remove();
      const previousUser = messages[userIndex];
      const history = messages.slice(0, userIndex);
      const nextAssistant = await sendAssistantMessage({
        app,
        context,
        history,
        userMessage: previousUser.content,
        noteId,
        contextKey,
        messagesEl,
        form: root.querySelector("[data-chat-form]")
      });
      messages = messages.filter((item) => item.id !== message.id);
      if (nextAssistant) messages.push(nextAssistant);
    }
  };
  root.addEventListener("click", root.chatActionHandler);

  const form = root.querySelector("[data-chat-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSending) return;

    const textarea = form.elements.message;
    const userMessage = textarea.value.trim();
    if (!userMessage) return;

    textarea.value = "";

    const userRecord = {
      id: createId("chat"),
      noteId,
      contextKey,
      role: "user",
      content: userMessage,
      createdAt: nowIso()
    };

    await put("chatMessages", userRecord);
    appendStreamingShell(messagesEl, userRecord);
    const nextAssistant = await sendAssistantMessage({
      app,
      context,
      history: messages,
      userMessage,
      noteId,
      contextKey,
      messagesEl,
      form
    });
    messages.push(userRecord);
    if (nextAssistant) messages.push(nextAssistant);
  });
}

function renderContextTags(context) {
  const tags = [];
  if (context?.note?.title) tags.push(`当前笔记：${context.note.title}`);
  if (context?.questionSet?.title) tags.push(`当前题组：${context.questionSet.title}`);
  if (context?.question?.order) tags.push(`当前题目：第 ${context.question.order} 题`);
  if (!tags.length) tags.push("当前上下文：全局");
  return tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
}

function renderMessage(message) {
  const contentHtml =
    message.role === "assistant"
      ? renderMarkdown(message.content)
      : escapeHtml(message.content).replace(/\r?\n/g, "<br>");
  const actionButtons =
    message.role === "user"
      ? `
        <button class="chat-message-action" data-chat-action="edit" data-chat-message="${escapeHtml(message.id)}" type="button" title="编辑并重新发送" aria-label="编辑并重新发送">${chatIcon("pencil")}</button>
        <button class="chat-message-action" data-chat-action="delete" data-chat-message="${escapeHtml(message.id)}" type="button" title="删除消息" aria-label="删除消息">${chatIcon("trash")}</button>`
      : `
        <button class="chat-message-action" data-chat-action="retry" data-chat-message="${escapeHtml(message.id)}" type="button" title="重新生成" aria-label="重新生成">${chatIcon("refresh")}</button>
        <button class="chat-message-action" data-chat-action="delete" data-chat-message="${escapeHtml(message.id)}" type="button" title="删除消息" aria-label="删除消息">${chatIcon("trash")}</button>`;

  return `
    <article class="chat-message ${message.role === "user" ? "user" : "assistant"}" data-chat-message-id="${escapeHtml(message.id)}">
      <div class="chat-message-content">${contentHtml}</div>
      <div class="chat-message-meta">
        <small>${formatDateTime(message.createdAt)}</small>
        <div class="chat-message-actions">${actionButtons}</div>
      </div>
    </article>`;
}

function appendStreamingShell(messagesEl, message) {
  messagesEl.querySelector(".empty-state")?.remove();
  messagesEl.insertAdjacentHTML("beforeend", renderMessage(message));
  scrollMessagesToBottom(messagesEl);
}

function appendAssistantShell(messagesEl) {
  messagesEl.querySelector(".empty-state")?.remove();
  const article = document.createElement("article");
  article.className = "chat-message assistant";
  article.dataset.chatStreaming = "true";
  const content = document.createElement("div");
  content.className = "chat-message-content";
  content.textContent = "正在思考...";
  const metaRow = document.createElement("div");
  metaRow.className = "chat-message-meta";
  const time = document.createElement("small");
  time.textContent = "实时输出";
  const actions = document.createElement("div");
  actions.className = "chat-message-actions";
  metaRow.append(time, actions);
  article.append(content, metaRow);
  messagesEl.appendChild(article);
  scrollMessagesToBottom(messagesEl);
  return content;
}

async function sendAssistantMessage({ app, context, history, userMessage, noteId, contextKey, messagesEl, form }) {
  isSending = true;
  setChatFormSending(form, true);
  const assistantContentEl = appendAssistantShell(messagesEl);
  const assistantArticle = assistantContentEl.closest(".chat-message");

  let finalContent = "";
  try {
    finalContent = await callChatCompletionStream({
      role: "chat",
      messages: buildChatMessages({
        context,
        history,
        userMessage
      }),
      temperature: 0.45,
      timeoutMs: 180000,
      onToken: (_token, fullText) => {
        renderAssistantContent(assistantContentEl, fullText, { deferMath: true });
        scrollMessagesToBottom(messagesEl);
      }
    });

    if (!finalContent) finalContent = "模型没有返回内容，请换个问法再试。";
  } catch (error) {
    finalContent = `请求失败：${error.message}`;
  }

  renderAssistantContent(assistantContentEl, finalContent);
  scrollMessagesToBottom(messagesEl);

  try {
    const assistantRecord = {
      id: createId("chat"),
      noteId,
      contextKey,
      role: "assistant",
      content: finalContent,
      createdAt: nowIso()
    };
    await put("chatMessages", assistantRecord);
    if (assistantArticle) {
      assistantArticle.dataset.chatMessageId = assistantRecord.id;
      delete assistantArticle.dataset.chatStreaming;
      const meta = assistantArticle.querySelector("small");
      if (meta) meta.textContent = formatDateTime(assistantRecord.createdAt);
      const actions = assistantArticle.querySelector(".chat-message-actions");
      if (actions) {
        actions.innerHTML = `
          <button class="chat-message-action" data-chat-action="retry" data-chat-message="${escapeHtml(assistantRecord.id)}" type="button" title="重新生成" aria-label="重新生成">${chatIcon("refresh")}</button>
          <button class="chat-message-action" data-chat-action="delete" data-chat-message="${escapeHtml(assistantRecord.id)}" type="button" title="删除消息" aria-label="删除消息">${chatIcon("trash")}</button>`;
      }
    }
    return assistantRecord;
  } finally {
    isSending = false;
    setChatFormSending(form, false);
  }
}

function findPreviousUserIndex(messages, startIndex) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function scrollMessagesToBottom(messagesEl) {
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setChatFormSending(form, sending) {
  if (!form) return;
  form.querySelector("textarea")?.toggleAttribute("disabled", sending);
  form.querySelectorAll("[data-pick-context], [data-clear-context], .chat-send-button").forEach((button) => {
    if (button.matches("[data-clear-context]")) {
      button.disabled = sending || !manualContext;
      return;
    }
    button.disabled = sending;
  });
  const sendButton = form.querySelector(".chat-send-button");
  if (sendButton) {
    sendButton.setAttribute("aria-label", sending ? "回答中" : "发送");
    sendButton.setAttribute("title", sending ? "回答中" : "发送");
  }
}

function renderAssistantContent(element, content, options = {}) {
  element.innerHTML = renderMarkdown(content || "");
  if (options.deferMath) {
    window.clearTimeout(element.mathTimer);
    element.mathTimer = window.setTimeout(() => typesetMath(element), 220);
    return;
  }
  typesetMath(element);
}

async function openContextPicker(app, mode = "panel") {
  const [notes, sets, questions, answers, wrongItems] = await Promise.all([
    getAll("notes"),
    getAll("questionSets"),
    getAll("questions"),
    getAll("answers"),
    getAll("wrongItems")
  ]);

  const content = document.createElement("div");
  content.className = "context-picker";
  content.innerHTML = `
    <label>
      <span>选择笔记</span>
      <select data-context-note>
        <option value="">请选择笔记</option>
        ${notes.map((note) => `<option value="${note.id}">${escapeHtml(note.title)}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>选择题组（可选）</span>
      <select data-context-set disabled>
        <option value="">先选择笔记</option>
      </select>
    </label>
    <label>
      <span>选择题目（可选）</span>
      <select data-context-question disabled>
        <option value="">可直接针对笔记或题组提问</option>
      </select>
    </label>
    <div class="status-box">可以只选择笔记，也可以继续定位到某套题或某道题；模型会优先围绕所选上下文回答。</div>
    <div class="form-actions">
      <button class="primary-button" data-apply-context type="button">使用当前选择</button>
    </div>
  `;

  const modal = openModal({ title: "学习与解惑", content, width: "560px" });
  const noteSelect = modal.body.querySelector("[data-context-note]");
  const setSelect = modal.body.querySelector("[data-context-set]");
  const questionSelect = modal.body.querySelector("[data-context-question]");

  noteSelect.addEventListener("change", () => {
    const noteSets = sets.filter((set) => set.noteId === noteSelect.value);
    setSelect.disabled = !noteSelect.value;
    setSelect.innerHTML =
      `<option value="">只针对整份笔记</option>` +
      noteSets.map((set) => `<option value="${set.id}">${escapeHtml(set.title || "未命名题组")}</option>`).join("");
    questionSelect.disabled = true;
    questionSelect.innerHTML = `<option value="">可直接针对笔记或题组提问</option>`;
  });

  setSelect.addEventListener("change", () => {
    const setQuestions = questions.filter((question) => question.setId === setSelect.value).sort((a, b) => a.order - b.order);
    questionSelect.disabled = !setSelect.value;
    questionSelect.innerHTML =
      `<option value="">只针对这套题组</option>` +
      setQuestions
        .map((question) => `<option value="${question.id}">第 ${question.order} 题 · ${escapeHtml(question.question.slice(0, 28))}</option>`)
        .join("");
  });

  modal.body.querySelector("[data-apply-context]").addEventListener("click", () => {
    const note = notes.find((item) => item.id === noteSelect.value);
    if (!note) return;
    const set = sets.find((item) => item.id === setSelect.value);
    const question = questions.find((item) => item.id === questionSelect.value);
    const answer = question ? answers.find((item) => item.questionId === question.id) : null;
    const wrongItem = question ? wrongItems.find((item) => item.questionId === question.id) : null;

    manualContext = buildManualContext({ note, set, question, answer, wrongItem });
    modal.close();
    if (mode === "workspace") {
      app.refresh();
    } else {
      app.setChatOpen(true);
      app.refreshChat();
    }
  });
}

function buildManualContext({ note, set, question, answer, wrongItem }) {
  return {
    contextKey: `manual:${note.id}:${set?.id || "note"}:${question?.id || "all"}`,
    note,
    questionSet: set
      ? {
          id: set.id,
          noteId: set.noteId,
          title: set.title,
          difficulty: set.difficulty,
          choiceCount: set.choiceCount,
          subjectiveCount: set.subjectiveCount
        }
      : undefined,
    question: question
      ? {
          id: question.id,
          order: question.order,
          type: question.type,
          question: question.question,
          options: question.options,
          relatedNoteSection: question.relatedNoteSection,
          questionType: question.questionType
        }
      : undefined,
    answer: summarizeAnswerContext(answer),
    correctAnswer: question?.correctAnswer || question?.referenceAnswer,
    aiExplanation: answer?.aiTeaching || question?.explanation,
    wrongItem
  };
}

function summarizeAnswerContext(answer) {
  if (!answer) return "";
  return {
    selectedOption: answer.selectedOption,
    textAnswer: answer.textAnswer,
    imageName: answer.imageName,
    hasImageAnswer: Boolean(answer.imageDataUrl || answer.imageName),
    submitted: answer.submitted,
    isCorrect: answer.isCorrect,
    score: answer.score,
    gradeResult: answer.gradeResult,
    aiTeaching: answer.aiTeaching
  };
}

function chatIcon(name) {
  const paths = {
    "book-open": `<path d="M2 4.5A3 3 0 0 1 5 3h6v18H5a3 3 0 0 0-3 1.5Z"/><path d="M22 4.5A3 3 0 0 0 19 3h-6v18h6a3 3 0 0 1 3 1.5Z"/>`,
    eraser: `<path d="m7 21-4-4L14.5 5.5a3.2 3.2 0 0 1 4.5 4.5L8 21Z"/><path d="m12 10 5 5"/><path d="M8 21h13"/>`,
    "arrow-up": `<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>`,
    pencil: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
    trash: `<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>`,
    refresh: `<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/>`
  };

  return `<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

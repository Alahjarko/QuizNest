import { openModal } from "./Modal.js";
import { callChatCompletionStream } from "../services/ai/aiClient.js";
import { getAll, getByIndex, put, remove } from "../services/storage/db.js";
import { getActiveLearningMemories } from "../services/learningMemory.js";
import { buildChatMessages } from "../prompts/chat.js";
import { createId, formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml, renderMarkdown } from "../utils/markdown.js";
import { typesetMath } from "../utils/math.js";

let isSending = false;
let manualContext = null;
let pendingChatPrompt = "";

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
  root.classList.toggle("chat-page", mode === "workspace");
  const context = manualContext || app.getContext();
  const noteId = context?.note?.id || context?.questionSet?.noteId || "global";
  const contextKey = context?.contextKey || "general";
  const [storedMessages, learningMemories] = await Promise.all([
    getByIndex("chatMessages", "noteId", noteId),
    getActiveLearningMemories()
  ]);
  let messages = storedMessages
    .filter((message) => message.contextKey === contextKey)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const draftMessage = root.dataset.chatDraft || "";
  delete root.dataset.chatDraft;

  const chatInner = `
      ${
        mode === "panel"
          ? `<div class="chat-header"><div><strong>QuizNest 解惑</strong><span>结合当前学习上下文回答。</span></div><button class="icon-button" data-chat-close type="button" aria-label="关闭">×</button></div>`
          : ""
      }
      ${renderLearningControls(context)}
      <div class="solver-body">
        <div class="solver-conversation">
          <div class="chat-messages" data-chat-messages>
            ${
              messages.length
                ? messages.map((message) => renderMessage(message)).join("")
                : renderChatEmptyState(context)
            }
          </div>
        </div>
        ${mode === "workspace" ? renderContextInspector(context, messages) : ""}
      </div>
      <form class="chat-input" data-chat-form>
        <div class="chat-input-context">
          ${renderContextTags(context)}
        </div>
        <textarea name="message" rows="1" placeholder="写下问题、推导过程或你没有理解的地方..." ${isSending ? "disabled" : ""}>${escapeHtml(draftMessage)}</textarea>
        <div class="chat-input-toolbar">
          <div class="chat-input-tools">
            <button class="chat-tool-button" data-pick-context type="button" ${isSending ? "disabled" : ""} title="选择关联的学习材料">
              ${chatIcon("book-open")}
              <span>选择内容</span>
            </button>
            <button class="chat-tool-button" data-start-learning type="button" title="选择笔记并按章节学习新知识" ${isSending ? "disabled" : ""}>
              ${chatIcon("lightbulb")}
              <span>学习新知识</span>
            </button>
            ${manualContext ? `<button class="chat-tool-button danger" data-clear-context type="button" ${isSending ? "disabled" : ""} title="清空当前选择的内容"><span>清空</span></button>` : ""}
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

  root.querySelector("[data-start-learning]")?.addEventListener("click", async () => {
    await openLearningPicker(app, mode);
  });

  root.querySelector("[data-clear-context]")?.addEventListener("click", () => {
    manualContext = null;
    if (mode === "workspace") app.refresh();
    else app.refreshChat();
  });

  root.querySelectorAll("[data-learning-step]").forEach((button) => {
    button.addEventListener("click", async () => {
      await moveLearningSection(context, Number(button.dataset.learningStep), app, mode);
    });
  });

  root.querySelector("[data-end-learning]")?.addEventListener("click", () => {
    manualContext = null;
    pendingChatPrompt = "";
    if (mode === "workspace") app.refresh();
    else app.refreshChat();
  });

  const messagesEl = root.querySelector("[data-chat-messages]");
  scrollMessagesToBottom(messagesEl);

  if (root.chatActionHandler) {
    root.removeEventListener("click", root.chatActionHandler);
  }
  root.chatActionHandler = async (event) => {
    const quickPromptButton = event.target.closest("[data-quick-prompt]");
    if (quickPromptButton && root.contains(quickPromptButton) && !isSending) {
      const textarea = root.querySelector("[data-chat-form] textarea");
      if (textarea) {
        textarea.value = quickPromptButton.dataset.quickPrompt || "";
        textarea.focus();
      }
      return;
    }

    const removeContextButton = event.target.closest("[data-remove-context]");
    if (removeContextButton && root.contains(removeContextButton) && !isSending) {
      removeManualContextPart(removeContextButton.dataset.removeContext);
      if (mode === "workspace") app.refresh();
      else app.refreshChat();
      return;
    }

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
        learningMemories,
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
      learningMemories,
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

  if (pendingChatPrompt && messages.length === 0 && !isSending) {
    const autoPrompt = pendingChatPrompt;
    pendingChatPrompt = "";
    window.setTimeout(() => {
      const textarea = form?.elements?.message;
      if (!textarea || !root.isConnected) return;
      textarea.value = autoPrompt;
      form.requestSubmit();
    }, 80);
  }
}

function removeManualContextPart(key) {
  if (!manualContext) return;
  if (key === "note") {
    manualContext = null;
    return;
  }

  const next = { ...manualContext };
  if (key === "question") {
    delete next.question;
    delete next.answer;
    delete next.correctAnswer;
    delete next.aiExplanation;
    delete next.wrongItem;
  } else if (key === "set") {
    delete next.questionSet;
    delete next.questionSetProgress;
    delete next.questionSetAnswers;
    delete next.question;
    delete next.answer;
    delete next.correctAnswer;
    delete next.aiExplanation;
    delete next.wrongItem;
  } else if (key === "wrong") {
    delete next.wrongItem;
  }

  next.contextKey = `manual:${next.note?.id || "global"}:${next.questionSet?.id || "note"}:${next.question?.id || "all"}`;
  manualContext = next;
}

function renderContextTags(context) {
  const tags = [];
  if (context?.learningMode) {
    tags.push({ key: "learning", label: `学习进度 ${context.learningMode.sectionIndex + 1}/${context.learningMode.totalSections}` });
  }
  if (context?.note?.title) tags.push({ key: "note", label: `笔记 ${context.note.title}` });
  if (context?.questionSet?.title) tags.push({ key: "set", label: `题组 ${context.questionSet.title}` });
  if (context?.question?.order) tags.push({ key: "question", label: `第 ${context.question.order} 题` });
  if (context?.wrongItem) tags.push({ key: "wrong", label: "错题记录" });
  if (context?.learningMode?.sectionTitle) tags.push({ key: "section", label: `章节 ${context.learningMode.sectionTitle}` });
  if (!tags.length) tags.push({ key: "global", label: "全局学习档案" });
  return tags
    .map(
      (tag) => `
        <span class="context-chip ${tag.key}">
          ${escapeHtml(tag.label)}
          ${manualContext && ["note", "set", "question", "wrong"].includes(tag.key) ? `<button data-remove-context="${tag.key}" type="button" aria-label="移除${escapeHtml(tag.label)}">×</button>` : ""}
        </span>`
    )
    .join("");
}

function renderChatEmptyState(context) {
  const scoped = Boolean(context?.note || context?.questionSet || context?.question || context?.wrongItem);
  return `
    <div class="solver-empty-state">
      <p class="page-kicker">Start From The Problem</p>
      <h2>${scoped ? "从当前材料开始拆解" : "选择学习上下文"}</h2>
      <p>${scoped ? "描述你卡住的步骤，或让解惑检查你的理解。" : "选择一份笔记、题组或错题，回答会更准确地围绕你的学习材料展开。"}</p>
    </div>`;
}

function renderContextInspector(context, messages) {
  const entries = [
    context?.note?.title ? ["笔记", context.note.title] : null,
    context?.learningMode?.sectionTitle || context?.section?.title ? ["知识点", context.learningMode?.sectionTitle || context.section?.title] : null,
    context?.questionSet?.title ? ["题组", context.questionSet.title] : null,
    context?.question?.order ? ["当前题目", `第 ${context.question.order} 题`] : null,
    context?.wrongItem?.errorReason ? ["最近错因", context.wrongItem.errorReason] : null
  ].filter(Boolean);
  return `
    <aside class="solver-inspector" aria-label="上下文详情">
      <div class="solver-inspector-header">
        <p class="page-kicker">Context</p>
        <h2>解题上下文</h2>
      </div>
      <div class="solver-inspector-list">
        ${
          entries.length
            ? entries.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(compactChatText(value, 96))}</strong></div>`).join("")
            : `<p>尚未选择材料。当前回答只参考你的长期记忆和本轮对话。</p>`
        }
      </div>
      <div class="solver-session-count"><span>本轮消息</span><strong>${messages.length}</strong></div>
    </aside>`;
}

function renderLearningControls(context) {
  const learning = context?.learningMode;
  if (!learning) return "";
  return `
    <div class="learning-mode-controls">
      <button class="secondary-button" data-learning-step="-1" type="button" ${learning.sectionIndex <= 0 ? "disabled" : ""}>
        ${chatIcon("chevron-left")}上一章节
      </button>
      <button class="secondary-button" data-learning-step="1" type="button" ${learning.sectionIndex >= learning.totalSections - 1 ? "disabled" : ""}>
        下一章节${chatIcon("chevron-right")}
      </button>
      <button class="secondary-button" data-end-learning type="button">结束学习</button>
    </div>`;
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
      ${message.role === "assistant" ? renderAssistantQuickPrompts() : ""}
      <div class="chat-message-meta">
        <small>${formatDateTime(message.createdAt)}</small>
        <div class="chat-message-actions">${actionButtons}</div>
      </div>
    </article>`;
}

function renderAssistantQuickPrompts() {
  return `
    <div class="assistant-quick-prompts" aria-label="快捷追问">
      <button data-quick-prompt="继续沿着刚才的思路讲解下一步。" type="button">继续追问</button>
      <button data-quick-prompt="请用更简单、更直观的话重新解释。" type="button">更简单解释</button>
      <button data-quick-prompt="请根据这个知识点生成一道难度相近的题目，先不要给答案。" type="button">生成类似题</button>
      <button data-quick-prompt="请通过一个简短问题检查我是否真正理解了。" type="button">检查理解</button>
      <button data-quick-prompt="请把刚才的解释整理成可以加入笔记的 Markdown 摘要。" type="button">总结成笔记</button>
    </div>`;
}

function compactChatText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
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

async function sendAssistantMessage({ app, context, learningMemories, history, userMessage, noteId, contextKey, messagesEl, form }) {
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
        memories: learningMemories,
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
      if (!assistantArticle.querySelector(".assistant-quick-prompts")) {
        assistantArticle.querySelector(".chat-message-meta")?.insertAdjacentHTML("beforebegin", renderAssistantQuickPrompts());
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
  const surface = form.closest(".chat-workspace, .chat-panel") || form;
  form.querySelector("textarea")?.toggleAttribute("disabled", sending);
  surface.querySelectorAll("[data-pick-context], [data-start-learning], [data-clear-context], .chat-send-button").forEach((button) => {
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

async function openLearningPicker(app, mode = "workspace") {
  const [notes, progressRows] = await Promise.all([getAll("notes"), getAll("learningProgress")]);
  const availableNotes = notes.filter((note) => getLearningSections(note).length > 0);
  const progressMap = new Map(progressRows.map((item) => [item.noteId, item]));
  const content = document.createElement("div");
  content.className = "learning-picker";
  content.innerHTML = `
    <label>
      <span>选择笔记</span>
      <select data-learning-note>
        <option value="">请选择笔记</option>
        ${availableNotes.map((note) => `<option value="${escapeHtml(note.id)}">${escapeHtml(note.title)}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>开始章节</span>
      <select data-learning-section disabled>
        <option value="0">先选择笔记</option>
      </select>
    </label>
    <div class="status-box" data-learning-picker-status>AI 会围绕当前章节讲解、提问并检查理解；完成后可在解惑页进入下一章节。</div>
    <div class="form-actions">
      <button class="primary-button" data-begin-learning type="button" disabled>开始学习</button>
    </div>`;

  const modal = openModal({ title: "学习新知识", content, width: "580px" });
  const noteSelect = modal.body.querySelector("[data-learning-note]");
  const sectionSelect = modal.body.querySelector("[data-learning-section]");
  const status = modal.body.querySelector("[data-learning-picker-status]");
  const beginButton = modal.body.querySelector("[data-begin-learning]");

  noteSelect.addEventListener("change", () => {
    const note = availableNotes.find((item) => item.id === noteSelect.value);
    const sections = getLearningSections(note);
    const saved = progressMap.get(note?.id);
    sectionSelect.disabled = !note;
    beginButton.disabled = !note;
    sectionSelect.innerHTML = sections
      .map((section, index) => `<option value="${index}" ${Number(saved?.sectionIndex || 0) === index ? "selected" : ""}>${index + 1}. ${escapeHtml(section.title)}</option>`)
      .join("");
    status.textContent = note
      ? saved
        ? `共 ${sections.length} 个章节，将从上次学习到的“${saved.sectionTitle || sections[Number(saved.sectionIndex || 0)]?.title}”继续。`
        : `共 ${sections.length} 个章节，将从所选章节开始。`
      : "AI 会围绕当前章节讲解、提问并检查理解；完成后可进入下一章节。";
  });

  beginButton.addEventListener("click", async () => {
    const note = availableNotes.find((item) => item.id === noteSelect.value);
    if (!note) return;
    await activateLearningSection(note, Number(sectionSelect.value || 0), app, mode);
    modal.close();
  });
}

async function moveLearningSection(context, direction, app, mode) {
  const learning = context?.learningMode;
  const note = context?.note;
  if (!learning || !note) return;
  const nextIndex = Math.max(0, Math.min(learning.totalSections - 1, learning.sectionIndex + direction));
  if (nextIndex === learning.sectionIndex) return;
  await activateLearningSection(note, nextIndex, app, mode);
}

async function activateLearningSection(note, sectionIndex, app, mode) {
  const sections = getLearningSections(note);
  const safeIndex = Math.max(0, Math.min(sections.length - 1, Number(sectionIndex || 0)));
  const section = sections[safeIndex];
  if (!section) return;

  manualContext = buildLearningContext(note, safeIndex);
  pendingChatPrompt = `请开始带我学习“${section.title}”。先说明本节学习目标，再从第一个核心概念开始，通过提问确认我是否理解；不要一次性把整章内容全部讲完。`;
  await put("learningProgress", {
    id: note.id,
    noteId: note.id,
    noteTitle: note.title,
    sectionId: section.id,
    sectionTitle: section.title,
    sectionIndex: safeIndex,
    totalSections: sections.length,
    updatedAt: nowIso()
  });

  if (mode === "workspace") app.refresh();
  else {
    app.setChatOpen(true);
    app.refreshChat();
  }
}

function buildLearningContext(note, sectionIndex) {
  const sections = getLearningSections(note);
  const section = sections[sectionIndex];
  return {
    contextKey: `learn:${note.id}:section:${section.id}`,
    note,
    section: {
      id: section.id,
      title: section.title,
      content: section.content
    },
    learningMode: {
      noteId: note.id,
      sectionId: section.id,
      sectionTitle: section.title,
      sectionIndex,
      totalSections: sections.length
    }
  };
}

function getLearningSections(note) {
  if (!note) return [];
  if (Array.isArray(note.sections) && note.sections.length) return note.sections;
  if (!note.content) return [];
  return [{ id: "full", title: "全文", content: note.content }];
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
    const setQuestions = set
      ? questions.filter((item) => item.setId === set.id).sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      : [];
    const setAnswerSummary = set ? buildQuestionSetAnswerSummary(setQuestions, answers, wrongItems) : null;

    manualContext = buildManualChatContext({ note, set, question, answer, wrongItem, setAnswerSummary });
    modal.close();
    if (mode === "workspace") {
      app.refresh();
    } else {
      app.setChatOpen(true);
      app.refreshChat();
    }
  });
}

export function buildManualChatContext({ note, set, question, answer, wrongItem, setAnswerSummary }) {
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
    questionSetProgress: setAnswerSummary?.progress,
    questionSetAnswers: setAnswerSummary?.answers,
    answer: summarizeAnswerContext(answer),
    correctAnswer: question?.correctAnswer || question?.referenceAnswer,
    aiExplanation: answer?.aiTeaching || question?.explanation,
    wrongItem
  };
}

function buildQuestionSetAnswerSummary(questions, answers, wrongItems) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
  const wrongItemMap = new Map(wrongItems.map((item) => [item.questionId, item]));
  const summarizedAnswers = questions.map((question) => {
    const answer = answerMap.get(question.id);
    const wrongItem = wrongItemMap.get(question.id);
    return {
      questionId: question.id,
      order: question.order,
      type: question.type,
      questionType: question.questionType,
      question: question.question,
      relatedNoteSection: question.relatedNoteSection,
      correctAnswer: question.correctAnswer || question.referenceAnswer,
      explanation: question.explanation,
      userAnswer: summarizeAnswerContext(answer),
      wrongItem: wrongItem
        ? {
            errorReason: wrongItem.errorReason,
            aiExplanation: wrongItem.aiExplanation,
            mastered: wrongItem.mastered,
            reviewCount: wrongItem.reviewCount
          }
        : undefined
    };
  });

  const submitted = summarizedAnswers.filter((item) => item.userAnswer?.submitted).length;
  const correct = summarizedAnswers.filter((item) => item.userAnswer?.isCorrect === true).length;
  const wrong = summarizedAnswers.filter((item) => item.userAnswer?.isCorrect === false).length;
  const withImageAnswers = summarizedAnswers.filter((item) => item.userAnswer?.hasImageAnswer).length;

  return {
    progress: {
      totalQuestions: questions.length,
      submitted,
      correct,
      wrong,
      withImageAnswers
    },
    answers: summarizedAnswers
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
    refresh: `<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/>`,
    lightbulb: `<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5Z"/>`,
    "chevron-left": `<path d="m15 18-6-6 6-6"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`
  };

  return `<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

import { openModal } from "../components/Modal.js";
import { showToast } from "../components/Toast.js";
import { buildQuestionGenerationMessages, normalizeGeneratedQuestionData } from "../prompts/questionGeneration.js";
import { callJsonCompletion } from "../services/ai/aiClient.js";
import { get, getAll, getByIndex, put, putMany } from "../services/storage/db.js";
import { startElapsedTimer } from "../utils/elapsedTimer.js";
import { createId, formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml, renderMarkdown } from "../utils/markdown.js";

export async function renderNotePage(container, app, noteId) {
  const note = await get("notes", noteId);
  if (!note) {
    container.innerHTML = `<div class="error-state"><h1>未找到笔记</h1><p>这份笔记可能已被删除。</p></div>`;
    return;
  }

  const sets = (await getByIndex("questionSets", "noteId", note.id)).sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
  const notebooks = await getAll("notebooks");
  const notebook = notebooks.find((item) => item.id === note.notebookId);

  const targetSection = app.route.query.get("section");
  const activeSection = (note.sections || []).find((section) => section.id === targetSection);
  app.setContext({
    contextKey: activeSection ? `note:${note.id}:section:${activeSection.id}` : `note:${note.id}`,
    note,
    section: activeSection
      ? {
          title: activeSection.title,
          content: activeSection.content
        }
      : undefined
  });
  container.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">笔记阅读</p>
        <h1>${escapeHtml(note.title)}</h1>
        <p>${escapeHtml(note.fileName)} · ${note.sections?.length || 1} 个章节 · ${escapeHtml(notebook?.title || "未归档")}</p>
      </div>
      <div class="page-actions">
        <button class="secondary-button" type="button" data-move-note-notebook>整理到笔记本</button>
        <button class="primary-button" type="button" data-open-generator>生成练习</button>
      </div>
    </section>
    <section class="set-strip">
      <h2>练习套题</h2>
      ${
        sets.length
          ? sets
              .map(
                (set) => `
                  <article>
                    <div>
                      <strong>${escapeHtml(set.title)}</strong>
                      <span>${escapeHtml(set.difficulty)} · 选择题 ${set.choiceCount} · 大题 ${set.subjectiveCount} · ${formatDateTime(set.createdAt)}</span>
                    </div>
                    <button class="secondary-button" data-open-set="${set.id}" type="button">开始/继续</button>
                  </article>`
              )
              .join("")
          : `<div class="empty-state compact">还没有为这份笔记生成练习。</div>`
      }
    </section>
    <section class="reader-layout">
      <aside class="section-list">
        ${(note.sections || [])
          .map((section) => `<a href="#/note/${note.id}?section=${section.id}">${escapeHtml(section.title)}</a>`)
          .join("")}
      </aside>
      <article class="markdown-body">
        ${(note.sections || [])
          .map(
            (section) => `
              <section id="section-${section.id}">
                ${renderMarkdown(section.content)}
              </section>`
          )
          .join("")}
      </article>
    </section>
  `;

  container.querySelector("[data-open-generator]").addEventListener("click", () => {
    openGenerateModal(note, app);
  });

  container.querySelector("[data-move-note-notebook]").addEventListener("click", () => {
    openMoveNoteModal(note, notebooks, app);
  });

  container.querySelectorAll("[data-open-set]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/practice/${button.dataset.openSet}`));
  });

  if (targetSection) {
    window.setTimeout(() => document.getElementById(`section-${targetSection}`)?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  if (app.route.query.get("generate") === "1") {
    window.history.replaceState(null, "", `#/note/${note.id}`);
    window.setTimeout(() => openGenerateModal(note, app), 50);
  }
}

function openMoveNoteModal(note, notebooks, app) {
  const content = document.createElement("div");
  content.className = "notebook-modal-form";
  content.innerHTML = `
    <label>
      <span>选择笔记本</span>
      <select data-note-notebook>
        <option value="" ${!note.notebookId ? "selected" : ""}>未归档</option>
        ${notebooks
          .map(
            (notebook) => `
              <option value="${escapeHtml(notebook.id)}" ${note.notebookId === notebook.id ? "selected" : ""}>
                ${escapeHtml(notebook.title)}
              </option>`
          )
          .join("")}
      </select>
    </label>
    <div class="status-box">${
      notebooks.length ? "保存后这份笔记会出现在对应笔记本中。" : "还没有笔记本，可以先去“笔记本”页面创建。"
    }</div>
    <div class="form-actions">
      <button class="secondary-button" data-open-notebooks type="button">管理笔记本</button>
      <button class="primary-button" data-save-note-notebook type="button">保存归档</button>
    </div>
  `;

  const modal = openModal({ title: "整理到笔记本", content, width: "520px" });
  modal.body.querySelector("[data-open-notebooks]").addEventListener("click", () => {
    modal.close();
    app.navigate("/notebooks");
  });
  modal.body.querySelector("[data-save-note-notebook]").addEventListener("click", async () => {
    await put("notes", {
      ...note,
      notebookId: modal.body.querySelector("[data-note-notebook]").value,
      updatedAt: nowIso()
    });
    showToast("笔记归档已更新", "success");
    modal.close();
    app.refresh();
  });
}

function openGenerateModal(note, app) {
  const content = document.createElement("div");
  const defaultTitle = buildDefaultSetTitle(note, "适中");
  content.innerHTML = `
    <form class="generate-form" data-generate-form>
      <label>
        <span>题组名称</span>
        <input name="setTitle" required maxlength="80" value="${escapeHtml(defaultTitle)}" />
      </label>
      <div class="form-grid">
        <label>
          <span>选择题数量</span>
          <input name="choiceCount" type="number" min="0" max="20" value="3" />
        </label>
        <label>
          <span>大题数量</span>
          <input name="subjectiveCount" type="number" min="0" max="10" value="1" />
        </label>
      </div>
      <label>
        <span>难度</span>
        <select name="difficulty">
          <option value="简单">简单</option>
          <option value="适中" selected>适中</option>
          <option value="困难">困难</option>
        </select>
      </label>
      <label>
        <span>出题引导（可选）</span>
        <textarea name="guidance" rows="4" placeholder="例如：只练前 3 章；重点考察概念理解；按照考研难度出题。"></textarea>
      </label>
      <fieldset class="checkbox-group">
        <legend>大题题型</legend>
        <label><input type="checkbox" name="subjectiveTypes" value="short_answer" checked /> 简答题</label>
        <label><input type="checkbox" name="subjectiveTypes" value="proof" checked /> 证明题</label>
        <label><input type="checkbox" name="subjectiveTypes" value="calculation" checked /> 计算题</label>
      </fieldset>
      <div class="status-box" data-generate-status>生成后题目会保存到本地，并关联到当前笔记。大笔记建议先少量生成，稳定后再分批追加。</div>
      <div class="form-actions">
        <button class="primary-button" type="submit">开始生成</button>
      </div>
    </form>
  `;

  const modal = openModal({ title: "生成练习题", content, width: "560px" });
  const form = modal.body.querySelector("[data-generate-form]");
  const status = modal.body.querySelector("[data-generate-status]");
  const titleInput = form.elements.setTitle;
  const difficultySelect = form.elements.difficulty;

  difficultySelect.addEventListener("change", () => {
    if (!titleInput.dataset.touched) {
      titleInput.value = buildDefaultSetTitle(note, difficultySelect.value);
    }
  });
  titleInput.addEventListener("input", () => {
    titleInput.dataset.touched = "1";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const setTitle = String(formData.get("setTitle") || "").trim();
    const choiceCount = Number(formData.get("choiceCount") || 0);
    const subjectiveCount = Number(formData.get("subjectiveCount") || 0);
    const difficulty = String(formData.get("difficulty") || "适中");
    const guidance = String(formData.get("guidance") || "").trim();
    const subjectiveTypes = formData.getAll("subjectiveTypes").map(String);

    if (!setTitle) {
      showToast("请填写题组名称", "error");
      return;
    }

    if (choiceCount + subjectiveCount <= 0) {
      showToast("请至少生成一道题", "error");
      return;
    }

    if (subjectiveCount > 0 && subjectiveTypes.length === 0) {
      showToast("生成大题时请至少选择一种大题题型", "error");
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;
    const elapsedTimer = startElapsedTimer(status, "出题中");

    try {
      const raw = await callJsonCompletion({
        role: "question",
        messages: buildQuestionGenerationMessages({
          note,
          choiceCount,
          subjectiveCount,
          difficulty,
          guidance,
          subjectiveTypes
        }),
        temperature: 0.25,
        timeoutMs: 300000
      });
      const normalized = normalizeGeneratedQuestionData(raw);
      const allQuestions = [
        ...normalized.choiceQuestions.map((question) => ({ ...question, type: "choice" })),
        ...normalized.subjectiveQuestions.map((question) => ({ ...question, type: "subjective" }))
      ];

      if (allQuestions.length === 0) {
        throw new Error("出题模型没有返回任何题目");
      }

      const setId = createId("set");
      const createdAt = nowIso();
      const set = {
        id: setId,
        noteId: note.id,
        title: setTitle,
        difficulty,
        choiceCount: normalized.choiceQuestions.length,
        subjectiveCount: normalized.subjectiveQuestions.length,
        guidance,
        subjectiveTypes,
        createdAt,
        updatedAt: createdAt,
        lastPracticeAt: ""
      };
      const questions = allQuestions.map((question, index) => ({
        id: createId("question"),
        setId,
        noteId: note.id,
        order: index + 1,
        createdAt,
        ...question
      }));

      await put("questionSets", set);
      await putMany("questions", questions);
      elapsedTimer.stop();
      showToast(`已保存 ${questions.length} 道题`, "success");
      modal.close();
      app.navigate(`/practice/${setId}`);
    } catch (error) {
      elapsedTimer.stop();
      status.textContent = `生成失败：${error.message}`;
      showToast(error.message, "error");
      submitButton.disabled = false;
    }
  });
}

function buildDefaultSetTitle(note, difficulty) {
  const sectionTitle = note.sections?.[0]?.title;
  const base = sectionTitle && sectionTitle !== "全文" ? sectionTitle : note.title;
  const date = new Date().toISOString().slice(0, 10);
  return `${base}-${difficulty}练习-${date}`;
}

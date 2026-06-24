import { openModal } from "../components/Modal.js";
import { bindOverflowMenus, renderOverflowMenu } from "../components/OverflowMenu.js";
import { buildManualChatContext, setManualChatContext } from "../components/ChatPanel.js";
import { showToast } from "../components/Toast.js";
import { buildGradingMessages, normalizeGradeResult } from "../prompts/grading.js";
import { buildWrongAnalysisMessages } from "../prompts/wrongAnalysis.js";
import { callJsonCompletion } from "../services/ai/aiClient.js";
import { recordGradingAttempt, recordGradingFailure } from "../services/gradingHistory.js";
import {
  formatReviewDue,
  getReviewCardMap,
  orphanReviewCard,
  ratingFromPerformance,
  recordReviewOutcome,
  setReviewCardSuspended
} from "../services/reviewScheduler.js";
import { get, getAll, getByIndex, put, remove } from "../services/storage/db.js";
import { recordWrongReview } from "../services/studyTracker.js";
import { startElapsedTimer } from "../utils/elapsedTimer.js";
import { readImageFile } from "../utils/file.js";
import { formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml } from "../utils/markdown.js";
import { typesetMath } from "../utils/math.js";

const LABELS = ["A", "B", "C", "D"];

export async function renderWrongBookPage(container, app) {
  const rawWrongItems = await getAll("wrongItems");
  const uniqueNoteIds = [...new Set(rawWrongItems.map((item) => item.noteId).filter(Boolean))];
  const notes = (await Promise.all(uniqueNoteIds.map(id => get("notes", id)))).filter(Boolean).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const reviewCardMap = await getReviewCardMap();
  const allWrongItems = rawWrongItems
    .map((item) => {
      const reviewCard = reviewCardMap.get(item.id);
      return {
        ...item,
        reviewCard,
        reviewDue: Boolean(reviewCard && !reviewCard.suspended && Date.parse(reviewCard.dueAt || 0) <= endOfToday())
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const filters = readFilters(app.route.query);
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const sections = unique(
    allWrongItems
      .filter((item) => filters.noteId === "all" || item.noteId === filters.noteId)
      .map((item) => item.section || "未标注章节")
  );
  const filtered = allWrongItems;
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {
    all: allWrongItems.length,
    open: allWrongItems.filter((item) => !item.mastered).length,
    mastered: allWrongItems.filter((item) => item.mastered).length,
    due: allWrongItems.filter((item) => item.reviewDue).length,
    recent: allWrongItems.filter((item) => Date.parse(item.createdAt || 0) >= recentThreshold).length
  };

  app.setContext({ contextKey: "wrong-book", note: filters.noteId !== "all" ? noteMap.get(filters.noteId) : undefined });

  container.innerHTML = `
    <section class="archive-page-header mistake-page-header">
      <div>
        <p class="page-kicker">Error Review</p>
        <h1>错题本</h1>
        <p>回顾错误，分析原因，把错题转化为真正掌握的知识点。</p>
      </div>
      <div class="page-actions">
        <button class="primary-button" data-analyze-weakness type="button">薄弱点分析</button>
      </div>
    </section>

    <section class="archive-summary mistake-summary" aria-label="错题概览">
      ${renderMistakeMetric(counts.all, "错题总数")}
      ${renderMistakeMetric(counts.due, "今日待复习", "review")}
      ${renderMistakeMetric(counts.mastered, "已掌握")}
      ${renderMistakeMetric(counts.recent, "近 7 天新增")}
    </section>

    <section class="mistake-controls" aria-label="错题筛选">
      <div class="mistake-primary-filters">
        <label class="archive-search">
          <span class="sr-only">搜索错题</span>
          <svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
          <input data-wrong-search type="search" placeholder="搜索题目、错因或知识点" autocomplete="off" />
        </label>
        <div class="archive-filter-tabs" role="group" aria-label="掌握状态">
          <button class="${filters.status === "all" ? "active" : ""}" data-status-filter="all" type="button">全部错题</button>
          <button class="${filters.status === "open" ? "active" : ""}" data-status-filter="open" type="button">待复习</button>
          <button class="${filters.status === "due" ? "active" : ""}" data-status-filter="due" type="button">今日计划</button>
          <button class="${filters.status === "mastered" ? "active" : ""}" data-status-filter="mastered" type="button">已掌握</button>
        </div>
      </div>
      <details class="mistake-advanced-filters" ${filters.noteId !== "all" || filters.section !== "all" || filters.type !== "all" || filters.setId !== "all" ? "open" : ""}>
        <summary>高级筛选</summary>
        <div class="wrong-filters">
          <label>
            <span>笔记</span>
            <select data-filter="noteId">
              <option value="all">全部笔记</option>
              ${notes.map((note) => `<option value="${note.id}" ${filters.noteId === note.id ? "selected" : ""}>${escapeHtml(note.title)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>章节</span>
            <select data-filter="section">
              <option value="all">全部章节</option>
              ${sections.map((section) => `<option value="${escapeHtml(section)}" ${filters.section === section ? "selected" : ""}>${escapeHtml(section)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>题型</span>
            <select data-filter="type">
              <option value="all" ${filters.type === "all" ? "selected" : ""}>全部题型</option>
              <option value="choice" ${filters.type === "choice" ? "selected" : ""}>选择题</option>
              <option value="subjective" ${filters.type === "subjective" ? "selected" : ""}>大题</option>
            </select>
          </label>
        </div>
      </details>
    </section>

    <section class="wrong-list mistake-journal" data-wrong-list>
      ${
        filtered.length
          ? filtered.map((item) => renderWrongItem(item, noteMap.get(item.noteId))).join("")
          : renderWrongEmptyState(filters)
      }
    </section>
    <div class="empty-state archive-filter-empty" data-wrong-filter-empty hidden>没有符合搜索条件的错题。</div>
  `;

  bindWrongFilters(container, filters);

  container.querySelector("[data-analyze-weakness]").addEventListener("click", () => {
    const availableNoteIds = [...new Set(allWrongItems.filter(item => !item.mastered).map(item => item.noteId))].filter(Boolean);
    if (availableNoteIds.length === 0) {
      showToast("当前没有任何未掌握的错题可供分析", "info");
      return;
    }
    const optionsHtml = availableNoteIds.map(noteId => {
      const title = noteMap.get(noteId)?.title || "未知笔记";
      return `<option value="${noteId}">${escapeHtml(title)}</option>`;
    }).join("");

    const modal = openModal({
      title: "选择要分析的笔记",
      content: `
        <div class="form-group">
          <label>请选择一份笔记以提取薄弱点：</label>
          <select id="weakness-note-select" class="form-control" style="margin-top: 8px;">
            ${optionsHtml}
          </select>
        </div>
        <div class="modal-actions" style="margin-top: 24px; display: flex; justify-content: flex-end;">
          <button class="primary-button" id="start-weakness-analysis" type="button">开始分析</button>
        </div>
      `,
      width: "400px"
    });

    modal.body.querySelector("#start-weakness-analysis").addEventListener("click", async () => {
      const selectedNoteId = modal.body.querySelector("#weakness-note-select").value;
      modal.close();
      await analyzeWeakness(selectedNoteId, allWrongItems, noteMap);
    });
  });
  bindOverflowMenus(container);

  container.querySelectorAll("[data-delete-wrong]").forEach((button) => {
    button.addEventListener("click", async () => {
      await confirmDeleteWrongItem(button.dataset.deleteWrong, app);
    });
  });

  container.querySelectorAll("[data-toggle-mastered]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = await get("wrongItems", button.dataset.toggleMastered);
      if (!item) return;
      await put("wrongItems", {
        ...item,
        mastered: !item.mastered,
        lastReviewedAt: nowIso()
      });
      await setReviewCardSuspended(item.id, !item.mastered);
      showToast(item.mastered ? "已改为未掌握" : "已标记掌握", "success");
      app.refresh();
    });
  });

  container.querySelectorAll("[data-review-wrong]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = await get("wrongItems", button.dataset.reviewWrong);
      if (!item) return;
      await openReviewModal(item, app);
    });
  });

  container.querySelectorAll("[data-ask-wrong]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = await get("wrongItems", button.dataset.askWrong);
      if (!item) return;
      const [note, question, set, answer] = await Promise.all([
        noteMap.get(item.noteId) || get("notes", item.noteId),
        item.questionId ? get("questions", item.questionId) : null,
        item.setId ? get("questionSets", item.setId) : null,
        item.questionId ? get("answers", item.questionId) : null
      ]);
      const chatContext = question
        ? buildManualChatContext({ note, set, question, answer, wrongItem: item })
        : {
            contextKey: `wrong:${item.id}`,
            note,
            wrongItem: item,
            correctAnswer: item.correctAnswer,
            aiExplanation: item.aiExplanation
          };
      setManualChatContext({ ...chatContext, contextKey: `wrong:${item.id}` });
      if (!question) showToast("原题记录已不存在，将使用当前错题内容作为上下文", "error");
      app.navigate("/chat");
    });
  });

  container.querySelectorAll("[data-show-wrong-details]").forEach((button) => {
    button.addEventListener("click", () => {
      const details = container.querySelector(`[data-wrong-details="${button.dataset.showWrongDetails}"]`);
      if (details) details.open = true;
    });
  });
}

function readFilters(query) {
  return {
    noteId: query.get("noteId") || "all",
    section: query.get("section") || "all",
    type: query.get("type") || "all",
    status: query.get("status") || "all",
    setId: query.get("setId") || "all"
  };
}

function matchFilters(item, filters) {
  if (filters.noteId !== "all" && item.noteId !== filters.noteId) return false;
  if (filters.section !== "all" && item.section !== filters.section) return false;
  if (filters.type !== "all" && item.questionType !== filters.type) return false;
  if (filters.status === "open" && item.mastered) return false;
  if (filters.status === "mastered" && !item.mastered) return false;
  if (filters.status === "due" && !item.reviewDue) return false;
  if (filters.setId !== "all" && item.setId !== filters.setId) return false;
  return true;
}

function renderWrongItem(item, note) {
  const typeLabel = item.questionType === "choice" ? "选择题" : "大题";
  const menuItems = `
    <button class="danger-menu-item" data-delete-wrong="${item.id}" role="menuitem" type="button">删除错题</button>
  `;
  const questionPreview = compactText(item.questionContent, 118);
  const errorPreview = compactText(item.errorReason || item.aiExplanation || "尚未记录明确错因", 100);
  const searchText = [note?.title, item.section, item.questionContent, item.errorReason, item.aiExplanation]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();

  return `
    <article class="mistake-card" data-wrong-card data-note-id="${escapeHtml(item.noteId || 'all')}" data-section="${escapeHtml(item.section || 'all')}" data-type="${escapeHtml(item.questionType || 'all')}" data-status-open="${!item.mastered}" data-status-mastered="${!!item.mastered}" data-status-due="${!!item.reviewDue}" data-search="${escapeHtml(searchText)}">
      <div class="mistake-card-index" aria-hidden="true">${item.mastered ? "✓" : "!"}</div>
      <div class="mistake-card-main">
        <div class="mistake-card-heading">
          <div>
            <p class="mistake-source">${escapeHtml(note?.title || "未知笔记")}</p>
            <h2>${escapeHtml(questionPreview)}</h2>
          </div>
          <span class="mastery-badge ${item.mastered && !item.reviewDue ? "mastered" : ""}">${
            item.reviewDue ? "今日待复习" : item.mastered ? "已掌握" : "等待安排"
          }</span>
        </div>
        <div class="mistake-diagnosis">
          <span>错因</span>
          <p>${escapeHtml(errorPreview)}</p>
        </div>
        <div class="mistake-meta">
          <span>${escapeHtml(item.section || "未标注章节")}</span>
          <span>${typeLabel}</span>
          <span>复习 ${Number(item.reviewCount || 0)} 次</span>
          <span>${item.lastReviewedAt ? `最近复习 ${formatDateTime(item.lastReviewedAt)}` : "尚未复习"}</span>
          <span>下次复习 ${formatReviewDue(item.reviewCard?.dueAt)}</span>
        </div>
      </div>
      <div class="mistake-card-actions">
        ${
          item.mastered && !item.reviewDue
            ? `<button class="secondary-button" data-show-wrong-details="${item.id}" type="button">查看解析</button>`
            : `<button class="primary-button" data-review-wrong="${item.id}" type="button">继续复习</button>`
        }
        ${renderOverflowMenu({ label: "错题的更多操作", items: menuItems })}
      </div>
      <details class="mistake-details" data-wrong-details="${item.id}">
        <summary>
          <span>展开完整题目与解析</span>
          <svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>
        </summary>
        <div class="mistake-detail-grid">
          <section class="mistake-question-sheet">
            <p class="detail-label">完整题目</p>
            <div>${escapeHtml(item.questionContent)}</div>
          </section>
          <section>
            <p class="detail-label">你的答案</p>
            <div>${escapeHtml(item.userAnswer || "未记录")}</div>
          </section>
          <section>
            <p class="detail-label">错误原因</p>
            <div>${escapeHtml(item.errorReason || "未记录")}</div>
          </section>
          <section class="mistake-correct-answer">
            <p class="detail-label">正确或参考答案</p>
            <div>${escapeHtml(item.correctAnswer || "未记录")}</div>
          </section>
          <section class="mistake-ai-explanation">
            <p class="detail-label">AI 解析</p>
            <div>${escapeHtml(item.aiExplanation || "未记录")}</div>
          </section>
        </div>
        <div class="mistake-detail-actions">
          <span class="wrong-created-at">记录于 ${formatDateTime(item.createdAt)}</span>
          <div>
            <button class="secondary-button" data-ask-wrong="${item.id}" type="button">问 AI</button>
            <button class="secondary-button" data-toggle-mastered="${item.id}" type="button">${item.mastered ? "标记未掌握" : "标记已掌握"}</button>
          </div>
        </div>
      </details>
    </article>
  `;
}

function renderMistakeMetric(value, label, tone = "") {
  return `<div class="archive-metric ${tone}"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderWrongEmptyState(filters) {
  const scoped = filters.setId !== "all" || filters.noteId !== "all" || filters.status !== "all";
  return `
    <div class="empty-state archive-empty-state">
      <p class="page-kicker">Mistake Journal</p>
      <h2>${scoped ? "当前范围内没有错题" : "错题本还是空的"}</h2>
      <p>${scoped ? "调整筛选条件，或继续完成练习后再回来查看。" : "完成练习后，未掌握的题目会自动归入这里。"}</p>
    </div>
  `;
}

function compactText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function bindWrongFilters(container, initialFilters) {
  const input = container.querySelector("[data-wrong-search]");
  const items = [...container.querySelectorAll("[data-wrong-card]")];
  const empty = container.querySelector("[data-wrong-filter-empty]");
  const statusButtons = [...container.querySelectorAll("[data-status-filter]")];
  const selects = [...container.querySelectorAll("[data-filter]")];

  let currentFilters = { ...initialFilters };

  const applyFilters = () => {
    const query = input?.value.trim().toLocaleLowerCase() || "";
    let visibleCount = 0;

    items.forEach((item) => {
      let match = true;
      if (currentFilters.noteId !== "all" && item.dataset.noteId !== currentFilters.noteId) match = false;
      if (currentFilters.section !== "all" && item.dataset.section !== currentFilters.section) match = false;
      if (currentFilters.type !== "all" && item.dataset.type !== currentFilters.type) match = false;
      if (currentFilters.status === "open" && item.dataset.statusOpen !== "true") match = false;
      if (currentFilters.status === "mastered" && item.dataset.statusMastered !== "true") match = false;
      if (currentFilters.status === "due" && item.dataset.statusDue !== "true") match = false;
      if (query && !item.dataset.search.includes(query)) match = false;
      
      item.hidden = !match;
      if (match) visibleCount += 1;
    });

    if (empty) empty.hidden = visibleCount > 0 || items.length === 0;
  };

  input?.addEventListener("input", applyFilters);

  statusButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilters.status = button.dataset.statusFilter;
      statusButtons.forEach((item) => item.classList.toggle("active", item === button));
      applyFilters();
    });
  });

  selects.forEach((select) => {
    select.addEventListener("change", () => {
      currentFilters[select.dataset.filter] = select.value;
      if (select.dataset.filter === "noteId") {
        currentFilters.section = "all";
        const sectionSelect = container.querySelector('[data-filter="section"]');
        if (sectionSelect) sectionSelect.value = "all";
      }
      applyFilters();
    });
  });

  applyFilters();
}

async function analyzeWeakness(noteId, allWrongItems, noteMap) {
  const note = noteMap.get(noteId);
  const wrongItems = allWrongItems.filter((item) => item.noteId === noteId && !item.mastered);
  if (!note) {
    showToast("未找到笔记", "error");
    return;
  }
  if (wrongItems.length === 0) {
    showToast("这份笔记下没有未掌握错题", "error");
    return;
  }

  const modal = openModal({
    title: "薄弱点分析",
    content: `<div class="loading">正在分析 ${wrongItems.length} 条错题...</div>`,
    width: "720px"
  });

  try {
    const result = await callJsonCompletion({
      role: "question",
      messages: buildWrongAnalysisMessages({ note, wrongItems }),
      temperature: 0.25
    });

    modal.body.innerHTML = `
      <div class="analysis-result">
        ${renderAnalysisList("薄弱知识点", result.weakKnowledgePoints)}
        ${renderAnalysisList("常见错误模式", result.commonErrorPatterns)}
        ${renderAnalysisList("推荐复习的笔记章节", result.recommendedSections)}
        ${renderAnalysisList("建议重新练习的题型", result.suggestedQuestionTypes)}
        <section>
          <h3>学习建议</h3>
          <p>${escapeHtml(result.studyAdvice || "暂无建议")}</p>
        </section>
      </div>
    `;
  } catch (error) {
    modal.body.innerHTML = `<div class="error-state">分析失败：${escapeHtml(error.message)}</div>`;
  }
}

function renderAnalysisList(title, values) {
  const list = Array.isArray(values) ? values : [];
  return `
    <section>
      <h3>${title}</h3>
      ${
        list.length
          ? `<ul>${list.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
          : `<p>暂无</p>`
      }
    </section>
  `;
}

async function confirmDeleteWrongItem(itemId, app) {
  const modal = openModal({
    title: "删除错题",
    content: `
      <div class="review-box">
        <p>确定删除这条错题记录吗？删除后不会影响原题和已保存的答题记录。</p>
        <div class="form-actions">
          <button class="secondary-button" data-cancel-delete-wrong type="button">取消</button>
          <button class="danger-button" data-confirm-delete-wrong type="button">删除</button>
        </div>
      </div>`,
    width: "460px"
  });

  modal.body.querySelector("[data-cancel-delete-wrong]").addEventListener("click", () => modal.close());
  modal.body.querySelector("[data-confirm-delete-wrong]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await remove("wrongItems", itemId);
      await orphanReviewCard(itemId);
      showToast("错题已删除", "success");
      modal.close();
      app.refresh();
    } catch (error) {
      button.disabled = false;
      showToast(`删除失败：${error.message}`, "error");
    }
  });
}

async function openReviewModal(item, app) {
  const note = await get("notes", item.noteId);
  const question = item.questionId ? await get("questions", item.questionId) : null;
  const content = document.createElement("div");

  if (!question) {
    content.innerHTML = `<div class="error-state">找不到原题，无法重新练习。</div>`;
    openModal({ title: "重新练习", content });
    return;
  }

  content.innerHTML =
    question.type === "choice"
      ? renderChoiceReview(question)
      : renderSubjectiveReview(question);

  const modal = openModal({ title: "重新练习", content, width: "720px" });

  if (question.type === "choice") {
    bindChoiceReview(modal, item, question, app);
  } else {
    bindSubjectiveReview(modal, item, note, question, app);
  }
}

function renderChoiceReview(question) {
  return `
    <div class="review-box">
      <h3>${escapeHtml(question.question)}</h3>
      <div class="choice-list">
        ${question.options
          .map(
            (option, index) => `
              <button class="choice-option" data-review-choice="${LABELS[index]}" type="button">
                ${escapeHtml(option)}
              </button>`
          )
          .join("")}
      </div>
      <div class="status-box" data-review-status>请选择一个答案后提交。</div>
      <div class="form-actions">
        <button class="primary-button" data-submit-review-choice type="button" disabled>提交复习答案</button>
      </div>
    </div>
  `;
}

function bindChoiceReview(modal, item, question, app) {
  let selected = "";
  const status = modal.body.querySelector("[data-review-status]");
  const submit = modal.body.querySelector("[data-submit-review-choice]");

  modal.body.querySelectorAll("[data-review-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      selected = button.dataset.reviewChoice;
      modal.body.querySelectorAll("[data-review-choice]").forEach((itemButton) => itemButton.classList.remove("selected"));
      button.classList.add("selected");
      submit.disabled = false;
      status.textContent = `已选择 ${selected}，还未提交。`;
    });
  });

  submit.addEventListener("click", async () => {
    const isCorrect = selected === question.correctAnswer;
    const schedule = await recordReviewOutcome({
      wrongItem: item,
      question,
      rating: ratingFromPerformance({ score: isCorrect ? 85 : 0, isCorrect }),
      score: isCorrect ? 85 : 0,
      isCorrect
    });
    await put("wrongItems", {
      ...item,
      reviewCount: Number(item.reviewCount || 0) + 1,
      lastReviewedAt: nowIso(),
      nextReviewAt: schedule.card.dueAt,
      mastered: isCorrect ? true : item.mastered
    });
    await recordWrongReview(isCorrect);
    status.textContent = isCorrect
      ? `回答正确；下次复习安排在${formatReviewDue(schedule.card.dueAt)}。`
      : `仍需复习。正确答案是 ${question.correctAnswer}。${question.explanation || ""}`;
    showToast(isCorrect ? "复习正确，已标记掌握" : "复习错误，请继续订正", isCorrect ? "success" : "error");
    window.setTimeout(() => {
      modal.close();
      app.refresh();
    }, 1200);
  });
}

function renderSubjectiveReview(question) {
  return `
    <div class="review-box">
      <h3>${escapeHtml(question.question)}</h3>
      <label>
        <span>重新作答</span>
        <textarea data-review-text rows="7" placeholder="输入你的答案..."></textarea>
      </label>
      <div class="image-answer-row">
        <label class="secondary-button file-button">
          上传图片答案
          <input data-review-image type="file" accept="image/*" hidden />
        </label>
      </div>
      <div data-review-preview></div>
      <div class="status-box" data-review-status>可提交文字、图片或两者。</div>
      <div class="form-actions">
        <button class="primary-button" data-submit-review-subjective type="button">提交复习答案</button>
      </div>
    </div>
  `;
}

function bindSubjectiveReview(modal, item, note, question, app) {
  let imageDataUrl = "";
  let imageName = "";
  const status = modal.body.querySelector("[data-review-status]");
  const preview = modal.body.querySelector("[data-review-preview]");

  modal.body.querySelector("[data-review-image]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const image = await readImageFile(file);
      imageDataUrl = image.dataUrl;
      imageName = image.name;
      preview.innerHTML = `
        <figure class="answer-image-preview">
          <img src="${imageDataUrl}" alt="复习答案图片" />
          <figcaption>${escapeHtml(imageName)}</figcaption>
        </figure>`;
      status.textContent = "图片已保存到本次复习。";
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  modal.body.querySelector("[data-submit-review-subjective]").addEventListener("click", async () => {
    const textAnswer = modal.body.querySelector("[data-review-text]").value.trim();
    if (!textAnswer && !imageDataUrl) {
      showToast("请先填写答案或上传图片", "error");
      return;
    }

    const button = modal.body.querySelector("[data-submit-review-subjective]");
    button.disabled = true;
    const elapsedTimer = startElapsedTimer(status, "判题中");

    try {
      const gradeResult = normalizeGradeResult(
        await callJsonCompletion({
          role: "grading",
          messages: buildGradingMessages({ note, question, textAnswer, imageDataUrl }),
          temperature: 0
        })
      );
      const gradingAttempt = await recordGradingAttempt({
        question,
        answer: { id: `review_answer_${item.id}`, questionId: question.id, noteId: item.noteId, setId: item.setId, textAnswer, imageDataUrl, imageName },
        result: gradeResult,
        context: "review",
        wrongItemId: item.id
      });
      const mastered = gradeResult.isCorrect && gradeResult.score >= 70;
      const schedule = await recordReviewOutcome({
        wrongItem: item,
        question,
        rating: ratingFromPerformance({ score: gradeResult.score, isCorrect: mastered }),
        score: gradeResult.score,
        isCorrect: mastered,
        gradingAttemptId: gradingAttempt.id
      });
      await put("wrongItems", {
        ...item,
        reviewCount: Number(item.reviewCount || 0) + 1,
        lastReviewedAt: nowIso(),
        nextReviewAt: schedule.card.dueAt,
        mastered: mastered ? true : item.mastered
      });
      await recordWrongReview(mastered);
      await app.refresh();
      elapsedTimer.stop();
      status.innerHTML = renderSubjectiveReviewResult(gradeResult, mastered, schedule.card.dueAt);
      await typesetMath(status);
      button.textContent = "本次复习已记录";
      showToast(mastered ? "复习通过" : "复习未通过", mastered ? "success" : "error");
      status.querySelector("[data-close-review-result]")?.addEventListener("click", () => modal.close());
    } catch (error) {
      try {
        await recordGradingFailure({
          question,
          answer: { id: `review_answer_${item.id}`, questionId: question.id, noteId: item.noteId, setId: item.setId, textAnswer, imageDataUrl, imageName },
          context: "review",
          wrongItemId: item.id,
          errorMessage: error.message
        });
      } catch (historyError) {
        console.warn("保存复习判题失败历史时出错", historyError);
      }
      elapsedTimer.stop();
      status.textContent = `判题失败：${error.message}`;
      button.disabled = false;
      showToast(error.message, "error");
    }
  });
}

function renderSubjectiveReviewResult(gradeResult, mastered, nextDueAt) {
  return `
    <div class="review-result ${mastered ? "correct" : "wrong"}">
      <strong>${mastered ? "复习通过，已标记掌握。" : "还需要继续复习。"}</strong>
      <p><strong>得分：</strong>${Number(gradeResult.score || 0)} / 100</p>
      ${gradeResult.recognizedAnswer ? `<p><strong>识别出的答案：</strong>${escapeHtml(gradeResult.recognizedAnswer)}</p>` : ""}
      <p><strong>判定理由：</strong>${escapeHtml(gradeResult.reason || "暂无理由")}</p>
      <p><strong>最早出错步骤：</strong>${escapeHtml(gradeResult.earliestErrorStep || (mastered ? "无" : "模型未明确指出"))}</p>
      <p><strong>下次复习：</strong>${formatReviewDue(nextDueAt)}</p>
      ${renderInlineList("做得好的地方", gradeResult.strengths)}
      ${renderInlineList("需要订正", gradeResult.weaknesses)}
      <div class="form-actions">
        <button class="secondary-button" data-close-review-result type="button">关闭</button>
      </div>
    </div>
  `;
}

function renderInlineList(title, values) {
  if (!Array.isArray(values) || values.length === 0) return "";
  return `<div><strong>${title}：</strong><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

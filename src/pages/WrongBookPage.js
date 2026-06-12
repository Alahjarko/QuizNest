import { openModal } from "../components/Modal.js";
import { setManualChatContext } from "../components/ChatPanel.js";
import { showToast } from "../components/Toast.js";
import { buildGradingMessages, normalizeGradeResult } from "../prompts/grading.js";
import { buildWrongAnalysisMessages } from "../prompts/wrongAnalysis.js";
import { callJsonCompletion } from "../services/ai/aiClient.js";
import { get, getAll, getByIndex, put, remove } from "../services/storage/db.js";
import { recordWrongReview } from "../services/studyTracker.js";
import { startElapsedTimer } from "../utils/elapsedTimer.js";
import { readImageFile } from "../utils/file.js";
import { formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml } from "../utils/markdown.js";
import { typesetMath } from "../utils/math.js";

const LABELS = ["A", "B", "C", "D"];

export async function renderWrongBookPage(container, app) {
  const notes = (await getAll("notes")).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const allWrongItems = (await getAll("wrongItems")).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const filters = readFilters(app.route.query);
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const sections = unique(
    allWrongItems
      .filter((item) => filters.noteId === "all" || item.noteId === filters.noteId)
      .map((item) => item.section || "未标注章节")
  );
  const filtered = allWrongItems.filter((item) => matchFilters(item, filters));

  app.setContext({ contextKey: "wrong-book", note: filters.noteId !== "all" ? noteMap.get(filters.noteId) : undefined });

  container.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">错题复习</p>
        <h1>错题本</h1>
        <p>按笔记、章节和题型定位薄弱点。错题会记录复习次数和掌握状态。</p>
      </div>
      <div class="page-actions">
        <button class="primary-button" data-analyze-weakness type="button">薄弱点分析</button>
      </div>
    </section>

    <section class="wrong-filters">
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
      <label>
        <span>掌握状态</span>
        <select data-filter="status">
          <option value="all" ${filters.status === "all" ? "selected" : ""}>全部</option>
          <option value="open" ${filters.status === "open" ? "selected" : ""}>未掌握</option>
          <option value="mastered" ${filters.status === "mastered" ? "selected" : ""}>已掌握</option>
        </select>
      </label>
    </section>

    <section class="wrong-list">
      ${
        filtered.length
          ? filtered.map((item) => renderWrongItem(item, noteMap.get(item.noteId))).join("")
          : `<div class="empty-state">当前筛选条件下没有错题。</div>`
      }
    </section>
  `;

  container.querySelectorAll("[data-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      const next = {
        ...filters,
        [select.dataset.filter]: select.value
      };
      if (select.dataset.filter === "noteId") next.section = "all";
      app.navigate(`/wrong?${new URLSearchParams(next).toString()}`);
    });
  });

  container.querySelector("[data-analyze-weakness]").addEventListener("click", async () => {
    await analyzeWeakness(filters, allWrongItems, noteMap);
  });

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
      const note = noteMap.get(item.noteId) || (await get("notes", item.noteId));
      setManualChatContext({
        contextKey: `wrong:${item.id}`,
        note,
        question: item.questionContent,
        answer: item.userAnswer,
        correctAnswer: item.correctAnswer,
        aiExplanation: item.aiExplanation,
        wrongItem: item
      });
      app.navigate("/chat");
    });
  });
}

function readFilters(query) {
  return {
    noteId: query.get("noteId") || "all",
    section: query.get("section") || "all",
    type: query.get("type") || "all",
    status: query.get("status") || "all"
  };
}

function matchFilters(item, filters) {
  if (filters.noteId !== "all" && item.noteId !== filters.noteId) return false;
  if (filters.section !== "all" && item.section !== filters.section) return false;
  if (filters.type !== "all" && item.questionType !== filters.type) return false;
  if (filters.status === "open" && item.mastered) return false;
  if (filters.status === "mastered" && !item.mastered) return false;
  return true;
}

function renderWrongItem(item, note) {
  return `
    <article class="wrong-card">
      <div class="wrong-card-header">
        <div>
          <strong>${escapeHtml(note?.title || "未知笔记")}</strong>
          <span>${escapeHtml(item.section || "未标注章节")} · ${item.questionType === "choice" ? "选择题" : "大题"} · ${formatDateTime(item.createdAt)}</span>
        </div>
        <span class="mastery-badge ${item.mastered ? "mastered" : ""}">${item.mastered ? "已掌握" : "未掌握"}</span>
      </div>
      <div class="wrong-content">
        <p><strong>题目：</strong>${escapeHtml(item.questionContent)}</p>
        <p><strong>你的答案：</strong>${escapeHtml(item.userAnswer)}</p>
        <p><strong>正确/参考答案：</strong>${escapeHtml(item.correctAnswer)}</p>
        <p><strong>错误原因：</strong>${escapeHtml(item.errorReason || "未记录")}</p>
        <p><strong>AI 解析：</strong>${escapeHtml(item.aiExplanation || "未记录")}</p>
      </div>
      <div class="wrong-meta">
        <span>复习次数：${Number(item.reviewCount || 0)}</span>
        <span>最近复习：${formatDateTime(item.lastReviewedAt)}</span>
      </div>
      <div class="card-actions">
        <button class="secondary-button" data-ask-wrong="${item.id}" type="button">问 AI</button>
        <button class="secondary-button" data-review-wrong="${item.id}" type="button">重新练习</button>
        <button class="secondary-button" data-toggle-mastered="${item.id}" type="button">${item.mastered ? "标记未掌握" : "标记已掌握"}</button>
        <button class="danger-button" data-delete-wrong="${item.id}" type="button">删除</button>
      </div>
    </article>
  `;
}

async function analyzeWeakness(filters, allWrongItems, noteMap) {
  if (filters.noteId === "all") {
    showToast("请先在筛选器中选择一份笔记", "error");
    return;
  }

  const note = noteMap.get(filters.noteId);
  const wrongItems = allWrongItems.filter((item) => item.noteId === filters.noteId && !item.mastered);
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
    await put("wrongItems", {
      ...item,
      reviewCount: Number(item.reviewCount || 0) + 1,
      lastReviewedAt: nowIso(),
      mastered: isCorrect ? true : item.mastered
    });
    await recordWrongReview(isCorrect);
    status.textContent = isCorrect
      ? "回答正确，已标记为掌握。"
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
      const mastered = gradeResult.isCorrect && gradeResult.score >= 70;
      await put("wrongItems", {
        ...item,
        reviewCount: Number(item.reviewCount || 0) + 1,
        lastReviewedAt: nowIso(),
        mastered: mastered ? true : item.mastered
      });
      await recordWrongReview(mastered);
      await app.refresh();
      elapsedTimer.stop();
      status.innerHTML = renderSubjectiveReviewResult(gradeResult, mastered);
      await typesetMath(status);
      button.textContent = "本次复习已记录";
      showToast(mastered ? "复习通过" : "复习未通过", mastered ? "success" : "error");
      status.querySelector("[data-close-review-result]")?.addEventListener("click", () => modal.close());
    } catch (error) {
      elapsedTimer.stop();
      status.textContent = `判题失败：${error.message}`;
      button.disabled = false;
      showToast(error.message, "error");
    }
  });
}

function renderSubjectiveReviewResult(gradeResult, mastered) {
  return `
    <div class="review-result ${mastered ? "correct" : "wrong"}">
      <strong>${mastered ? "复习通过，已标记掌握。" : "还需要继续复习。"}</strong>
      <p><strong>得分：</strong>${Number(gradeResult.score || 0)} / 100</p>
      ${gradeResult.recognizedAnswer ? `<p><strong>识别出的答案：</strong>${escapeHtml(gradeResult.recognizedAnswer)}</p>` : ""}
      <p><strong>判定理由：</strong>${escapeHtml(gradeResult.reason || "暂无理由")}</p>
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

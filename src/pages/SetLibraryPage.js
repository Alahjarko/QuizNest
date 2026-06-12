import { confirmAction, openModal } from "../components/Modal.js";
import { showToast } from "../components/Toast.js";
import { get, getAll, getByIndex, put, remove, removeMany } from "../services/storage/db.js";
import { formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml } from "../utils/markdown.js";
import { buildAnswerMap, metricText, sortSetsByActivity, summarizeQuestionSet } from "../utils/practice.js";

export async function renderSetLibraryPage(container, app) {
  app.setContext({ contextKey: "set-library" });
  const { summaries, detailBySetId } = await loadSetSummaries();

  container.innerHTML = `
    <section class="page-header hero-panel">
      <div>
        <p class="eyebrow">练习记录</p>
        <h1>题组库</h1>
        <p>集中管理所有生成过的套题。继续练习、查看结果、重命名或重新开始，都在这里完成。</p>
      </div>
      <div class="page-actions">
        <button class="secondary-button" data-nav="/" type="button">返回首页</button>
      </div>
    </section>

    <section class="stats-grid compact-stats">
      <div><strong>${summaries.length}</strong><span>题组总数</span></div>
      <div><strong>${summaries.filter((item) => item.status === "completed").length}</strong><span>已完成</span></div>
      <div><strong>${summaries.filter((item) => item.status === "in_progress").length}</strong><span>进行中</span></div>
    </section>

    <section class="set-library-list">
      ${
        summaries.length
          ? summaries.map((summary) => renderSetCard(summary)).join("")
          : `<div class="empty-state">还没有题组。先进入某份笔记生成练习。</div>`
      }
    </section>
  `;

  container.querySelector("[data-nav]")?.addEventListener("click", () => app.navigate("/"));

  container.querySelectorAll("[data-continue-set]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/practice/${button.dataset.continueSet}`));
  });

  container.querySelectorAll("[data-result-set]").forEach((button) => {
    button.addEventListener("click", () => {
      const detail = detailBySetId.get(button.dataset.resultSet);
      openResultModal(detail);
    });
  });

  container.querySelectorAll("[data-rename-set]").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = detailBySetId.get(button.dataset.renameSet);
      if (!detail) return;
      openRenameModal(detail.set, app);
    });
  });

  container.querySelectorAll("[data-restart-set]").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = detailBySetId.get(button.dataset.restartSet);
      if (!detail) return;
      if (!confirmAction("确定重新练习这套题？当前答题进度会清空，题目本身和错题本记录会保留。")) return;
      await restartSet(detail.set);
      showToast("已清空这套题的答题进度", "success");
      app.navigate(`/practice/${detail.set.id}`);
    });
  });

  container.querySelectorAll("[data-delete-set]").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = detailBySetId.get(button.dataset.deleteSet);
      if (!detail) return;
      if (!confirmAction("确定删除这套题？题目、答题记录和关联错题记录都会删除。")) return;
      await deleteSet(detail.set.id);
      showToast("题组已删除", "success");
      app.refresh();
    });
  });
}

async function loadSetSummaries() {
  const [sets, notes, questions, answers, wrongItems] = await Promise.all([
    getAll("questionSets"),
    getAll("notes"),
    getAll("questions"),
    getAll("answers"),
    getAll("wrongItems")
  ]);
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const detailBySetId = new Map();

  sets.forEach((set) => {
    const setQuestions = questions.filter((question) => question.setId === set.id).sort((a, b) => a.order - b.order);
    const setAnswers = answers.filter((answer) => answer.setId === set.id);
    const setWrongItems = wrongItems.filter((item) => item.setId === set.id);
    const note = noteMap.get(set.noteId);
    const summary = summarizeQuestionSet({ set, note, questions: setQuestions, answers: setAnswers });
    detailBySetId.set(set.id, {
      set,
      note,
      questions: setQuestions,
      answers: setAnswers,
      wrongItems: setWrongItems,
      summary
    });
  });

  return {
    summaries: sortSetsByActivity([...detailBySetId.values()].map((detail) => detail.summary)),
    detailBySetId
  };
}

function renderSetCard(summary) {
  return `
    <article class="set-card">
      <div class="set-card-main">
        <div class="set-title-row">
          <h2>${escapeHtml(summary.title)}</h2>
          <span class="status-pill ${summary.status}">${summary.statusLabel}</span>
        </div>
        <p>${escapeHtml(summary.noteTitle)}</p>
        <div class="set-meta-grid">
          <span>选择题 ${summary.choiceCount}</span>
          <span>大题 ${summary.subjectiveCount}</span>
          <span>${escapeHtml(summary.difficulty)}</span>
          <span>创建：${formatDateTime(summary.createdAt)}</span>
          <span>最近练习：${formatDateTime(summary.lastPracticeAt)}</span>
          <span>${metricText(summary)}</span>
        </div>
      </div>
      <div class="card-actions set-actions">
        <button class="primary-button" data-continue-set="${summary.id}" type="button">继续练习</button>
        <button class="secondary-button" data-result-set="${summary.id}" type="button">查看结果</button>
        <button class="secondary-button" data-rename-set="${summary.id}" type="button">重命名</button>
        <button class="secondary-button" data-restart-set="${summary.id}" type="button">重新练习</button>
        <button class="danger-button" data-delete-set="${summary.id}" type="button">删除</button>
      </div>
    </article>
  `;
}

function openRenameModal(set, app) {
  const content = document.createElement("form");
  content.className = "rename-form";
  content.innerHTML = `
    <label>
      <span>题组名称</span>
      <input name="title" required maxlength="80" value="${escapeHtml(set.title || "")}" />
    </label>
    <div class="form-actions">
      <button class="primary-button" type="submit">保存名称</button>
    </div>
  `;
  const modal = openModal({ title: "重命名题组", content, width: "480px" });
  content.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = String(new FormData(content).get("title") || "").trim();
    if (!title) {
      showToast("题组名称不能为空", "error");
      return;
    }
    await put("questionSets", { ...set, title, updatedAt: nowIso() });
    showToast("题组已重命名", "success");
    modal.close();
    app.refresh();
  });
}

function openResultModal(detail) {
  if (!detail) return;
  const answerMap = buildAnswerMap(detail.answers);
  const rows = detail.questions.map((question) => {
    const answer = answerMap.get(question.id);
    const answerText =
      question.type === "choice"
        ? answer?.selectedOption || "未作答"
        : answer?.textAnswer || answer?.imageName || "未作答";
    const scoreText = answer?.submitted ? `${Number(answer.score || 0)} 分` : "未提交";
    return `
      <tr>
        <td>第 ${question.order} 题</td>
        <td>${question.type === "choice" ? "选择题" : `大题 · ${subjectiveTypeLabel(question.questionType)}`}</td>
        <td>${escapeHtml(answerText)}</td>
        <td>${answer?.submitted ? (answer.isCorrect ? "正确" : "需订正") : "未完成"}</td>
        <td>${scoreText}</td>
      </tr>
    `;
  });

  openModal({
    title: `${detail.summary.title} · 结果`,
    width: "820px",
    content: `
      <div class="result-summary">
        <div><strong>${detail.summary.submitted}</strong><span>已提交 / ${detail.summary.total}</span></div>
        <div><strong>${detail.summary.accuracy ?? "--"}%</strong><span>正确率</span></div>
        <div><strong>${detail.summary.averageScore ?? "--"}</strong><span>平均分</span></div>
        <div><strong>${detail.wrongItems.length}</strong><span>关联错题</span></div>
      </div>
      <div class="table-wrap">
        <table class="result-table">
          <thead>
            <tr><th>题号</th><th>题型</th><th>你的答案</th><th>状态</th><th>得分</th></tr>
          </thead>
          <tbody>${rows.join("") || `<tr><td colspan="5">暂无题目</td></tr>`}</tbody>
        </table>
      </div>
    `
  });
}

function subjectiveTypeLabel(type) {
  return (
    {
      short_answer: "简答题",
      proof: "证明题",
      calculation: "计算题"
    }[type] || "未标注"
  );
}

async function restartSet(set) {
  const answers = await getByIndex("answers", "setId", set.id);
  await removeMany("answers", answers.map((answer) => answer.id));
  localStorage.removeItem(`practice:${set.id}:currentIndex`);
  await put("questionSets", { ...set, lastPracticeAt: nowIso(), updatedAt: nowIso() });
}

async function deleteSet(setId) {
  const [questions, answers, wrongItems] = await Promise.all([
    getByIndex("questions", "setId", setId),
    getByIndex("answers", "setId", setId),
    getAll("wrongItems")
  ]);
  const relatedWrongItems = wrongItems.filter((item) => item.setId === setId);
  await removeMany("questions", questions.map((question) => question.id));
  await removeMany("answers", answers.map((answer) => answer.id));
  await removeMany("wrongItems", relatedWrongItems.map((item) => item.id));
  await remove("questionSets", setId);
  localStorage.removeItem(`practice:${setId}:currentIndex`);
}

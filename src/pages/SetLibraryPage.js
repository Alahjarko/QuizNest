import { confirmAction, openModal } from "../components/Modal.js";
import { bindOverflowMenus, renderOverflowMenu } from "../components/OverflowMenu.js";
import { showToast } from "../components/Toast.js";
import { get, getAll, getByIndex, put, remove, removeMany } from "../services/storage/db.js";
import { formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml } from "../utils/markdown.js";
import { buildAnswerMap, metricText, sortSetsByActivity, summarizeQuestionSet } from "../utils/practice.js";

export async function renderSetLibraryPage(container, app) {
  app.setContext({ contextKey: "set-library" });
  const { summaries, detailBySetId } = await loadSetSummaries();
  const counts = {
    all: summaries.length,
    inProgress: summaries.filter((item) => item.status === "in_progress").length,
    completed: summaries.filter((item) => item.status === "completed").length,
    review: summaries.filter((item) => item.reviewRecommended).length
  };

  container.innerHTML = `
    <section class="archive-page-header">
      <div>
        <p class="page-kicker">Problem Sets</p>
        <h1>题组库</h1>
        <p>管理所有练习题组，继续练习、查看结果或安排复习。</p>
      </div>
      <div class="page-actions">
        <button class="primary-button" data-create-set type="button">从笔记生成题组</button>
      </div>
    </section>

    <section class="archive-summary" aria-label="题组概览">
      ${renderArchiveMetric(counts.all, "全部题组")}
      ${renderArchiveMetric(counts.inProgress, "进行中")}
      ${renderArchiveMetric(counts.completed, "已完成")}
      ${renderArchiveMetric(counts.review, "建议复习", "review")}
    </section>

    <section class="archive-toolbar" aria-label="题组筛选">
      <label class="archive-search">
        <span class="sr-only">搜索题组</span>
        <svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
        <input data-set-search type="search" placeholder="搜索题组或所属笔记" autocomplete="off" />
      </label>
      <div class="archive-filter-tabs" role="group" aria-label="按状态筛选">
        <button class="active" data-set-filter="all" type="button">全部</button>
        <button data-set-filter="in_progress" type="button">进行中</button>
        <button data-set-filter="completed" type="button">已完成</button>
        <button data-set-filter="review" type="button">建议复习</button>
      </div>
    </section>

    <section class="set-library-list" data-set-list>
      ${
        summaries.length
          ? summaries.map((summary) => renderSetCard(summary)).join("")
          : renderSetEmptyState()
      }
    </section>
    <div class="empty-state archive-filter-empty" data-set-filter-empty hidden>没有符合当前条件的题组。</div>
  `;

  container.querySelector("[data-create-set]")?.addEventListener("click", () => openCreateSetModal(app));
  bindOverflowMenus(container);

  bindSetFilters(container);

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
      if (!(await confirmAction("确定重新练习这套题？当前答题进度会清空，题目本身和错题本记录会保留。"))) return;
      await restartSet(detail.set);
      showToast("已清空这套题的答题进度", "success");
      app.navigate(`/practice/${detail.set.id}`);
    });
  });

  container.querySelectorAll("[data-delete-set]").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = detailBySetId.get(button.dataset.deleteSet);
      if (!detail) return;
      if (!(await confirmAction("确定删除这套题？题目、答题记录和关联错题记录都会删除。"))) return;
      await deleteSet(detail.set.id);
      showToast("题组已删除", "success");
      app.refresh();
    });
  });

  container.querySelectorAll("[data-review-set]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/wrong?setId=${encodeURIComponent(button.dataset.reviewSet)}`));
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
    const baseSummary = summarizeQuestionSet({ set, note, questions: setQuestions, answers: setAnswers });
    const openWrongCount = setWrongItems.filter((item) => !item.mastered).length;
    const summary = {
      ...baseSummary,
      openWrongCount,
      reviewRecommended:
        baseSummary.status === "completed" &&
        (openWrongCount > 0 || (baseSummary.accuracy !== null && baseSummary.accuracy < 80))
    };
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
  const primaryAction = summary.reviewRecommended && summary.openWrongCount > 0
    ? `<button class="primary-button review-action" data-review-set="${summary.id}" type="button">复习错题</button>`
    : summary.status === "completed"
      ? `<button class="primary-button" data-result-set="${summary.id}" type="button">查看结果</button>`
      : `<button class="primary-button" data-continue-set="${summary.id}" type="button">${summary.status === "in_progress" ? "继续练习" : "开始练习"}</button>`;
  const menuItems = [
    summary.status !== "completed" && summary.submitted
      ? `<button data-result-set="${summary.id}" role="menuitem" type="button">查看当前结果</button>`
      : "",
    `<button data-rename-set="${summary.id}" role="menuitem" type="button">重命名</button>`,
    summary.status !== "not_started"
      ? `<button data-restart-set="${summary.id}" role="menuitem" type="button">重新练习</button>`
      : "",
    `<button class="danger-menu-item" data-delete-set="${summary.id}" role="menuitem" type="button">删除题组</button>`
  ].join("");

  const statusKey = summary.reviewRecommended ? "review" : summary.status;
  const statusLabel = summary.reviewRecommended ? "建议复习" : summary.statusLabel;
  const progress = summary.total ? Math.round((summary.submitted / summary.total) * 100) : 0;
  const searchText = `${summary.title} ${summary.noteTitle}`.toLocaleLowerCase();

  return `
    <article class="problem-set-card" data-set-card data-status="${statusKey}" data-search="${escapeHtml(searchText)}">
      <div class="problem-set-marker" aria-hidden="true">${escapeHtml(getNoteMarker(summary.noteTitle))}</div>
      <div class="problem-set-content">
        <div class="problem-set-heading">
          <div>
            <p class="problem-set-note">${escapeHtml(summary.noteTitle)}</p>
            <h2>${escapeHtml(summary.title)}</h2>
          </div>
          <span class="status-pill ${statusKey}">${statusLabel}</span>
        </div>
        <div class="problem-set-tags" aria-label="题组构成">
          <span>${summary.total} 题</span>
          <span>选择题 ${summary.choiceCount}</span>
          <span>大题 ${summary.subjectiveCount}</span>
          <span>${escapeHtml(summary.difficulty)}</span>
        </div>
        <div class="problem-set-footnote">
          <span>最近练习 ${summary.lastPracticeAt ? formatDateTime(summary.lastPracticeAt) : "尚未开始"}</span>
          ${summary.openWrongCount ? `<span class="review-note">${summary.openWrongCount} 道错题待掌握</span>` : ""}
        </div>
      </div>
      <div class="problem-set-metrics">
        <div class="progress-ring" style="--progress: ${progress}" aria-label="练习进度 ${progress}%">
          <strong>${progress}%</strong>
          <span>进度</span>
        </div>
        <div class="problem-set-accuracy">
          <span>正确率</span>
          <strong>${summary.accuracy === null ? "--" : `${summary.accuracy}%`}</strong>
        </div>
      </div>
      <div class="problem-set-actions">
        ${primaryAction}
        ${renderOverflowMenu({ label: `${escapeHtml(summary.title)}的更多操作`, items: menuItems })}
      </div>
    </article>
  `;
}

function renderArchiveMetric(value, label, tone = "") {
  return `<div class="archive-metric ${tone}"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderSetEmptyState() {
  return `
    <div class="empty-state archive-empty-state">
      <p class="page-kicker">No Problem Sets</p>
      <h2>还没有题组</h2>
      <p>从一份已有笔记生成练习，题组会在这里形成持续可追踪的学习档案。</p>
    </div>
  `;
}

function getNoteMarker(title = "") {
  const trimmed = String(title).trim();
  return trimmed ? [...trimmed][0].toLocaleUpperCase() : "Q";
}

function bindSetFilters(container) {
  const search = container.querySelector("[data-set-search]");
  const filters = [...container.querySelectorAll("[data-set-filter]")];
  const cards = [...container.querySelectorAll("[data-set-card]")];
  const empty = container.querySelector("[data-set-filter-empty]");
  let currentFilter = "all";

  const applyFilters = () => {
    const query = String(search?.value || "").trim().toLocaleLowerCase();
    let visibleCount = 0;
    cards.forEach((card) => {
      const matchesFilter =
        currentFilter === "all" ||
        card.dataset.status === currentFilter ||
        (currentFilter === "completed" && card.dataset.status === "review");
      const matchesSearch = !query || card.dataset.search.includes(query);
      const visible = matchesFilter && matchesSearch;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    if (empty) empty.hidden = visibleCount > 0 || cards.length === 0;
  };

  search?.addEventListener("input", applyFilters);
  filters.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.setFilter;
      filters.forEach((item) => item.classList.toggle("active", item === button));
      applyFilters();
    });
  });
}

async function openCreateSetModal(app) {
  const notes = await getAll("notes");
  const content = document.createElement("div");
  content.className = "create-set-picker";
  content.innerHTML = notes.length
    ? `
      <p>选择一份笔记，继续设置题型、难度和题量。</p>
      <div class="create-set-note-list">
        ${notes
          .map(
            (note) => `
              <button data-create-from-note="${note.id}" type="button">
                <span>${escapeHtml(note.title || note.fileName || "未命名笔记")}</span>
                <small>${escapeHtml(note.fileName || "Markdown 笔记")}</small>
              </button>
            `
          )
          .join("")}
      </div>
    `
    : `<div class="empty-state">暂无可用笔记，请先导入或创建一份笔记。</div>`;
  const modal = openModal({ title: "从笔记生成题组", content, width: "620px" });
  content.querySelectorAll("[data-create-from-note]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.close();
      app.navigate(`/note/${button.dataset.createFromNote}?generate=1`);
    });
  });
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

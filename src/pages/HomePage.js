import { openModal } from "../components/Modal.js";
import { showToast } from "../components/Toast.js";
import { APP_DESCRIPTION, APP_NAME } from "../config/appMeta.js";
import { getAll, getSettings, put } from "../services/storage/db.js";
import { getProfile } from "../services/profile.js";
import { getDueReviewQueue } from "../services/reviewScheduler.js";
import { formatDuration, getStudyDashboard } from "../services/studyTracker.js";
import { createId, nowIso } from "../utils/ids.js";
import { readTextFile } from "../utils/file.js";
import { escapeHtml, getNoteTitle, parseMarkdownSections } from "../utils/markdown.js";
import { metricText, sortSetsByActivity, summarizeQuestionSet } from "../utils/practice.js";

export async function renderHomePage(container, app) {
  app.setContext({ contextKey: "home" });
  const notes = (await getAll("notes")).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const notebooks = (await getAll("notebooks")).sort((a, b) =>
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  );
  const sets = await getAll("questionSets");
  const questions = await getAll("questions");
  const answers = await getAll("answers");
  const wrongItems = await getAll("wrongItems");
  const [settings, study, profile, dueReviewQueue] = await Promise.all([
    getSettings(),
    getStudyDashboard(),
    getProfile(),
    getDueReviewQueue()
  ]);
  const openWrongCount = wrongItems.filter((item) => !item.mastered).length;
  const totalStudySets = sets.length;
  const generatedQuestions = questions.length;
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const notebookMap = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const recentSets = sortSetsByActivity(
    sets.map((set) =>
      summarizeQuestionSet({
        set,
        note: noteMap.get(set.noteId),
        questions: questions.filter((question) => question.setId === set.id),
        answers: answers.filter((answer) => answer.setId === set.id)
      })
    )
  ).slice(0, 5);
  const currentSet = recentSets.find((item) => item.status === "in_progress") || recentSets[0];
  const reviewSet = recentSets.find((item) => {
    const openForSet = wrongItems.filter((wrongItem) => wrongItem.setId === item.id && !wrongItem.mastered).length;
    return openForSet > 0 || (item.status === "completed" && item.accuracy !== null && item.accuracy < 80);
  });
  const weakSection = getWeakestSection(wrongItems);
  const recentNotes = notes.slice(0, 4);

  container.innerHTML = `
    <section class="study-desk-hero">
      <div class="study-desk-intro">
        <p class="page-kicker">QuizNest Study Desk</p>
        <h1>今天，从上次停下的地方继续。</h1>
        <p>${APP_DESCRIPTION} 学习记录与个人资料只保存在本机。</p>
        <div class="study-desk-actions">
          <label class="primary-button file-button">
            上传 Markdown 笔记
            <input type="file" accept=".md,text/markdown,text/plain" data-upload-note hidden />
          </label>
          <button class="secondary-button" data-open-notebooks type="button">打开笔记本</button>
        </div>
      </div>
      <aside class="study-cover ${settings.homeHeroImageDataUrl ? "has-image" : ""}" data-home-cover aria-label="个人学习封面">
        <div class="study-cover-overlay"></div>
        <div class="study-cover-content">
          <span>${escapeHtml(profile.displayName || APP_NAME)}</span>
          <strong>${study.today.checkedIn ? "今日学习已开始" : "准备好今天的学习"}</strong>
          <small>${formatDuration(study.today.studyMs)} 学习时长</small>
        </div>
      </aside>
    </section>

    <section class="today-strip" aria-label="今日学习状态">
      <div><span>今日练习</span><strong>${study.today.practicedQuestions || 0} 题</strong></div>
      <div><span>今日正确率</span><strong>${todayAccuracy(study.today)}</strong></div>
      <div><span>今日学习</span><strong>${formatDuration(study.today.studyMs)}</strong></div>
      <div><span>连续学习</span><strong>${study.streak} 天</strong></div>
      <div><span>今日待复习</span><strong>${dueReviewQueue.length}</strong></div>
    </section>

    <section class="home-section-heading">
      <div><h2>接下来做什么</h2><p>根据最近练习和未掌握错题，继续当前学习路径。</p></div>
    </section>

    <section class="home-action-board">
      <button class="home-action-primary" data-open-set="${currentSet?.id || ""}" type="button" ${currentSet ? "" : "disabled"}>
        <span>继续上次练习</span>
        <strong>${currentSet ? escapeHtml(currentSet.title) : "还没有可继续的题组"}</strong>
        <small>${currentSet ? `${currentSet.submitted} / ${currentSet.total} 已完成` : "先从一份笔记生成题组"}</small>
      </button>
      <div class="home-action-secondary">
        <button data-review-wrong type="button" ${dueReviewQueue.length ? "" : "disabled"}>
          <span>完成今日复习计划</span><strong>${dueReviewQueue.length} 道</strong>
        </button>
        <button data-generate-new type="button" ${notes.length ? "" : "disabled"}>
          <span>从笔记生成题组</span><strong>${notes.length} 份笔记</strong>
        </button>
        <button data-open-chat type="button">
          <span>进入解惑</span><strong>${weakSection ? escapeHtml(weakSection.section) : "带着上下文提问"}</strong>
        </button>
      </div>
    </section>

    <section class="home-study-grid">
      <div class="home-study-column">
        <div class="home-section-heading compact-heading">
          <div><h2>最近练习</h2><p>按最近活动排序。</p></div>
          <button class="text-button" data-open-sets type="button">查看全部</button>
        </div>
        <div class="home-practice-list">
        ${
          recentSets.length
            ? recentSets
                .slice(0, 4)
                .map(
                  (summary) => `
                    <article class="home-practice-row">
                      <div class="home-practice-copy">
                        <span>${escapeHtml(summary.noteTitle)}</span>
                        <h3>${escapeHtml(summary.title)}</h3>
                        <small>${summary.submitted} / ${summary.total} 已完成，${metricText(summary)}</small>
                      </div>
                      <div class="home-practice-side">
                        <span class="status-pill ${summary.status}">${summary.statusLabel}</span>
                        <button class="secondary-button" data-open-set="${summary.id}" type="button">${summary.status === "completed" ? "查看练习" : "继续练习"}</button>
                      </div>
                    </article>`
                )
                .join("")
            : `<div class="empty-state compact">还没有题组。上传笔记后生成一套练习，就会出现在这里。</div>`
        }
        </div>
      </div>
      <aside class="home-insight-column">
        <div class="home-section-heading compact-heading"><div><h2>今日建议</h2><p>由本地学习记录生成。</p></div></div>
        <div class="home-insight-list">
          <article class="review-insight">
            <span>今日复习计划</span>
            <strong>${dueReviewQueue.length ? `${dueReviewQueue.length} 道到期错题` : "今天没有到期任务"}</strong>
            <small>${dueReviewQueue.length ? "按记忆稳定度和历史复习表现安排" : "新的错误会自动进入间隔复习"}</small>
          </article>
          <article>
            <span>建议复习</span>
            <strong>${reviewSet ? escapeHtml(reviewSet.title) : "当前没有紧急复习项"}</strong>
            <small>${reviewSet ? metricText(reviewSet) : "保持当前学习节奏"}</small>
          </article>
          <article>
            <span>累计学习</span>
            <strong>${formatDuration(study.totalMs)}</strong>
            <small>${totalStudySets} 套题，${generatedQuestions} 道题目</small>
          </article>
        </div>
      </aside>
    </section>

    <section class="home-section-heading notes-heading">
      <div><h2>近期笔记</h2><p>继续阅读或从笔记开始新的练习。</p></div>
      <button class="text-button" data-open-notebooks type="button">管理笔记本</button>
    </section>

    <section class="home-note-shelf">
      ${
        recentNotes.length
          ? recentNotes
              .map((note) => {
                const noteSets = sets.filter((set) => set.noteId === note.id).length;
                const noteWrong = wrongItems.filter((item) => item.noteId === note.id && !item.mastered).length;
                const notebookTitle = note.notebookId && notebookMap.has(note.notebookId) ? notebookMap.get(note.notebookId).title : "未归档";
                return `
                  <article class="home-note-item">
                    <button class="home-note-title" data-open-note="${note.id}" type="button">
                      <span>${escapeHtml(notebookTitle)}</span>
                      <strong>${escapeHtml(note.title)}</strong>
                      <small>${note.sections?.length || 1} 个章节，${noteSets} 套题，${noteWrong} 道待掌握错题</small>
                    </button>
                    <button class="secondary-button" data-generate-note="${note.id}" type="button">生成练习</button>
                  </article>`;
              })
              .join("")
          : `<div class="empty-state">还没有笔记。上传一个 Markdown 文件开始学习。</div>`
      }
    </section>
  `;

  applyHomeCoverBackground(container, settings.homeHeroImageDataUrl);

  container.querySelector("[data-upload-note]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.md$/i.test(file.name)) {
      showToast("请上传 .md 文件", "error");
      return;
    }

    try {
      const content = await readTextFile(file);
      const note = {
        id: createId("note"),
        title: getNoteTitle(file.name, content),
        fileName: file.name,
        content,
        sections: parseMarkdownSections(content),
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await put("notes", note);
      showToast("笔记已保存，正在打开生成设置", "success");
      app.navigate(`/note/${note.id}?generate=1`);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  container.querySelectorAll("[data-open-sets]").forEach((button) => {
    button.addEventListener("click", () => app.navigate("/sets"));
  });

  container.querySelector("[data-open-notebooks]")?.addEventListener("click", () => app.navigate("/notebooks"));

  container.querySelectorAll("[data-open-note]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/note/${button.dataset.openNote}`));
  });

  container.querySelectorAll("[data-open-set]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/practice/${button.dataset.openSet}`));
  });

  container.querySelectorAll("[data-generate-note]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/note/${button.dataset.generateNote}?generate=1`));
  });

  container.querySelector("[data-review-wrong]")?.addEventListener("click", () => app.navigate("/wrong?status=due"));
  container.querySelector("[data-generate-new]")?.addEventListener("click", () => openNoteGeneratorPicker(notes, app));
  container.querySelector("[data-open-chat]")?.addEventListener("click", () => app.navigate("/chat"));
}

function openNoteGeneratorPicker(notes, app) {
  const modal = openModal({
    title: "选择一份笔记",
    content: `
      <div class="home-note-picker">
        <p>QuizNest 将根据笔记章节生成新的练习题组。</p>
        <div class="home-note-picker-list">
          ${notes
            .map(
              (note) => `
                <button type="button" data-pick-note="${note.id}">
                  <strong>${escapeHtml(note.title || "未命名笔记")}</strong>
                  <small>${note.sections?.length || 1} 个章节</small>
                </button>`
            )
            .join("")}
        </div>
      </div>`,
    width: "600px"
  });

  modal.body.querySelectorAll("[data-pick-note]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.close();
      app.navigate(`/note/${button.dataset.pickNote}?generate=1`);
    });
  });
}

function applyHomeCoverBackground(container, dataUrl) {
  const cover = container.querySelector("[data-home-cover]");
  if (!cover || !dataUrl) return;
  cover.style.setProperty("--study-cover-bg", `url("${String(dataUrl).replaceAll('"', '\\"')}")`);
}

function getWeakestSection(wrongItems) {
  const sections = new Map();
  wrongItems
    .filter((item) => !item.mastered)
    .forEach((item) => {
      const section = String(item.section || item.sectionTitle || "未归类知识点").trim();
      sections.set(section, (sections.get(section) || 0) + 1);
    });
  return [...sections.entries()]
    .map(([section, count]) => ({ section, count }))
    .sort((a, b) => b.count - a.count || a.section.localeCompare(b.section, "zh-CN"))[0];
}

function todayAccuracy(today) {
  const submitted = Number(today.submittedAnswers || 0);
  if (!submitted) return "--";
  return `${Math.round((Number(today.correctAnswers || 0) / submitted) * 100)}%`;
}

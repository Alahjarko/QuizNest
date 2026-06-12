import { confirmAction } from "../components/Modal.js";
import { showToast } from "../components/Toast.js";
import { APP_DESCRIPTION, APP_NAME } from "../config/appMeta.js";
import { getAll, put, remove } from "../services/storage/db.js";
import { formatDuration, getStudyDashboard } from "../services/studyTracker.js";
import { createId, formatDateTime, nowIso } from "../utils/ids.js";
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
  const study = await getStudyDashboard();
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

  container.innerHTML = `
    <section class="page-header home-hero">
      <div class="home-hero-copy">
        <p class="eyebrow">${APP_NAME} Workspace</p>
        <h1>${APP_NAME}</h1>
        <p>${APP_DESCRIPTION} 所有学习记录默认保存在本机，适合长期维护自己的课程知识库。</p>
        <div class="hero-meta-row" aria-label="产品能力">
          <span>Markdown 笔记</span>
          <span>本地数据</span>
          <span>AI 出题与判题</span>
        </div>
        <div class="page-actions">
          <label class="primary-button file-button">
            上传 .md 笔记
            <input type="file" accept=".md,text/markdown,text/plain" data-upload-note hidden />
          </label>
          <button class="secondary-button" data-open-sets type="button">打开题组库</button>
        </div>
      </div>
      <aside class="home-hero-card" aria-label="今日概览">
        <div>
          <span>今日练习</span>
          <strong>${study.today.practicedQuestions || 0}</strong>
        </div>
        <div>
          <span>今日正确率</span>
          <strong>${todayAccuracy(study.today)}</strong>
        </div>
        <div>
          <span>待复习错题</span>
          <strong>${openWrongCount}</strong>
        </div>
      </aside>
    </section>

    <section class="stats-grid product-stats">
      <div><strong>${notes.length}</strong><span>笔记</span></div>
      <div><strong>${notebooks.length}</strong><span>笔记本</span></div>
      <div><strong>${totalStudySets}</strong><span>练习套题</span></div>
      <div><strong>${generatedQuestions}</strong><span>已生成题目</span></div>
      <div><strong>${openWrongCount}</strong><span>未掌握错题</span></div>
    </section>

    <section class="study-dashboard">
      <div class="section-heading">
        <div>
          <p class="eyebrow">学习状态</p>
          <h2>今日学习</h2>
        </div>
        <span class="status-pill ${study.today.checkedIn ? "completed" : "not_started"}">${study.today.checkedIn ? "今日已签到" : "今日未签到"}</span>
      </div>
      <div class="study-grid">
        <div><strong>${study.today.practicedQuestions || 0}</strong><span>今日练习题数</span></div>
        <div><strong>${todayAccuracy(study.today)}</strong><span>今日正确率</span></div>
        <div><strong>${formatDuration(study.today.studyMs)}</strong><span>今日学习时长</span></div>
        <div><strong>${study.streak}</strong><span>连续签到天数</span></div>
        <div><strong>${formatDuration(study.totalMs)}</strong><span>累计学习时长</span></div>
      </div>
    </section>

    <section class="recent-practice">
      <div class="section-heading">
        <div>
          <p class="eyebrow">继续刷题</p>
          <h2>最近练习</h2>
        </div>
        <button class="secondary-button" data-open-sets type="button">查看全部</button>
      </div>
      <div class="recent-set-grid">
        ${
          recentSets.length
            ? recentSets
                .map(
                  (summary) => `
                    <article class="mini-set-card">
                      <div class="set-title-row">
                        <h3>${escapeHtml(summary.title)}</h3>
                        <span class="status-pill ${summary.status}">${summary.statusLabel}</span>
                      </div>
                      <p>${escapeHtml(summary.noteTitle)}</p>
                      <div class="tag-row">
                        <span>选择 ${summary.choiceCount}</span>
                        <span>大题 ${summary.subjectiveCount}</span>
                        <span>${escapeHtml(summary.difficulty)}</span>
                      </div>
                      <div class="mini-set-footer">
                        <span>${metricText(summary)}</span>
                        <small>最近：${formatDateTime(summary.lastPracticeAt || summary.createdAt)}</small>
                      </div>
                      <button class="primary-button" data-open-set="${summary.id}" type="button">继续练习</button>
                    </article>`
                )
                .join("")
            : `<div class="empty-state compact">还没有题组。上传笔记后生成一套练习，就会出现在这里。</div>`
        }
      </div>
    </section>

    <section class="section-heading notes-heading">
      <div>
        <p class="eyebrow">知识库</p>
        <h2>笔记档案</h2>
      </div>
      <button class="secondary-button" data-open-notebooks type="button">管理笔记本</button>
    </section>

    <section class="note-list">
      ${
        notes.length
          ? notes
              .map((note) => {
                const noteSets = sets.filter((set) => set.noteId === note.id).length;
                const noteWrong = wrongItems.filter((item) => item.noteId === note.id && !item.mastered).length;
                const notebookTitle = note.notebookId && notebookMap.has(note.notebookId) ? notebookMap.get(note.notebookId).title : "未归档";
                return `
                  <article class="note-card">
                    <div>
                      <h2>${escapeHtml(note.title)}</h2>
                      <p>${escapeHtml(note.fileName)} · ${note.sections?.length || 1} 个章节 · ${formatDateTime(note.createdAt)}</p>
                      <div class="tag-row">
                        <span>${escapeHtml(notebookTitle)}</span>
                        <span>${noteSets} 套题</span>
                        <span>${noteWrong} 道未掌握错题</span>
                      </div>
                    </div>
                    <div class="card-actions">
                      <button class="secondary-button" data-open-note="${note.id}" type="button">阅读</button>
                      <button class="secondary-button" data-generate-note="${note.id}" type="button">生成练习</button>
                      <button class="danger-button" data-delete-note="${note.id}" type="button">删除</button>
                    </div>
                  </article>`;
              })
              .join("")
          : `<div class="empty-state">还没有笔记。先上传一个 .md 文件开始。</div>`
      }
    </section>
  `;

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

  container.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirmAction("确定删除这份笔记？相关题目和错题不会自动删除。")) return;
      await remove("notes", button.dataset.deleteNote);
      showToast("笔记已删除", "success");
      app.refresh();
    });
  });
}

function todayAccuracy(today) {
  const submitted = Number(today.submittedAnswers || 0);
  if (!submitted) return "--";
  return `${Math.round((Number(today.correctAnswers || 0) / submitted) * 100)}%`;
}

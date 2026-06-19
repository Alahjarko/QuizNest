import { openModal } from "../components/Modal.js";
import { showToast } from "../components/Toast.js";
import { getAll, put, putMany, remove } from "../services/storage/db.js";
import { createId, formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml } from "../utils/markdown.js";

const UNFILED_NOTEBOOK_ID = "";

export async function renderNotebooksPage(container, app) {
  app.setContext({ contextKey: "notebooks" });

  const [notebooks, notes] = await Promise.all([getAll("notebooks"), getAll("notes")]);
  const sortedNotebooks = notebooks
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const sortedNotes = notes
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const notebookMap = new Map(sortedNotebooks.map((notebook) => [notebook.id, notebook]));
  const filedCount = sortedNotes.filter((note) => note.notebookId && notebookMap.has(note.notebookId)).length;
  const unfiledNotes = sortedNotes.filter((note) => !note.notebookId || !notebookMap.has(note.notebookId));

  container.innerHTML = `
    <section class="page-header hero-panel">
      <div>
        <p class="eyebrow">知识库整理</p>
        <h1>笔记本</h1>
        <p>把不同课程、章节或主题的笔记收入同一个笔记本中，让长期学习资料更容易维护。</p>
      </div>
    </section>

    <section class="stats-grid notebook-stats">
      <div><strong>${sortedNotebooks.length}</strong><span>笔记本</span></div>
      <div><strong>${sortedNotes.length}</strong><span>总笔记</span></div>
      <div><strong>${filedCount}</strong><span>已归档笔记</span></div>
      <div><strong>${unfiledNotes.length}</strong><span>未归档笔记</span></div>
    </section>

    <form class="notebook-create-card" data-create-notebook-form>
      <div>
        <p class="eyebrow">新建笔记本</p>
        <h2>创建一个学习集合</h2>
        <p>例如“量子力学”“数学物理方法”或“期末复习”。</p>
      </div>
      <div class="notebook-create-row">
        <input name="title" maxlength="80" placeholder="笔记本名称" required />
        <button class="primary-button" type="submit">创建笔记本</button>
      </div>
    </form>

    <section class="notebook-board">
      ${renderNotebookCard({
        notebook: {
          id: UNFILED_NOTEBOOK_ID,
          title: "未归档笔记",
          description: "还没有收入任何笔记本的资料。"
        },
        notes: unfiledNotes,
        allNotebooks: sortedNotebooks,
        virtual: true
      })}
      ${
        sortedNotebooks.length
          ? sortedNotebooks
              .map((notebook) =>
                renderNotebookCard({
                  notebook,
                  notes: sortedNotes.filter((note) => note.notebookId === notebook.id),
                  allNotebooks: sortedNotebooks
                })
              )
              .join("")
          : ""
      }
    </section>
  `;

  container.querySelector("[data-create-notebook-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") || "").trim();
    if (!title) {
      showToast("请填写笔记本名称", "error");
      return;
    }
    await put("notebooks", {
      id: createId("notebook"),
      title,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    form.reset();
    showToast("笔记本已创建", "success");
    app.refresh();
  });

  container.querySelectorAll("[data-open-note]").forEach((button) => {
    button.addEventListener("click", () => app.navigate(`/note/${button.dataset.openNote}`));
  });

  container.querySelectorAll("[data-archive-note]").forEach((button) => {
    button.addEventListener("click", async () => {
      const note = await getNoteById(button.dataset.archiveNote);
      if (note) await openArchiveNoteModal(note, sortedNotebooks, app);
    });
  });

  container.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", async () => {
      const note = await getNoteById(button.dataset.deleteNote);
      if (note) await openDeleteNoteModal(note, app);
    });
  });

  container.querySelectorAll("[data-rename-notebook]").forEach((button) => {
    button.addEventListener("click", async () => {
      const notebook = sortedNotebooks.find((item) => item.id === button.dataset.renameNotebook);
      if (notebook) await openRenameNotebookModal(notebook, app);
    });
  });

  container.querySelectorAll("[data-delete-notebook]").forEach((button) => {
    button.addEventListener("click", async () => {
      const notebook = sortedNotebooks.find((item) => item.id === button.dataset.deleteNotebook);
      if (notebook) await openDeleteNotebookModal(notebook, sortedNotes, app);
    });
  });
}

function renderNotebookCard({ notebook, notes, allNotebooks, virtual = false }) {
  return `
    <article class="notebook-card ${virtual ? "unfiled" : ""}">
      <header class="notebook-card-header">
        <div>
          <p class="eyebrow">${virtual ? "Inbox" : "Notebook"}</p>
          <h2>${escapeHtml(notebook.title)}</h2>
          <span>${notes.length} 份笔记${virtual ? "" : ` · 创建于 ${formatDateTime(notebook.createdAt)}`}</span>
        </div>
        ${
          virtual
            ? ""
            : `<div class="card-actions">
                <button class="secondary-button" data-rename-notebook="${escapeHtml(notebook.id)}" type="button">重命名</button>
                <button class="danger-button" data-delete-notebook="${escapeHtml(notebook.id)}" type="button">删除</button>
              </div>`
        }
      </header>
      <div class="notebook-note-list">
        ${
          notes.length
            ? notes.map((note) => renderNotebookNote(note, allNotebooks)).join("")
            : `<div class="empty-state compact">${virtual ? "所有笔记都已经整理进笔记本。" : "这个笔记本里还没有笔记。"}</div>`
        }
      </div>
    </article>
  `;
}

function renderNotebookNote(note) {
  return `
    <div class="notebook-note-row">
      <button class="notebook-note-title" data-open-note="${escapeHtml(note.id)}" type="button">
        <strong>${escapeHtml(note.title || "未命名笔记")}</strong>
        <span>${escapeHtml(note.fileName || "Markdown 笔记")} · ${formatDateTime(note.updatedAt || note.createdAt)}</span>
      </button>
      <div class="notebook-note-actions">
        <button class="secondary-button" data-archive-note="${escapeHtml(note.id)}" type="button">归档</button>
        <button class="danger-button" data-delete-note="${escapeHtml(note.id)}" type="button">删除</button>
      </div>
    </div>
  `;
}

async function openArchiveNoteModal(note, notebooks, app) {
  const modal = openModal({
    title: "归档笔记",
    content: `
      <form class="notebook-modal-form" data-archive-note-form>
        <label>
          <span>归入笔记本</span>
          <select name="notebookId">
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
        <div class="form-actions">
          <button class="secondary-button" type="button" data-cancel-modal>取消</button>
          <button class="primary-button" type="submit">保存归档</button>
        </div>
      </form>`,
    width: "480px"
  });

  modal.body.querySelector("[data-cancel-modal]").addEventListener("click", () => modal.close());
  modal.body.querySelector("[data-archive-note-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const notebookId = String(new FormData(event.currentTarget).get("notebookId") || "");
    await put("notes", {
      ...note,
      notebookId,
      updatedAt: nowIso()
    });
    showToast(notebookId ? "笔记已收入笔记本" : "笔记已移到未归档", "success");
    modal.close();
    app.refresh();
  });
}

async function openDeleteNoteModal(note, app) {
  const modal = openModal({
    title: "删除笔记",
    content: `
      <div class="notebook-modal-form">
        <p>确定删除“${escapeHtml(note.title || "未命名笔记")}”吗？相关题目、答题记录和错题不会自动删除。</p>
        <div class="form-actions">
          <button class="secondary-button" type="button" data-cancel-modal>取消</button>
          <button class="danger-button" type="button" data-confirm-delete-note>删除笔记</button>
        </div>
      </div>`,
    width: "520px"
  });

  modal.body.querySelector("[data-cancel-modal]").addEventListener("click", () => modal.close());
  modal.body.querySelector("[data-confirm-delete-note]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await remove("notes", note.id);
      showToast("笔记已删除", "success");
      modal.close();
      app.refresh();
    } catch (error) {
      button.disabled = false;
      showToast(error.message || "删除失败", "error");
    }
  });
}

async function openRenameNotebookModal(notebook, app) {
  const modal = openModal({
    title: "重命名笔记本",
    content: `
      <form class="notebook-modal-form" data-rename-notebook-form>
        <label>
          <span>笔记本名称</span>
          <input name="title" maxlength="80" required value="${escapeHtml(notebook.title)}" />
        </label>
        <div class="form-actions">
          <button class="secondary-button" type="button" data-cancel-modal>取消</button>
          <button class="primary-button" type="submit">保存</button>
        </div>
      </form>`,
    width: "480px"
  });

  modal.body.querySelector("[data-cancel-modal]").addEventListener("click", () => modal.close());
  modal.body.querySelector("[data-rename-notebook-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") || "").trim();
    if (!title) {
      showToast("请填写笔记本名称", "error");
      return;
    }
    await put("notebooks", {
      ...notebook,
      title,
      updatedAt: nowIso()
    });
    showToast("笔记本已重命名", "success");
    modal.close();
    app.refresh();
  });
}

async function openDeleteNotebookModal(notebook, notes, app) {
  const relatedNotes = notes.filter((note) => note.notebookId === notebook.id);
  const modal = openModal({
    title: "删除笔记本",
    content: `
      <div class="notebook-modal-form">
        <p>确定删除“${escapeHtml(notebook.title)}”吗？其中 ${relatedNotes.length} 份笔记会移到“未归档笔记”，笔记本会删除，但笔记不会被删除。</p>
        <div class="form-actions">
          <button class="secondary-button" type="button" data-cancel-modal>取消</button>
          <button class="danger-button" type="button" data-confirm-delete-notebook>删除笔记本</button>
        </div>
      </div>`,
    width: "520px"
  });

  modal.body.querySelector("[data-cancel-modal]").addEventListener("click", () => modal.close());
  modal.body.querySelector("[data-confirm-delete-notebook]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    await putMany(
      "notes",
      relatedNotes.map((note) => ({
        ...note,
        notebookId: "",
        updatedAt: nowIso()
      }))
    );
    await remove("notebooks", notebook.id);
    showToast("笔记本已删除，笔记已移到未归档", "success");
    modal.close();
    app.refresh();
  });
}

async function getNoteById(id) {
  const notes = await getAll("notes");
  return notes.find((note) => note.id === id);
}

import { buildPdfNoteMessages, normalizePdfNoteResult } from "../prompts/pdfNote.js";
import { callJsonCompletion } from "../services/ai/aiClient.js";
import { extractPdfText } from "../services/pdfText.js";
import { getAll, put } from "../services/storage/db.js";
import { startElapsedTimer } from "../utils/elapsedTimer.js";
import { createId, nowIso } from "../utils/ids.js";
import { escapeHtml, getNoteTitle, parseMarkdownSections } from "../utils/markdown.js";

export async function renderPdfNotePage(container, app) {
  app.setContext({ contextKey: "pdf-note" });
  const notebooks = (await getAll("notebooks")).sort((a, b) =>
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  );

  container.innerHTML = `
    <section class="page-header hero-panel">
      <div>
        <p class="eyebrow">PDF 入笔记</p>
        <h1>从 PDF 生成 Markdown 笔记</h1>
        <p>上传 PDF 后只抽取文本交给笔记模型整理，不保存 PDF 文件。生成的 .md 笔记会收入指定笔记本。</p>
      </div>
    </section>

    <section class="pdf-note-layout">
      <form class="settings-section pdf-note-form" data-pdf-note-form>
        <div class="section-heading inline">
          <div>
            <h2>生成设置</h2>
            <p>笔记会固定包含“笔记内容 / 例题 / 答案”，例题优先从 PDF 原文抽取。</p>
          </div>
        </div>

        <label>
          <span>PDF 文件</span>
          <input name="pdfFile" type="file" accept="application/pdf,.pdf" required />
        </label>

        <div class="form-grid">
          <label>
            <span>收入笔记本</span>
            <select name="notebookId">
              <option value="">未归档</option>
              ${notebooks
                .map((notebook) => `<option value="${escapeHtml(notebook.id)}">${escapeHtml(notebook.title)}</option>`)
                .join("")}
            </select>
          </label>
          <label>
            <span>或新建笔记本</span>
            <input name="newNotebookTitle" maxlength="80" placeholder="例如：量子力学 PDF" />
          </label>
        </div>

        <label>
          <span>做笔记提示词（可选）</span>
          <textarea name="guidance" rows="5" placeholder="例如：请更适合期末复习；强调公式推导；例题尽量偏计算；术语保留英文。"></textarea>
        </label>

        <div class="status-box" data-pdf-note-status>
          生成时会先在本地解析 PDF 文本，再调用“笔记模型”。如果 PDF 是扫描版图片，需要先 OCR 后再导入。
        </div>

        <div class="form-actions">
          <button class="primary-button" type="submit">生成 Markdown 笔记</button>
          <button class="secondary-button" type="button" data-open-settings>配置笔记模型</button>
        </div>
      </form>

      <aside class="settings-section pdf-note-guide">
        <p class="eyebrow">结构要求</p>
        <h2>生成后的笔记格式</h2>
        <pre><code># 标题

## 笔记内容
...

## 例题
1. 来源：PDF ...

## 答案
1. ...</code></pre>
        <p>如果 PDF 中没有明显例题，模型会基于笔记内容补充例题，并标注“来源：AI 补充”。</p>
      </aside>
    </section>
  `;

  container.querySelector("[data-open-settings]").addEventListener("click", () => {
    app.navigate("/settings");
  });

  container.querySelector("[data-pdf-note-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = form.elements.pdfFile.files?.[0];
    const status = form.querySelector("[data-pdf-note-status]");
    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;
    status.textContent = "解析 PDF 中...";

    let elapsedTimer = null;
    try {
      const pdf = await extractPdfText(file);
      status.textContent = pdf.truncated
        ? `已提取 ${pdf.pageCount} 页文本，因内容较长已取 ${pdf.usedCharCount} 字用于生成。`
        : `已提取 ${pdf.pageCount} 页、约 ${pdf.usedCharCount} 字文本。`;
      elapsedTimer = startElapsedTimer(status, "做笔记中");

      const guidance = String(formData.get("guidance") || "").trim();
      const raw = await callJsonCompletion({
        role: "note",
        messages: buildPdfNoteMessages({
          pdfText: pdf.text,
          fileName: pdf.fileName,
          pageCount: pdf.pageCount,
          guidance,
          truncated: pdf.truncated
        }),
        temperature: 0.25,
        timeoutMs: 300000
      });
      const noteResult = normalizePdfNoteResult(raw, titleFromFile(pdf.fileName));
      const notebookId = await resolveNotebookId({
        selectedNotebookId: String(formData.get("notebookId") || ""),
        newNotebookTitle: String(formData.get("newNotebookTitle") || "").trim()
      });
      const noteId = createId("note");
      const createdAt = nowIso();
      const markdown = noteResult.markdown;
      const title = noteResult.title || getNoteTitle(`${titleFromFile(pdf.fileName)}.md`, markdown);

      await put("notes", {
        id: noteId,
        title,
        fileName: `${safeFileBase(title)}.md`,
        content: markdown,
        sections: parseMarkdownSections(markdown),
        notebookId,
        sourceType: "pdf-generated",
        sourcePdfName: pdf.fileName,
        notePrompt: guidance,
        exampleSource: noteResult.exampleSource,
        createdAt,
        updatedAt: createdAt
      });

      elapsedTimer?.stop();
      status.innerHTML = `
        已生成笔记“${escapeHtml(title)}”。PDF 文件未保存，只保存了生成后的 Markdown 笔记。
        <div class="form-actions status-actions">
          <button class="primary-button" type="button" data-open-created-note>打开笔记</button>
          <button class="secondary-button" type="button" data-create-another>继续生成</button>
        </div>
      `;
      status.querySelector("[data-open-created-note]").addEventListener("click", () => app.navigate(`/note/${noteId}`));
      status.querySelector("[data-create-another]").addEventListener("click", () => app.refresh());
      showSuccess(app, title);
      form.reset();
    } catch (error) {
      elapsedTimer?.stop();
      status.textContent = `生成失败：${error.message}`;
      app.showToast(error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function resolveNotebookId({ selectedNotebookId, newNotebookTitle }) {
  if (!newNotebookTitle) return selectedNotebookId;
  const now = nowIso();
  const notebook = {
    id: createId("notebook"),
    title: newNotebookTitle,
    createdAt: now,
    updatedAt: now
  };
  await put("notebooks", notebook);
  return notebook.id;
}

function showSuccess(app, title) {
  app.showToast(`已生成 Markdown 笔记：${title}`, "success");
}

function titleFromFile(fileName) {
  return String(fileName || "PDF 生成笔记")
    .replace(/\.pdf$/i, "")
    .trim() || "PDF 生成笔记";
}

function safeFileBase(title) {
  return String(title || "pdf-note")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "pdf-note";
}

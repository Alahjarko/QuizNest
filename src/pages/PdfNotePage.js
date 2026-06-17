import { buildPdfNoteMessages, buildVisionNoteMessages, normalizePdfNoteResult } from "../prompts/pdfNote.js";
import { callJsonCompletion } from "../services/ai/aiClient.js";
import { extractPdfText } from "../services/pdfText.js";
import { extractPptxSlides } from "../services/pptxText.js";
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
        <p class="eyebrow">文档入笔记</p>
        <h1>从 PDF 或 PPT 生成 Markdown 笔记</h1>
        <p>PDF 会提取文本整理；PowerPoint（.pptx）会渲染每页幻灯片，让多模态笔记模型直接读图。不保存原始文件，生成的 .md 笔记会收入指定笔记本。</p>
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
          <span>PDF / PowerPoint 文件</span>
          <input name="pdfFile" type="file" accept="application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" required />
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
          PDF 会提取文本后调用笔记模型整理；PPT 会将每页渲染为图片，调用多模态模型直接读图，可识别公式、推导和图解。原始文件不会保存。
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
    status.textContent = "解析文档中...";

    let elapsedTimer = null;
    try {
      const isPptx =
        /\.pptx$/i.test(file.name) || file.type.includes("presentationml.presentation");
      const guidance = String(formData.get("guidance") || "").trim();

      // ===== PDF 路径：文本抽取 → 文本模型 =====
      // ===== PPT 路径：整页渲染 PNG → 多模态模型直接读图 =====
      let noteResult;
      let sourceFileName;

      if (isPptx) {
        const pptxData = await extractPptxSlides(file);
        sourceFileName = pptxData.fileName;
        status.textContent = `已渲染 ${pptxData.pageCount} 张幻灯片为图片，准备调用多模态笔记模型...`;
        elapsedTimer = startElapsedTimer(status, "调用多模态模型做笔记中");

        // 将 extractPptxSlides 返回的扁平格式适配为 buildVisionNoteMessages 期望的格式
        const slides = pptxData.slides.map((s) => ({
          pageNumber: s.pageNumber,
          title: s.title,
          images: [{ dataUrl: s.dataUrl }]
        }));

        const raw = await callJsonCompletion({
          role: "note",
          messages: buildVisionNoteMessages({
            slides,
            fileName: pptxData.fileName,
            pageCount: pptxData.pageCount,
            guidance
          }),
          temperature: 0.25,
          timeoutMs: 300000
        });
        noteResult = normalizePdfNoteResult(raw, titleFromFile(pptxData.fileName));
      } else {
        const doc = await extractPdfText(file);
        sourceFileName = doc.fileName;
        status.textContent = doc.truncated
          ? `已提取 ${doc.pageCount} 页文本，因内容较长已取 ${doc.usedCharCount} 字用于生成。`
          : `已提取 ${doc.pageCount} 页、约 ${doc.usedCharCount} 字文本。`;
        elapsedTimer = startElapsedTimer(status, "做笔记中");

        const raw = await callJsonCompletion({
          role: "note",
          messages: buildPdfNoteMessages({
            pdfText: doc.text,
            fileName: doc.fileName,
            pageCount: doc.pageCount,
            guidance,
            truncated: doc.truncated
          }),
          temperature: 0.25,
          timeoutMs: 300000
        });
        noteResult = normalizePdfNoteResult(raw, titleFromFile(doc.fileName));
      }

      const notebookId = await resolveNotebookId({
        selectedNotebookId: String(formData.get("notebookId") || ""),
        newNotebookTitle: String(formData.get("newNotebookTitle") || "").trim()
      });
      const noteId = createId("note");
      const createdAt = nowIso();
      const markdown = noteResult.markdown;
      const title = noteResult.title || getNoteTitle(`${titleFromFile(sourceFileName)}.md`, markdown);

      await put("notes", {
        id: noteId,
        title,
        fileName: `${safeFileBase(title)}.md`,
        content: markdown,
        sections: parseMarkdownSections(markdown),
        notebookId,
        sourceType: isPptx ? "pptx-generated" : "pdf-generated",
        sourceFileName,
        notePrompt: guidance,
        exampleSource: noteResult.exampleSource,
        createdAt,
        updatedAt: createdAt
      });

      elapsedTimer?.stop();
      status.innerHTML = `
        已生成笔记“${escapeHtml(title)}”。原始文件未保存，只保存了生成后的 Markdown 笔记。
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
  return String(fileName || "生成笔记")
    .replace(/\.pdf$/i, "")
    .replace(/\.pptx$/i, "")
    .trim() || "生成笔记";
}

function safeFileBase(title) {
  return String(title || "pdf-note")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "pdf-note";
}

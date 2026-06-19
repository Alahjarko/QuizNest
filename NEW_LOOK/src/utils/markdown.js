import { createId } from "./ids.js";

export function parseMarkdownSections(content) {
  const lines = String(content || "").split(/\r?\n/);
  const headings = [];

  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        title: match[2].replace(/#+\s*$/, "").trim(),
        startLine: index
      });
    }
  });

  if (headings.length === 0) {
    return [
      {
        id: createId("section"),
        title: "全文",
        level: 1,
        startLine: 0,
        endLine: Math.max(0, lines.length - 1),
        content
      }
    ];
  }

  return headings.map((heading, index) => {
    const next = headings[index + 1];
    const endLine = next ? next.startLine - 1 : lines.length - 1;
    return {
      id: createId("section"),
      title: heading.title,
      level: heading.level,
      startLine: heading.startLine,
      endLine,
      content: lines.slice(heading.startLine, endLine + 1).join("\n")
    };
  });
}

export function getNoteTitle(fileName, content) {
  const firstHeading = /^(#{1,6})\s+(.+?)\s*$/m.exec(content);
  if (firstHeading) return firstHeading[2].replace(/#+\s*$/, "").trim();
  return fileName.replace(/\.md$/i, "") || "未命名笔记";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderMarkdown(content) {
  const lines = String(content || "").split(/\r?\n/);
  const html = [];
  let inCode = false;
  let inList = false;
  let listTag = "ul";
  let inMath = false;
  let mathEnd = "";
  let mathBuffer = [];
  let codeBuffer = [];

  const closeList = () => {
    if (inList) {
      html.push(`</${listTag}>`);
      inList = false;
    }
  };

  const openList = (tag) => {
    if (inList && listTag !== tag) closeList();
    if (!inList) {
      listTag = tag;
      html.push(`<${listTag}>`);
      inList = true;
    }
  };

  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeBuffer = [];
  };

  const flushMath = () => {
    html.push(`<div class="math-block">${escapeHtml(mathBuffer.join("\n"))}</div>`);
    mathBuffer = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inMath) {
      mathBuffer.push(line);
      if (line.trim() === mathEnd || line.includes(mathEnd)) {
        inMath = false;
        flushMath();
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "$$" || trimmed.startsWith("$$")) {
      closeList();
      inMath = true;
      mathEnd = "$$";
      mathBuffer.push(line);
      if (trimmed.endsWith("$$") && trimmed.length > 2) {
        inMath = false;
        flushMath();
      }
      continue;
    }

    if (trimmed === "\\[" || trimmed.startsWith("\\[")) {
      closeList();
      inMath = true;
      mathEnd = "\\]";
      mathBuffer.push(line);
      if (trimmed.includes("\\]")) {
        inMath = false;
        flushMath();
      }
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const unorderedItem = /^\s*[-*]\s+(.+)$/.exec(line);
    if (unorderedItem) {
      openList("ul");
      html.push(`<li>${renderInline(unorderedItem[1])}</li>`);
      continue;
    }

    const orderedItem = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (orderedItem) {
      openList("ol");
      html.push(`<li>${renderInline(orderedItem[1])}</li>`);
      continue;
    }

    const blockquote = /^\s*>\s?(.+)$/.exec(line);
    if (blockquote) {
      closeList();
      html.push(`<blockquote>${renderInline(blockquote[1])}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      html.push("<p class=\"blank-line\"></p>");
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  if (inCode) flushCode();
  if (inMath) flushMath();
  closeList();
  return html.join("");
}

function renderInline(line) {
  return escapeHtml(line)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

export function noteExcerpt(note, maxChars = 7000) {
  const content = note?.content || "";
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[笔记较长，已截断用于本次 AI 上下文]`;
}

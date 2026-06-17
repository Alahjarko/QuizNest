export function buildPdfNoteMessages({ pdfText, fileName, pageCount, guidance, truncated }) {
  return [
    {
      role: "system",
      content: `你是 QuizNest 的学习笔记整理助手。你必须只返回合法 JSON，不要返回 Markdown 代码块。`
    },
    {
      role: "user",
      content: `请根据下面 PDF 提取文本生成一份 Markdown 学习笔记。

严格要求：
1. 返回 JSON：{"title":"笔记标题","markdown":"完整 Markdown 笔记","exampleSource":"pdf/ai/both"}。
2. markdown 必须包含且只使用这些一级结构：
   # 标题
   ## 笔记内容
   ## 例题
   ## 答案
3. “笔记内容”要按概念、公式、推导步骤、易错点整理，适合之后用来出题。
4. “例题”优先从 PDF 文本中抽取原有例题、Example、Problem、习题、Worked example、练习题，并尽量保留题干、条件和符号；从 PDF 抽取的例题请标注“来源：PDF”。
5. 如果 PDF 文本里没有明显例题，必须基于笔记内容自行补充 2-4 道例题，并标注“来源：AI 补充”。
6. “答案”必须与“例题”一一对应，包含关键步骤，不要只有最终答案。
7. 不要提到你无法看到 PDF 文件本体；你只能基于提取文本工作。
8. 不要保存或引用 PDF 文件路径。

用户个性化要求：
${guidance || "无"}

PDF 信息：
- 文件名：${fileName}
- 页数：${pageCount}
- 文本是否截断：${truncated ? "是，优先利用已提供的开头和结尾文本" : "否"}

PDF 提取文本：
${pdfText}`
    }
  ];
}

// ===== 多模态模式：直接读 PPT 幻灯片图片 =====

// 构建视觉模型的消息：将幻灯片图片作为 image_url 发送，模型直接读图做笔记。
// 参数 slides 格式：[{pageNumber, title, images: [{dataUrl}]}]
export function buildVisionNoteMessages({ slides, fileName, pageCount, guidance }) {
  const contentParts = [];

  // 文字指令部分
  contentParts.push({
    type: "text",
    text: `请根据以下 PPT 幻灯片图片生成一份 Markdown 学习笔记。

严格要求：
1. 返回 JSON：{"title":"笔记标题","markdown":"完整 Markdown 笔记","exampleSource":"pdf/ai/both"}。
2. markdown 必须包含且只使用这些一级结构：
   # 标题
   ## 笔记内容
   ## 例题
   ## 答案
3. "笔记内容"要按概念、公式、推导步骤、易错点整理，适合之后用来出题。请从图片中识别所有公式、定理、推导过程，用 LaTeX 格式书写（行内用 \\(...\\)，块级用 \\[...\\]）。
4. "例题"优先从幻灯片图片中识别原有例题、Example、Problem、习题，保留题干、条件和符号，标注"来源：PDF"。
5. 如果图片中没有明显例题，必须基于笔记内容自行补充 2-4 道例题，标注"来源：AI 补充"。
6. "答案"必须与"例题"一一对应，包含关键步骤，不要只有最终答案。
7. exampleSource 取值：如果例题主要来自图片则为 "pdf"，如果都是你补充的则为 "ai"，混合则为 "both"。

用户个性化要求：
${guidance || "无"}

文件信息：
- 文件名：${fileName}
- 幻灯片数：${pageCount}

以下是按顺序排列的幻灯片（含标题和图片），请仔细阅读每张图片中的内容：`
  });

  // 逐张幻灯片：标题文字 + 图片
  for (const slide of slides) {
    const caption = slide.images.length > 0
      ? `--- 第 ${slide.pageNumber} 张幻灯片${slide.title ? "：" + slide.title : ""} ---`
      : `--- 第 ${slide.pageNumber} 张幻灯片（仅标题）：${slide.title || "（无标题）"} ---`;
    contentParts.push({ type: "text", text: caption });

    for (const image of slide.images) {
      contentParts.push({
        type: "image_url",
        image_url: { url: image.dataUrl }
      });
    }
  }

  return [
    {
      role: "system",
      content: "你是 QuizNest 的学习笔记整理助手，擅长从教学幻灯片图片中提取知识点。你必须只返回合法 JSON，不要返回 Markdown 代码块。数学公式请使用 LaTeX：行内公式用 \\(...\\)，块级公式用 \\[...\\]。"
    },
    {
      role: "user",
      content: contentParts
    }
  ];
}

export function normalizePdfNoteResult(data, fallbackTitle = "PDF 生成笔记") {
  if (!data || typeof data !== "object") {
    throw new Error("笔记模型返回的 JSON 顶层必须是对象");
  }
  const title = cleanTitle(data.title || fallbackTitle);
  const markdown = normalizeMarkdown(String(data.markdown || ""), title);
  const source = ["pdf", "ai", "both"].includes(data.exampleSource) ? data.exampleSource : inferExampleSource(markdown);
  return {
    title,
    markdown,
    exampleSource: source
  };
}

function normalizeMarkdown(markdown, title) {
  let content = markdown.trim();
  if (!content) {
    throw new Error("笔记模型返回的 markdown 为空");
  }
  content = content.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/i, "").trim();

  if (!/^#\s+/m.test(content)) {
    content = `# ${title}\n\n${content}`;
  }

  const required = ["笔记内容", "例题", "答案"];
  for (const heading of required) {
    if (!new RegExp(`^##\\s+${heading}\\s*$`, "m").test(content)) {
      content += `\n\n## ${heading}\n\n待补充。`;
    }
  }

  return content;
}

function cleanTitle(title) {
  return String(title || "PDF 生成笔记")
    .replace(/^#+\s*/, "")
    .trim()
    .slice(0, 80) || "PDF 生成笔记";
}

function inferExampleSource(markdown) {
  if (/来源：PDF/.test(markdown) && /来源：AI/.test(markdown)) return "both";
  if (/来源：PDF/.test(markdown)) return "pdf";
  return "ai";
}

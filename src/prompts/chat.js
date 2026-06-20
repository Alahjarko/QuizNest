import { noteExcerpt } from "../utils/markdown.js";
import { toPromptJson } from "../services/ai/jsonRepair.js";

export function buildChatMessages({ context, memories = [], history, userMessage }) {
  const focusedNote = context?.learningMode && context?.section?.content
    ? { ...context.note, content: context.section.content }
    : context?.note;
  const compactContext = {
    noteTitle: context?.note?.title,
    noteExcerpt: focusedNote ? noteExcerpt(focusedNote, 7000) : undefined,
    currentSection: sanitizePromptValue(context?.section, 7000),
    learningMode: sanitizePromptValue(context?.learningMode, 1000),
    questionSet: sanitizePromptValue(context?.questionSet, 1200),
    questionSetProgress: sanitizePromptValue(context?.questionSetProgress, 1200),
    questionSetAnswers: sanitizePromptValue(context?.questionSetAnswers, 2200),
    question: sanitizePromptValue(context?.question, 2500),
    userAnswer: summarizeAnswerForPrompt(context?.answer),
    correctAnswer: compactText(context?.correctAnswer, 1800),
    aiExplanation: sanitizePromptValue(context?.aiExplanation, 2500),
    wrongItem: summarizeWrongItemForPrompt(context?.wrongItem)
  };

  const memoryContext = memories.slice(0, 30).map((item) => ({
    category: item.category,
    content: compactText(item.content, 500)
  }));
  const learningInstructions = context?.learningMode
    ? `
当前处于“学习新知识”模式：
- 只围绕当前章节循序教学，不要提前展开后续章节。
- 先明确本节目标，再一次讲一个核心概念，并通过短问题检查用户理解。
- 根据用户回答决定继续解释、换一种讲法或进入下一个概念。
- 不要一次性输出整章摘要；保持可交互的教学节奏。
- 章节切换由界面按钮控制，不要自行宣称已经进入下一章。`
    : "";

  const system = `你是一个中文学习解惑助手。回答必须结合当前上下文，优先使用用户笔记和当前题目信息。

要求：
- 不要编造笔记之外的事实；如果上下文不足，请说明。
- 可以用更简单的话解释概念，也可以根据上下文额外出一道类似题。
- 回答要清楚、简洁、有教学感。
- 如需写数学公式，请使用标准 LaTeX：行内公式用 \\(...\\)，块级公式用 \\[...\\]。
- 不要输出未闭合的 $、$$、\\(、\\[，不要把 Markdown 加粗符号包在公式分隔符内。
- 如果上下文提示用户答案包含图片，但没有提供图片内容，请只基于文字答案、识别结果和已记录反馈回答；不要声称自己已经看到了图片。
${learningInstructions}

长期学习记忆（可能为空）：
${toPromptJson(memoryContext)}

使用长期记忆时：把它用于调整讲解方式和提醒常见错误；若记忆与当前笔记或用户本轮表述冲突，以当前信息为准，不要向用户声称记忆一定正确。

当前上下文：
${toPromptJson(compactContext)}`;

  return [
    { role: "system", content: system },
    ...history.slice(-12).map((item) => ({
      role: item.role,
      content: compactText(item.content, 3000)
    })),
    { role: "user", content: compactText(userMessage, 4000) }
  ];
}

function summarizeAnswerForPrompt(answer) {
  if (!answer) return undefined;
  if (typeof answer !== "object") return compactText(answer, 1800);

  return sanitizePromptValue(
    {
      selectedOption: answer.selectedOption,
      textAnswer: answer.textAnswer,
      imageName: answer.imageName,
      hasImageAnswer: Boolean(answer.imageDataUrl || answer.imageName),
      imageContentOmitted: answer.imageDataUrl ? "图片原始数据已省略，避免把 base64 图片作为文本上下文发送。" : undefined,
      submitted: answer.submitted,
      isCorrect: answer.isCorrect,
      score: answer.score,
      gradeResult: answer.gradeResult,
      aiTeaching: answer.aiTeaching
    },
    2500
  );
}

function summarizeWrongItemForPrompt(item) {
  if (!item) return undefined;
  return sanitizePromptValue(
    {
      section: item.section,
      questionType: item.questionType,
      questionContent: item.questionContent,
      userAnswer: item.userAnswer,
      correctAnswer: item.correctAnswer,
      errorReason: item.errorReason,
      aiExplanation: item.aiExplanation,
      mastered: item.mastered,
      reviewCount: item.reviewCount
    },
    3000
  );
}

function sanitizePromptValue(value, maxStringLength = 1800, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return compactText(value, maxStringLength);
  if (typeof value !== "object") return value;
  if (depth > 4) return "[内容层级较深，已省略]";

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizePromptValue(item, maxStringLength, depth + 1));
  }

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldOmitPromptKey(key, entry)) {
      result[key] = "[图片或二进制数据已省略]";
      continue;
    }
    result[key] = sanitizePromptValue(entry, maxStringLength, depth + 1);
  }
  return result;
}

function shouldOmitPromptKey(key, value) {
  const normalized = key.toLowerCase();
  if (
    normalized.includes("imagedata") ||
    normalized.includes("avatar") ||
    normalized === "dataurl" ||
    normalized === "image" ||
    normalized === "file"
  ) {
    return true;
  }
  return typeof value === "string" && /^data:image\//i.test(value);
}

function compactText(value, maxLength = 1800) {
  if (value == null) return value;
  const text = String(value).replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[图片数据已省略]");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[内容较长，已截断]`;
}

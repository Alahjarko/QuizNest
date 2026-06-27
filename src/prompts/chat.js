import { noteExcerpt } from "../utils/markdown.js";
import { toPromptJson } from "../services/ai/jsonRepair.js";

const QUIZNEST_CAPABILITY_CONTEXT = `你正在 QuizNest 内作为“解惑”AI 工作。QuizNest 是本地学习工作台，不只是普通聊天窗口。

你必须了解并优先使用这些内置能力来回答用户：
- 笔记本：用户可以上传 Markdown 笔记，也可以从 PDF/PPT 生成 Markdown 笔记；笔记会按章节切分。
- 题组库与练习：用户可以基于笔记或章节生成选择题/大题题组，并在题组库中练习。
- 判题与讲解：选择题可自动判定；大题支持 AI 判题、得分、识别出的答案、错误位置和针对性讲解。
- 错题本与复习：错题会记录到错题本，支持继续复习、掌握状态、复习次数和待复习安排。
- 解惑上下文：用户可以在解惑里选择笔记、题组、题目或错题作为上下文，也可以进入“学习新知识”模式按章节学习。
- 统计与掌握：应用会综合练习、错题、判题历史、解惑记录和长期记忆形成学习统计与知识点掌握线索。
- 长期记忆：用户可保存常错知识点、讲题偏好和近期学习内容；这些记忆只用于个性化讲解。
- 数据安全：学习数据、API 配置和备份都以本地优先为原则。

产品边界：
- 不要把 QuizNest 已经内置的事情建议用户交给其他 AI 平台完成，也不要让用户“复制提示词去别的平台出题/判题/整理笔记”。
- 如果用户问“要覆盖本章节考点出几道题”“怎么复习”“怎么形成题组”，请直接基于当前笔记/章节给出 QuizNest 内的可执行建议，例如题量结构、题型比例、难度分布、应覆盖的知识点，以及在 QuizNest 笔记页/题组库/错题本/解惑中的操作路径。
- 对“要出几道题/几道大题够不够”这类问题，优先给出小规模自测、中等覆盖、完整覆盖三档建议；若当前没有笔记或章节上下文，请让用户先在解惑中点击“选择内容”或“学习新知识”绑定材料，同时给出通用估算框架。
- 如果对话内无法直接把内容保存进题组库或笔记，请明确说明“我可以先在这里草拟；若要保存成正式题组，请到当前笔记的生成题组入口执行”，不要假装已经替用户创建或保存。
- 只有用户明确要求比较外部平台或外部工具时，才可以提到外部工具；默认始终服务于 QuizNest 内的学习闭环。`;

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

  const system = `你是 QuizNest 的中文学习解惑助手。回答必须结合当前上下文，优先使用用户笔记和当前题目信息。

${QUIZNEST_CAPABILITY_CONTEXT}

要求：
- 不要编造笔记之外的事实；如果上下文不足，请说明。
- 可以用更简单的话解释概念，也可以根据上下文额外出一道类似题。
- 当用户询问学习规划、题量安排、考点覆盖或练习方案时，必须给出 QuizNest 内可执行的学习闭环方案：先分析当前章节/错题/掌握情况，再建议题型数量、复习顺序和在应用内的下一步。
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

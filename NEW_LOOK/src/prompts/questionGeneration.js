import { noteExcerpt } from "../utils/markdown.js";
import { toPromptJson } from "../services/ai/jsonRepair.js";

const SUBJECTIVE_TYPE_LABELS = {
  short_answer: "简答题",
  proof: "证明题",
  calculation: "计算题"
};

export function buildQuestionGenerationMessages({
  note,
  choiceCount,
  subjectiveCount,
  difficulty,
  guidance = "",
  subjectiveTypes = ["short_answer", "proof", "calculation"]
}) {
  const typeText = subjectiveTypes.map((type) => `${type}=${SUBJECTIVE_TYPE_LABELS[type] || type}`).join("、");
  const schema = {
    choiceQuestions: [
      {
        question: "题干",
        options: ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
        correctAnswer: "A",
        explanation: "正确答案解析",
        wrongOptionExplanations: {
          A: "如果 A 错，解释为什么错；若 A 是正确答案，可写正确原因",
          B: "错误原因",
          C: "错误原因",
          D: "错误原因"
        },
        relatedNoteSection: "相关笔记章节标题",
        difficulty: "简单/适中/困难"
      }
    ],
    subjectiveQuestions: [
      {
        question: "大题题干",
        questionType: "short_answer/proof/calculation",
        referenceAnswer: "参考答案",
        gradingRubric: "评分标准，分点说明",
        relatedNoteSection: "相关笔记章节标题",
        difficulty: "简单/适中/困难"
      }
    ]
  };

  return [
    {
      role: "system",
      content:
        "你是一名严谨的中文助学出题教师。你必须只输出合法 JSON，不允许使用 Markdown 代码块，不允许输出解释性前后缀。选择题必须只有唯一正确答案。"
    },
    {
      role: "user",
      content: `请根据下面 Markdown 笔记生成练习题。

要求：
- 选择题数量：${choiceCount}
- 大题数量：${subjectiveCount}
- 难度：${difficulty}
- 用户出题引导：${guidance ? guidance : "无，按整份笔记默认出题"}
- 大题允许题型：${typeText || "short_answer=简答题、proof=证明题、calculation=计算题"}
- 题目必须覆盖笔记中的关键概念，难度循序渐进。
- 如果用户填写了出题引导，请优先遵守；但所有题目仍必须基于笔记内容，不要偏离笔记。
- 大题 questionType 只能从允许题型中选择。如果只允许 calculation，就尽量生成计算题；如果允许多个类型，请混合生成。
- 选择题必须有四个选项，correctAnswer 只能是 "A"、"B"、"C"、"D" 之一。
- wrongOptionExplanations 必须分别解释 A/B/C/D。
- relatedNoteSection 必须尽量使用笔记中的章节标题。
- 如果笔记信息不足，请基于笔记内容合理出题，不要编造笔记之外的事实。

返回 JSON Schema 示例：
${toPromptJson(schema)}

Markdown 笔记：
${noteExcerpt(note, 9000)}`
    }
  ];
}

export function normalizeGeneratedQuestionData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("出题模型返回的 JSON 顶层必须是对象");
  }

  const choiceQuestions = Array.isArray(data.choiceQuestions) ? data.choiceQuestions : [];
  const subjectiveQuestions = Array.isArray(data.subjectiveQuestions) ? data.subjectiveQuestions : [];

  return {
    choiceQuestions: choiceQuestions.map((item) => normalizeChoiceQuestion(item)),
    subjectiveQuestions: subjectiveQuestions.map((item) => normalizeSubjectiveQuestion(item))
  };
}

function normalizeChoiceQuestion(item) {
  if (!item?.question) throw new Error("选择题缺少 question 字段");
  if (!Array.isArray(item.options) || item.options.length !== 4) {
    throw new Error(`选择题「${item.question}」必须有四个 options`);
  }

  const labels = ["A", "B", "C", "D"];
  const normalizedAnswer = normalizeAnswerLabel(item.correctAnswer, item.options);
  if (!labels.includes(normalizedAnswer)) {
    throw new Error(`选择题「${item.question}」的 correctAnswer 必须是 A/B/C/D`);
  }

  const wrongOptionExplanations = {};
  labels.forEach((label) => {
    wrongOptionExplanations[label] =
      item.wrongOptionExplanations?.[label] || item.wrongOptionExplanations?.[label.toLowerCase()] || "";
  });

  return {
    question: String(item.question),
    options: item.options.map((option, index) => normalizeOption(option, labels[index])),
    correctAnswer: normalizedAnswer,
    explanation: String(item.explanation || ""),
    wrongOptionExplanations,
    relatedNoteSection: String(item.relatedNoteSection || "未标注章节"),
    difficulty: String(item.difficulty || "适中")
  };
}

function normalizeSubjectiveQuestion(item) {
  if (!item?.question) throw new Error("大题缺少 question 字段");
  const allowedTypes = ["short_answer", "proof", "calculation"];
  const questionType = allowedTypes.includes(item.questionType) ? item.questionType : "short_answer";
  return {
    question: String(item.question),
    questionType,
    referenceAnswer: String(item.referenceAnswer || ""),
    gradingRubric: String(item.gradingRubric || ""),
    relatedNoteSection: String(item.relatedNoteSection || "未标注章节"),
    difficulty: String(item.difficulty || "适中")
  };
}

function normalizeOption(option, label) {
  const text = String(option || "").trim();
  if (/^[A-D][.、]/i.test(text)) return text.replace(/^([a-d])/, (value) => value.toUpperCase());
  return `${label}. ${text}`;
}

function normalizeAnswerLabel(answer, options) {
  const value = String(answer || "").trim();
  const label = /^[A-D]/i.exec(value)?.[0]?.toUpperCase();
  if (label) return label;

  const optionIndex = options.findIndex((option) => String(option).trim() === value);
  if (optionIndex >= 0) return ["A", "B", "C", "D"][optionIndex];
  return value;
}

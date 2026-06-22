import { noteExcerpt } from "../utils/markdown.js";
import { toPromptJson } from "../services/ai/jsonRepair.js";

export function buildGradingMessages({ note, question, textAnswer, imageDataUrl }) {
  const schema = {
    isCorrect: false,
    score: 0,
    recognizedAnswer: "识别出的用户答案或解题过程",
    stepScores: [
      {
        criterion: "评分步骤或评分点",
        maxScore: 20,
        awardedScore: 0,
        feedback: "该步骤得分依据"
      }
    ],
    earliestErrorStep: "最早发生错误的步骤；完全正确时为空字符串",
    errorLocation: "错误所在的公式、推导或答案片段；完全正确时为空字符串",
    errorCategory: "concept | calculation | reasoning | omission | expression | none | other",
    reason: "判定理由",
    strengths: ["做得好的地方"],
    weaknesses: ["不足或错误点"],
    needsTeaching: true
  };

  const prompt = `你是中文助学软件的判题模型。请根据题目、参考答案、评分标准和用户答案判题。

要求：
- 必须只输出合法 JSON，不允许 Markdown 代码块。
- 如果用户上传了图片，请识别图片中的文字、公式或解题过程，并写入 recognizedAnswer。
- 如果你无法处理图片，请在 reason 中说明，并将 needsTeaching 设为 true。
- score 为 0 到 100 的数字。
- 必须把评分标准拆成 stepScores；每项包含 criterion、maxScore、awardedScore 和 feedback。
- stepScores 的 maxScore 总和应为 100，awardedScore 总和必须与 score 一致；若原评分标准不完整，请据题目合理拆分评分点。
- earliestErrorStep 必须指出用户解答中最早出现偏差的步骤，而不是最后的错误结论；完全正确时返回空字符串。
- errorLocation 应引用或概括具体错误位置；完全正确时返回空字符串。
- errorCategory 只能是 concept（概念错误）、calculation（计算失误）、reasoning（推理错误）、omission（步骤缺失）、expression（表达问题）、none 或 other。
- isCorrect 代表整体是否正确，不能只看格式。
- reason、strengths、weaknesses、recognizedAnswer 中如需写数学公式，必须使用标准 LaTeX：行内公式用 \\(...\\)，块级公式用 \\[...\\]。
- 不要使用未闭合的 $、$$、\\(、\\[，不要把 Markdown 加粗符号包在公式分隔符内，不要输出 Math input error。

输出 JSON Schema：
${toPromptJson(schema)}

题目：
${question.question}

参考答案：
${question.referenceAnswer || ""}

评分标准：
${question.gradingRubric || ""}

相关笔记摘录：
${noteExcerpt(note, 5000)}

用户文字答案：
${textAnswer || "[未填写文字答案]"}`;

  if (!imageDataUrl) {
    return [
      {
        role: "system",
        content: "你是严谨的中文判题教师，只返回合法 JSON。"
      },
      { role: "user", content: prompt }
    ];
  }

  return [
    {
      role: "system",
      content: "你是严谨的中文多模态判题教师，只返回合法 JSON。"
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl } }
      ]
    }
  ];
}

export function buildTeachingMessages({ note, question, answer, gradeResult }) {
  const schema = {
    aiExplanation: "结合用户错误的详细解析",
    targetedFeedback: "针对用户具体错误的教学反馈",
    reviewFocus: ["建议复习的知识点或笔记位置"],
    nextStep: "下一步练习建议"
  };

  return [
    {
      role: "system",
      content:
        "你是耐心的中文学习助手。请针对用户的具体错误讲解，不要只复述标准答案。必须只输出合法 JSON。数学公式必须使用标准 LaTeX，行内公式用 \\(...\\)，块级公式用 \\[...\\]，不要输出未闭合分隔符。"
    },
    {
      role: "user",
      content: `请根据判题结果，为用户生成针对性讲解。

公式书写要求：
- aiExplanation、targetedFeedback、nextStep 中如需公式，行内公式用 \\(...\\)，块级公式用 \\[...\\]。
- 不要混用 $ 和 \\(...\\)，不要输出无法渲染的 LaTeX 或 Math input error。

输出 JSON Schema：
${toPromptJson(schema)}

题目：
${question.question}

参考答案：
${question.referenceAnswer || ""}

评分标准：
${question.gradingRubric || ""}

用户答案：
${answer.textAnswer || "[无文字答案]"}

判题模型识别与理由：
${toPromptJson(gradeResult)}

相关笔记：
${noteExcerpt(note, 7000)}`
    }
  ];
}

export function normalizeGradeResult(data) {
  if (!data || typeof data !== "object") {
    throw new Error("判题模型返回的 JSON 顶层必须是对象");
  }

  let score = clamp(Number(data.score), 0, 100);
  const stepScores = Array.isArray(data.stepScores)
    ? data.stepScores.slice(0, 20).map((item, index) => {
        const maxScore = clamp(Number(item?.maxScore), 0, 100);
        return {
          criterion: String(item?.criterion || `评分点 ${index + 1}`),
          maxScore,
          awardedScore: clamp(Number(item?.awardedScore), 0, maxScore),
          feedback: String(item?.feedback || "")
        };
      })
    : [];
  const rubricMaxScore = stepScores.reduce((sum, item) => sum + item.maxScore, 0);
  const rubricAwardedScore = stepScores.reduce((sum, item) => sum + item.awardedScore, 0);
  const rubricConsistent = stepScores.length === 0 || Math.abs(rubricMaxScore - 100) < 0.01;
  if (rubricMaxScore > 0 && rubricConsistent) score = Math.round(rubricAwardedScore);
  const errorCategory = ["concept", "calculation", "reasoning", "omission", "expression", "none", "other"].includes(data.errorCategory)
    ? data.errorCategory
    : Boolean(data.isCorrect)
      ? "none"
      : "other";

  return {
    isCorrect: Boolean(data.isCorrect),
    score,
    recognizedAnswer: String(data.recognizedAnswer || ""),
    stepScores,
    rubricMaxScore,
    rubricAwardedScore,
    rubricConsistent,
    earliestErrorStep: String(data.earliestErrorStep || ""),
    errorLocation: String(data.errorLocation || ""),
    errorCategory,
    reason: String(data.reason || ""),
    strengths: Array.isArray(data.strengths) ? data.strengths.map(String) : [],
    weaknesses: Array.isArray(data.weaknesses) ? data.weaknesses.map(String) : [],
    needsTeaching: Boolean(data.needsTeaching)
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

import { noteExcerpt } from "../utils/markdown.js";
import { toPromptJson } from "../services/ai/jsonRepair.js";

export function buildWrongAnalysisMessages({ note, wrongItems }) {
  const schema = {
    weakKnowledgePoints: ["薄弱知识点"],
    commonErrorPatterns: ["常见错误模式"],
    recommendedSections: ["推荐复习的笔记章节"],
    suggestedQuestionTypes: ["建议重新练习的题型"],
    studyAdvice: "一段简短学习建议"
  };

  const compactWrongItems = wrongItems.map((item) => ({
    section: item.section,
    questionType: item.questionType,
    questionContent: item.questionContent,
    userAnswer: item.userAnswer,
    correctAnswer: item.correctAnswer,
    errorReason: item.errorReason
  }));

  return [
    {
      role: "system",
      content:
        "你是中文学习诊断助手。请根据错题记录分析薄弱点，必须只输出合法 JSON，不允许 Markdown。"
    },
    {
      role: "user",
      content: `请分析下面这份笔记对应的错题记录，指出薄弱点和复习位置。

输出 JSON Schema：
${toPromptJson(schema)}

错题记录：
${toPromptJson(compactWrongItems)}

笔记内容：
${noteExcerpt(note, 9000)}`
    }
  ];
}

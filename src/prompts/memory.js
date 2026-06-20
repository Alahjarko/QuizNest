import { toPromptJson } from "../services/ai/jsonRepair.js";

export function buildMemoryUpdateMessages({ memories, wrongItems, notes, recentMessages, learningProgress }) {
  const evidence = {
    existingMemories: memories.slice(0, 50).map((item) => ({
      id: item.id,
      category: item.category,
      content: item.content,
      source: item.source
    })),
    recentWrongItems: wrongItems.slice(0, 40).map((item) => ({
      section: item.section,
      questionType: item.questionType,
      questionContent: compact(item.questionContent, 500),
      errorReason: compact(item.errorReason, 500),
      mastered: Boolean(item.mastered),
      reviewCount: Number(item.reviewCount || 0)
    })),
    recentNotes: notes.slice(0, 20).map((note) => ({
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt || note.createdAt
    })),
    recentUserMessages: recentMessages.slice(0, 24).map((message) => compact(message.content, 500)),
    learningProgress: learningProgress.slice(0, 20).map((item) => ({
      noteTitle: item.noteTitle,
      sectionTitle: item.sectionTitle,
      sectionIndex: item.sectionIndex,
      totalSections: item.totalSections,
      updatedAt: item.updatedAt
    }))
  };

  return [
    {
      role: "system",
      content: `你负责维护 QuizNest 的本地长期学习记忆。只根据提供的证据整理稳定、对未来教学有帮助的信息。

记忆分类只能是：weakness（常错知识点）、style（偏好讲题风格）、recent（近期学习内容）、custom（其他长期信息）。

返回严格 JSON：
{
  "updates": [{"id":"现有记忆ID","category":"weakness|style|recent|custom","content":"更新后的简洁内容"}],
  "creates": [{"category":"weakness|style|recent|custom","content":"新记忆"}],
  "deleteIds": ["应删除的过时AI记忆ID"]
}

要求：
- 合并重复信息，避免把一次性对话写成永久偏好。
- 常错知识点必须有错题证据；偏好风格必须有用户表达证据。
- 近期学习内容最多保留 5 条，优先记录最近笔记和章节。
- 可以更新现有记忆；只有明显过时或重复时才删除。
- 不要记录 API Key、URL、文件路径或完整题目答案。
- 每条 content 不超过 120 个中文字符。`
    },
    {
      role: "user",
      content: `请根据以下本地学习证据更新记忆：\n${toPromptJson(evidence)}`
    }
  ];
}

function compact(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

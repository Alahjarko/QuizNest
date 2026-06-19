export function buildAnswerMap(answers) {
  return new Map((answers || []).map((answer) => [answer.questionId, answer]));
}

export function getSetLastPracticeAt(set, answers = []) {
  const answerTimes = answers
    .map((answer) => answer.submittedAt || answer.updatedAt)
    .filter(Boolean)
    .sort()
    .reverse();
  return set.lastPracticeAt || answerTimes[0] || "";
}

export function summarizeQuestionSet({ set, note, questions = [], answers = [] }) {
  const answerMap = buildAnswerMap(answers);
  const total = questions.length || Number(set.choiceCount || 0) + Number(set.subjectiveCount || 0);
  const submittedAnswers = questions
    .map((question) => answerMap.get(question.id))
    .filter((answer) => answer?.submitted);
  const draftAnswers = answers.filter((answer) => !answer.submitted && (answer.selectedOption || answer.textAnswer || answer.imageDataUrl));
  const correct = submittedAnswers.filter((answer) => answer.isCorrect).length;
  const scoreValues = submittedAnswers.map((answer) => Number(answer.score)).filter((score) => Number.isFinite(score));
  const averageScore = scoreValues.length
    ? Math.round(scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length)
    : null;
  const submitted = submittedAnswers.length;
  const complete = total > 0 && submitted >= total;
  const started = submitted > 0 || draftAnswers.length > 0;
  const lastPracticeAt = getSetLastPracticeAt(set, answers);

  return {
    id: set.id,
    title: set.title || "未命名题组",
    noteTitle: note?.title || "未知笔记",
    noteId: set.noteId,
    choiceCount: Number(set.choiceCount || questions.filter((question) => question.type === "choice").length || 0),
    subjectiveCount: Number(set.subjectiveCount || questions.filter((question) => question.type === "subjective").length || 0),
    difficulty: set.difficulty || "适中",
    createdAt: set.createdAt,
    lastPracticeAt,
    total,
    submitted,
    correct,
    averageScore,
    accuracy: submitted ? Math.round((correct / submitted) * 100) : null,
    status: complete ? "completed" : started ? "in_progress" : "not_started",
    statusLabel: complete ? "已完成" : started ? "进行中" : "未开始"
  };
}

export function metricText(summary) {
  if (!summary.submitted) return "暂无得分";
  if (summary.averageScore !== null) return `平均 ${summary.averageScore} 分 · 正确率 ${summary.accuracy}%`;
  return `正确率 ${summary.accuracy}%`;
}

export function sortSetsByActivity(summaries) {
  return [...summaries].sort((a, b) => {
    const aTime = a.lastPracticeAt || a.createdAt || "";
    const bTime = b.lastPracticeAt || b.createdAt || "";
    return String(bTime).localeCompare(String(aTime));
  });
}

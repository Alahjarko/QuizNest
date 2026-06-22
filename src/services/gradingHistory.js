import { createId, nowIso } from "../utils/ids.js";
import { getByIndex, put } from "./storage/db.js";

export const GRADING_ERROR_CATEGORIES = [
  { value: "none", label: "无明确错误" },
  { value: "concept", label: "概念错误" },
  { value: "calculation", label: "计算失误" },
  { value: "reasoning", label: "推理或步骤错误" },
  { value: "omission", label: "步骤缺失" },
  { value: "expression", label: "表达不清" },
  { value: "other", label: "其他" }
];

const VALID_ERROR_CATEGORIES = new Set(GRADING_ERROR_CATEGORIES.map((item) => item.value));

export async function recordGradingAttempt({
  question,
  answer,
  result = null,
  status = "success",
  source = "ai",
  context = "practice",
  wrongItemId = "",
  errorMessage = "",
  supersedesAttemptId = "",
  correctionNote = ""
}) {
  const createdAt = nowIso();
  const attempt = {
    id: createId("grading"),
    questionId: question?.id || answer?.questionId || "",
    answerId: answer?.id || answer?.questionId || question?.id || "",
    noteId: question?.noteId || answer?.noteId || "",
    setId: question?.setId || answer?.setId || "",
    wrongItemId: wrongItemId || "",
    source: source === "manual" ? "manual" : "ai",
    context,
    status: status === "error" ? "error" : "success",
    result: result ? JSON.parse(JSON.stringify(result)) : null,
    errorMessage: String(errorMessage || ""),
    supersedesAttemptId: String(supersedesAttemptId || ""),
    correctionNote: String(correctionNote || "").trim().slice(0, 500),
    questionSnapshot: {
      question: String(question?.question || ""),
      referenceAnswer: String(question?.referenceAnswer || question?.correctAnswer || ""),
      gradingRubric: String(question?.gradingRubric || ""),
      relatedNoteSection: String(question?.relatedNoteSection || "")
    },
    answerSnapshot: {
      textAnswer: String(answer?.textAnswer || answer?.selectedOption || ""),
      imageName: String(answer?.imageName || ""),
      hasImage: Boolean(answer?.imageDataUrl)
    },
    createdAt
  };
  await put("gradingAttempts", attempt);
  return attempt;
}

export async function recordGradingFailure(options) {
  return recordGradingAttempt({ ...options, status: "error", result: null });
}

export async function getGradingAttempts(questionId) {
  if (!questionId) return [];
  return (await getByIndex("gradingAttempts", "questionId", questionId)).sort((a, b) =>
    String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
  );
}

export async function applyManualGradingCorrection({ question, answer, score, isCorrect, errorCategory, reason, correctionNote }) {
  const normalizedScore = clamp(Number(score), 0, 100);
  const previous = answer?.gradeResult || {};
  let supersedesAttemptId = answer?.currentGradingAttemptId || "";
  if (!supersedesAttemptId && answer?.gradeResult) {
    const legacyAttempt = await recordGradingAttempt({
      question,
      answer,
      result: previous,
      source: "ai",
      context: "legacy"
    });
    supersedesAttemptId = legacyAttempt.id;
  }
  const result = {
    ...previous,
    score: normalizedScore,
    isCorrect: Boolean(isCorrect),
    errorCategory: isCorrect ? "none" : normalizeErrorCategory(errorCategory),
    earliestErrorStep: isCorrect ? "" : String(previous.earliestErrorStep || ""),
    errorLocation: isCorrect ? "" : String(previous.errorLocation || ""),
    reason: String(reason || previous.reason || "用户手动纠正判题结果").trim(),
    needsTeaching: !isCorrect,
    manualCorrection: true,
    manualScoreOverride: Array.isArray(previous.stepScores) && previous.stepScores.length > 0
  };
  const attempt = await recordGradingAttempt({
    question,
    answer,
    result,
    source: "manual",
    context: "correction",
    supersedesAttemptId,
    correctionNote
  });
  const updatedAnswer = {
    ...answer,
    isCorrect: result.isCorrect,
    score: result.score,
    gradeResult: result,
    currentGradingAttemptId: attempt.id,
    manuallyCorrected: true,
    gradingCorrectedAt: attempt.createdAt,
    updatedAt: attempt.createdAt
  };
  await put("answers", updatedAnswer);
  return { attempt, result, answer: updatedAnswer };
}

export function normalizeErrorCategory(value) {
  return VALID_ERROR_CATEGORIES.has(value) ? value : "other";
}

export function gradingErrorCategoryLabel(value) {
  return GRADING_ERROR_CATEGORIES.find((item) => item.value === value)?.label || "其他";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

import { nowIso } from "../utils/ids.js";
import { get, getAll, put, putMany, removeMany } from "./storage/db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function knowledgePointId(noteId, label) {
  return `kp_${hashText(`${noteId || "global"}|${normalizeLabel(label)}`)}`;
}

export async function ensureKnowledgePoint({ noteId, label, sourceType = "", sourceId = "" }) {
  const cleanLabel = String(label || "未标注章节").trim() || "未标注章节";
  const id = knowledgePointId(noteId, cleanLabel);
  const existing = await get("knowledgePoints", id);
  const now = nowIso();
  const point = {
    ...existing,
    id,
    noteId: noteId || "global",
    label: existing?.label || cleanLabel,
    normalizedLabel: normalizeLabel(cleanLabel),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await put("knowledgePoints", point);
  if (sourceType && sourceId) {
    await put("knowledgeLinks", buildLink(point, sourceType, sourceId));
  }
  return point;
}

export async function syncKnowledgeGraph() {
  const [notes, questions, answers, wrongItems, chatMessages, memories, learningProgress, gradingAttempts, reviewLogs, existingPoints, existingLinks] =
    await Promise.all([
      getAll("notes"),
      getAll("questions"),
      getAll("answers"),
      getAll("wrongItems"),
      getAll("chatMessages"),
      getAll("learningMemories"),
      getAll("learningProgress"),
      getAll("gradingAttempts"),
      getAll("reviewLogs"),
      getAll("knowledgePoints"),
      getAll("knowledgeLinks")
    ]);

  const now = nowIso();
  const existingPointMap = new Map(existingPoints.map((item) => [item.id, item]));
  const points = new Map();
  const links = new Map();
  const noteSectionMap = new Map();

  const register = (noteId, label, sourceType, sourceId) => {
    const cleanLabel = String(label || "未标注章节").trim() || "未标注章节";
    const id = knowledgePointId(noteId, cleanLabel);
    const existing = existingPointMap.get(id);
    const point = points.get(id) || {
      ...existing,
      id,
      noteId: noteId || "global",
      label: existing?.label || cleanLabel,
      normalizedLabel: normalizeLabel(cleanLabel),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    points.set(id, point);
    if (sourceType && sourceId) {
      const link = buildLink(point, sourceType, sourceId);
      links.set(link.id, link);
    }
    return point;
  };

  notes.forEach((note) => {
    const sections = Array.isArray(note.sections) && note.sections.length ? note.sections : [{ id: "full", title: "全文" }];
    sections.forEach((section) => {
      const point = register(note.id, section.title || "未命名章节", "noteSection", `${note.id}:${section.id || section.title}`);
      noteSectionMap.set(`${note.id}:${section.id || ""}`, point);
      noteSectionMap.set(`${note.id}:label:${normalizeLabel(section.title)}`, point);
    });
  });

  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const wrongMap = new Map(wrongItems.map((item) => [item.id, item]));
  questions.forEach((question) => register(question.noteId, question.relatedNoteSection, "question", question.id));
  wrongItems.forEach((item) => register(item.noteId, item.section, "wrongItem", item.id));

  answers.forEach((answer) => {
    const question = questionMap.get(answer.questionId);
    if (question) register(question.noteId, question.relatedNoteSection, "answer", answer.id);
  });
  gradingAttempts.forEach((attempt) => {
    const question = questionMap.get(attempt.questionId);
    if (question) register(question.noteId, question.relatedNoteSection, "gradingAttempt", attempt.id);
  });
  reviewLogs.forEach((log) => {
    const question = questionMap.get(log.questionId);
    const wrongItem = wrongMap.get(log.wrongItemId);
    if (question || wrongItem) {
      register(question?.noteId || wrongItem?.noteId, question?.relatedNoteSection || wrongItem?.section, "reviewLog", log.id);
    }
  });
  learningProgress.forEach((progress) => {
    register(progress.noteId, progress.sectionTitle, "learningProgress", progress.id);
  });

  chatMessages.forEach((message) => {
    const point = resolveContextPoint(message, questionMap, wrongMap, noteSectionMap, points);
    if (point) {
      const link = buildLink(point, "chatMessage", message.id);
      links.set(link.id, link);
      return;
    }
    matchTextToPoints(message.content, message.noteId, points).forEach((matched) => {
      const link = buildLink(matched, "chatMessage", message.id);
      links.set(link.id, link);
    });
  });

  memories.forEach((memory) => {
    matchTextToPoints(memory.content, "", points).forEach((point) => {
      const link = buildLink(point, "learningMemory", memory.id);
      links.set(link.id, link);
    });
  });

  if (points.size) await putMany("knowledgePoints", [...points.values()]);
  if (links.size) await putMany("knowledgeLinks", [...links.values()]);

  const staleDerivedIds = existingLinks.filter((link) => link.sourceMode !== "manual" && !links.has(link.id)).map((link) => link.id);
  if (staleDerivedIds.length) await removeMany("knowledgeLinks", staleDerivedIds);

  return { points: [...points.values()], links: [...links.values()] };
}

export async function getKnowledgeMasterySnapshot() {
  const { points, links } = await syncKnowledgeGraph();
  const [answers, wrongItems, gradingAttempts, reviewLogs, reviewCards, notes] = await Promise.all([
    getAll("answers"),
    getAll("wrongItems"),
    getAll("gradingAttempts"),
    getAll("reviewLogs"),
    getAll("reviewCards"),
    getAll("notes")
  ]);
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const linksByPoint = groupBy(links, (link) => link.knowledgePointId);
  const attemptsByQuestion = groupBy(gradingAttempts.filter((item) => item.status === "success"), (item) => item.questionId);

  return points
    .map((point) => {
      const pointLinks = linksByPoint.get(point.id) || [];
      const sourceIds = sourceIdsByType(pointLinks);
      const questionIds = new Set(sourceIds.question || []);
      const pointWrongItems = wrongItems.filter((item) => (sourceIds.wrongItem || []).includes(item.id));
      const evidence = [];

      answers
        .filter((answer) => questionIds.has(answer.questionId) && answer.submitted && !answer.gradingPending && !attemptsByQuestion.has(answer.questionId))
        .forEach((answer) => addEvidence(evidence, answer.score ?? (answer.isCorrect ? 100 : 0), answer.submittedAt || answer.updatedAt, 1, "answer"));
      gradingAttempts
        .filter((attempt) => questionIds.has(attempt.questionId) && attempt.status === "success" && attempt.result)
        .forEach((attempt) => addEvidence(evidence, attempt.result.score, attempt.createdAt, attempt.source === "manual" ? 1.25 : 1, "grading"));
      reviewLogs
        .filter((log) => log.knowledgePointId === point.id || questionIds.has(log.questionId))
        .forEach((log) => addEvidence(evidence, log.score ?? ratingScore(log.rating), log.reviewedAt, 1.35, "review"));
      pointWrongItems.forEach((item) => {
        addEvidence(evidence, item.mastered ? 82 : 25, item.lastReviewedAt || item.createdAt, item.mastered ? 0.45 : 0.8, "wrong");
      });

      const mastery = computeMastery(evidence);
      const typeCounts = countBy(pointWrongItems, (item) => item.questionType || "other");
      const dueCard = reviewCards
        .filter((card) => card.knowledgePointId === point.id && !card.suspended)
        .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0];
      return {
        ...point,
        noteTitle: noteMap.get(point.noteId)?.title || "已删除笔记",
        masteryScore: mastery.score,
        evidenceCount: evidence.length,
        trend: mastery.trend,
        recentAccuracy: mastery.recentAccuracy,
        status: mastery.score === null ? "unknown" : mastery.score < 60 ? "weak" : mastery.score < 80 ? "developing" : "strong",
        wrongCount: pointWrongItems.filter((item) => !item.mastered).length,
        questionTypeErrors: typeCounts,
        chatCount: (sourceIds.chatMessage || []).length,
        memoryCount: (sourceIds.learningMemory || []).length,
        nextDueAt: dueCard?.dueAt || "",
        nextAction: nextActionFor({ mastery, pointWrongItems, dueCard })
      };
    })
    .sort((a, b) => {
      const aScore = a.masteryScore ?? 101;
      const bScore = b.masteryScore ?? 101;
      return aScore - bScore || b.wrongCount - a.wrongCount || a.label.localeCompare(b.label, "zh-CN");
    });
}

function buildLink(point, sourceType, sourceId) {
  return {
    id: `kl_${hashText(`${point.id}|${sourceType}|${sourceId}`)}`,
    knowledgePointId: point.id,
    noteId: point.noteId,
    sourceType,
    sourceId,
    sourceMode: "derived",
    createdAt: nowIso()
  };
}

function resolveContextPoint(message, questionMap, wrongMap, noteSectionMap, points) {
  const contextKey = String(message.contextKey || "");
  const learningMatch = contextKey.match(/^learn:([^:]+):section:(.+)$/);
  if (learningMatch) return noteSectionMap.get(`${learningMatch[1]}:${learningMatch[2]}`);
  const questionId = [...questionMap.keys()].find((id) => contextKey.includes(id));
  if (questionId) {
    const question = questionMap.get(questionId);
    return points.get(knowledgePointId(question.noteId, question.relatedNoteSection));
  }
  const wrongId = [...wrongMap.keys()].find((id) => contextKey.includes(id));
  if (wrongId) {
    const item = wrongMap.get(wrongId);
    return points.get(knowledgePointId(item.noteId, item.section));
  }
  return null;
}

function matchTextToPoints(text, noteId, points) {
  const normalizedText = normalizeLabel(text);
  if (!normalizedText) return [];
  return [...points.values()].filter(
    (point) => (!noteId || noteId === point.noteId) && point.normalizedLabel.length >= 2 && normalizedText.includes(point.normalizedLabel)
  );
}

function computeMastery(evidence) {
  if (!evidence.length) return { score: null, trend: 0, recentAccuracy: null };
  const now = Date.now();
  let weighted = 0;
  let totalWeight = 0;
  evidence.forEach((item) => {
    const ageDays = Math.max(0, (now - Date.parse(item.at || nowIso())) / DAY_MS);
    const weight = item.weight * Math.exp(-ageDays / 90);
    weighted += item.value * weight;
    totalWeight += weight;
  });
  const rawScore = totalWeight ? weighted / totalWeight : 0;
  const confidence = Math.min(1, totalWeight / 4);
  const score = Math.round(50 + (rawScore - 50) * confidence);
  const chronological = evidence.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const midpoint = Math.floor(chronological.length / 2);
  const older = chronological.slice(0, midpoint);
  const newer = chronological.slice(midpoint);
  const trend = chronological.length >= 4 ? Math.round(average(newer) - average(older)) : 0;
  const recent = chronological.filter((item) => now - Date.parse(item.at || 0) <= 30 * DAY_MS);
  return { score: clamp(score, 0, 100), trend, recentAccuracy: recent.length ? Math.round(average(recent)) : null };
}

function addEvidence(list, score, at, weight, source) {
  const value = clamp(Number(score), 0, 100);
  list.push({ value, at: at || nowIso(), weight, source });
}

function nextActionFor({ mastery, pointWrongItems, dueCard }) {
  if (dueCard && Date.parse(dueCard.dueAt || 0) <= endOfToday()) return "完成今日安排的错题复习";
  if (pointWrongItems.some((item) => !item.mastered)) return "先订正未掌握错题，再做一道同类题";
  if (mastery.score !== null && mastery.score < 70) return "回看对应章节，并完成一次针对性练习";
  if (mastery.trend < -8) return "近期表现回落，建议安排一次巩固复习";
  return "按当前节奏继续练习";
}

function sourceIdsByType(links) {
  const result = {};
  links.forEach((link) => {
    if (!result[link.sourceType]) result[link.sourceType] = [];
    result[link.sourceType].push(link.sourceId);
  });
  return result;
}

function groupBy(values, keyFn) {
  const groups = new Map();
  values.forEach((value) => {
    const key = keyFn(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  });
  return groups;
}

function countBy(values, keyFn) {
  const counts = {};
  values.forEach((value) => {
    const key = keyFn(value);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function average(items) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item.value, 0) / items.length;
}

function ratingScore(rating) {
  return { again: 20, hard: 60, good: 82, easy: 100 }[rating] ?? 50;
}

function normalizeLabel(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 120);
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function endOfToday() {
  const value = new Date();
  value.setHours(23, 59, 59, 999);
  return value.getTime();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

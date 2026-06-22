import { createId, nowIso } from "../utils/ids.js";
import { ensureKnowledgePoint } from "./knowledgeGraph.js";
import { get, getAll, put, putMany } from "./storage/db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RATING_ORDER = ["again", "hard", "good", "easy"];

export async function syncReviewCardsFromWrongItems() {
  const [wrongItems, questions, existingCards] = await Promise.all([
    getAll("wrongItems"),
    getAll("questions"),
    getAll("reviewCards")
  ]);
  const questionMap = new Map(questions.map((item) => [item.id, item]));
  const existingByWrong = new Map(existingCards.map((item) => [item.wrongItemId, item]));
  const activeWrongIds = new Set(wrongItems.map((item) => item.id));
  const cards = [];

  for (const wrongItem of wrongItems) {
    const question = questionMap.get(wrongItem.questionId);
    const point = await ensureKnowledgePoint({
      noteId: wrongItem.noteId || question?.noteId,
      label: wrongItem.section || question?.relatedNoteSection,
      sourceType: "wrongItem",
      sourceId: wrongItem.id
    });
    const existing = existingByWrong.get(wrongItem.id);
    cards.push(buildInitialCard({ wrongItem, question, point, existing }));
  }

  existingCards
    .filter((card) => card.wrongItemId && !activeWrongIds.has(card.wrongItemId) && !card.orphaned)
    .forEach((card) => cards.push({ ...card, orphaned: true, suspended: true, updatedAt: nowIso() }));

  if (cards.length) await putMany("reviewCards", cards);
  return cards;
}

export async function ensureReviewCard({ wrongItem, question }) {
  const existing = await get("reviewCards", reviewCardId(wrongItem.id));
  const point = await ensureKnowledgePoint({
    noteId: wrongItem.noteId || question?.noteId,
    label: wrongItem.section || question?.relatedNoteSection,
    sourceType: "wrongItem",
    sourceId: wrongItem.id
  });
  const card = buildInitialCard({ wrongItem, question, point, existing });
  await put("reviewCards", card);
  return card;
}

export async function getDueReviewQueue({ through = endOfToday() } = {}) {
  await syncReviewCardsFromWrongItems();
  const [cards, wrongItems] = await Promise.all([getAll("reviewCards"), getAll("wrongItems")]);
  const wrongMap = new Map(wrongItems.map((item) => [item.id, item]));
  return cards
    .filter((card) => !card.suspended && !card.orphaned && wrongMap.has(card.wrongItemId) && Date.parse(card.dueAt || 0) <= through)
    .map((card) => ({ card, wrongItem: wrongMap.get(card.wrongItemId) }))
    .sort((a, b) => String(a.card.dueAt).localeCompare(String(b.card.dueAt)) || a.card.difficulty - b.card.difficulty);
}

export async function getReviewCardMap() {
  await syncReviewCardsFromWrongItems();
  return new Map((await getAll("reviewCards")).map((card) => [card.wrongItemId, card]));
}

export async function recordReviewOutcome({ wrongItem, question, rating, score, isCorrect, gradingAttemptId = "" }) {
  const normalizedRating = RATING_ORDER.includes(rating) ? rating : ratingFromPerformance({ score, isCorrect });
  const current = await ensureReviewCard({ wrongItem, question });
  const reviewedAt = nowIso();
  const next = scheduleNext(current, normalizedRating, reviewedAt);
  const log = {
    id: createId("review"),
    cardId: current.id,
    questionId: question?.id || wrongItem.questionId || "",
    wrongItemId: wrongItem.id,
    knowledgePointId: current.knowledgePointId,
    rating: normalizedRating,
    score: clamp(Number(score), 0, 100),
    isCorrect: Boolean(isCorrect),
    previousDueAt: current.dueAt,
    nextDueAt: next.dueAt,
    stabilityBefore: current.stability,
    stabilityAfter: next.stability,
    difficultyBefore: current.difficulty,
    difficultyAfter: next.difficulty,
    gradingAttemptId,
    reviewedAt
  };
  await put("reviewCards", next);
  await put("reviewLogs", log);
  return { card: next, log };
}

export function ratingFromPerformance({ score, isCorrect }) {
  const normalizedScore = Number(score);
  if (!isCorrect || !Number.isFinite(normalizedScore) || normalizedScore < 50) return "again";
  if (normalizedScore < 75) return "hard";
  if (normalizedScore >= 95) return "easy";
  return "good";
}

export async function setReviewCardSuspended(wrongItemId, suspended) {
  const card = await get("reviewCards", reviewCardId(wrongItemId));
  if (!card) return null;
  const updated = { ...card, suspended: Boolean(suspended), updatedAt: nowIso() };
  await put("reviewCards", updated);
  return updated;
}

export async function orphanReviewCard(wrongItemId) {
  const card = await get("reviewCards", reviewCardId(wrongItemId));
  if (!card) return null;
  const updated = { ...card, orphaned: true, suspended: true, updatedAt: nowIso() };
  await put("reviewCards", updated);
  return updated;
}

export function formatReviewDue(dueAt, now = new Date()) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "待安排";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(due);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target - today) / DAY_MS);
  if (days < 0) return `逾期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return `${days} 天后`;
}

function buildInitialCard({ wrongItem, question, point, existing }) {
  if (existing) {
    return {
      ...existing,
      noteId: wrongItem.noteId || question?.noteId || existing.noteId,
      setId: wrongItem.setId || question?.setId || existing.setId,
      questionId: wrongItem.questionId || question?.id || existing.questionId,
      wrongItemId: wrongItem.id,
      knowledgePointId: point.id,
      orphaned: false,
      updatedAt: existing.updatedAt || nowIso()
    };
  }
  const now = nowIso();
  const legacyMastered = Boolean(wrongItem.mastered);
  const dueAt = legacyMastered
    ? addDays(wrongItem.lastReviewedAt || now, 14)
    : normalizePastDue(wrongItem.lastReviewedAt || wrongItem.createdAt || now);
  return {
    id: reviewCardId(wrongItem.id),
    noteId: wrongItem.noteId || question?.noteId || "",
    setId: wrongItem.setId || question?.setId || "",
    questionId: wrongItem.questionId || question?.id || "",
    wrongItemId: wrongItem.id,
    knowledgePointId: point.id,
    state: legacyMastered ? "review" : "learning",
    difficulty: 5,
    stability: legacyMastered ? 14 : 0.4,
    dueAt,
    lastReviewAt: wrongItem.lastReviewedAt || "",
    scheduledDays: legacyMastered ? 14 : 0,
    reps: legacyMastered ? Math.max(1, Number(wrongItem.reviewCount || 0)) : Number(wrongItem.reviewCount || 0),
    lapses: 0,
    suspended: false,
    orphaned: false,
    createdAt: wrongItem.createdAt || now,
    updatedAt: now
  };
}

function scheduleNext(card, rating, reviewedAt) {
  const reps = Number(card.reps || 0) + 1;
  const lapses = Number(card.lapses || 0) + (rating === "again" ? 1 : 0);
  const difficultyDelta = { again: 0.9, hard: 0.35, good: -0.2, easy: -0.55 }[rating];
  const difficulty = clamp(Number(card.difficulty || 5) + difficultyDelta, 1, 10);
  const elapsedDays = card.lastReviewAt ? Math.max(0, (Date.parse(reviewedAt) - Date.parse(card.lastReviewAt)) / DAY_MS) : 0;
  const oldStability = Math.max(0.2, Number(card.stability || 0.4));
  const retrievability = Math.exp(-elapsedDays / oldStability);
  let stability;
  let scheduledDays;

  if (reps === 1 || !card.lastReviewAt) {
    stability = { again: 0.2, hard: 1, good: 3, easy: 7 }[rating];
  } else if (rating === "again") {
    stability = Math.max(0.2, oldStability * 0.45);
  } else {
    const growth = { hard: 1.2, good: 1.85, easy: 2.65 }[rating];
    stability = Math.max(1, oldStability * (growth + (1 - retrievability) * 0.5));
  }

  if (rating === "again") scheduledDays = 0;
  else if (rating === "hard") scheduledDays = Math.max(1, Math.round(stability * 0.8));
  else if (rating === "good") scheduledDays = Math.max(2, Math.round(stability));
  else scheduledDays = Math.max(4, Math.round(stability * 1.3));

  const dueAt = rating === "again" ? new Date(Date.parse(reviewedAt) + 10 * 60 * 1000).toISOString() : addDays(reviewedAt, scheduledDays);
  return {
    ...card,
    state: "review",
    difficulty: round(difficulty),
    stability: round(stability),
    dueAt,
    lastReviewAt: reviewedAt,
    scheduledDays,
    reps,
    lapses,
    suspended: false,
    orphaned: false,
    updatedAt: reviewedAt
  };
}

function reviewCardId(wrongItemId) {
  return `review_${wrongItemId}`;
}

function normalizePastDue(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return nowIso();
  return new Date(Math.min(parsed, Date.now())).toISOString();
}

function addDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nowIso();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString();
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

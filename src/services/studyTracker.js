import { get, getAll, put } from "./storage/db.js";

const STORE = "studyDays";
let timerStarted = false;

export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getTodayRecord() {
  const id = todayKey();
  return (
    (await get(STORE, id)) || {
      id,
      date: id,
      practicedQuestions: 0,
      submittedAnswers: 0,
      correctAnswers: 0,
      wrongReviews: 0,
      studyMs: 0,
      checkedIn: false,
      updatedAt: new Date().toISOString()
    }
  );
}

export async function addStudyTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const record = await getTodayRecord();
  await put(STORE, {
    ...record,
    studyMs: Number(record.studyMs || 0) + ms,
    updatedAt: new Date().toISOString()
  });
}

export async function recordPracticeAnswer(isCorrect) {
  const record = await getTodayRecord();
  await put(STORE, {
    ...record,
    practicedQuestions: Number(record.practicedQuestions || 0) + 1,
    submittedAnswers: Number(record.submittedAnswers || 0) + 1,
    correctAnswers: Number(record.correctAnswers || 0) + (isCorrect ? 1 : 0),
    updatedAt: new Date().toISOString()
  });
}

export async function recordWrongReview(isCorrect) {
  const record = await getTodayRecord();
  await put(STORE, {
    ...record,
    practicedQuestions: Number(record.practicedQuestions || 0) + 1,
    submittedAnswers: Number(record.submittedAnswers || 0) + 1,
    correctAnswers: Number(record.correctAnswers || 0) + (isCorrect ? 1 : 0),
    wrongReviews: Number(record.wrongReviews || 0) + 1,
    checkedIn: true,
    updatedAt: new Date().toISOString()
  });
}

export async function markCheckIn() {
  const record = await getTodayRecord();
  await put(STORE, {
    ...record,
    checkedIn: true,
    updatedAt: new Date().toISOString()
  });
}

export async function getStudyDashboard() {
  const days = await getAll(STORE);
  const today = (await getTodayRecord()) || {};
  const dayMap = new Map(days.map((day) => [day.id, day]));
  dayMap.set(today.id, today);
  const totalMs = [...dayMap.values()].reduce((sum, item) => sum + Number(item.studyMs || 0), 0);
  return {
    today,
    totalMs,
    streak: computeStreak(days)
  };
}

export function startStudyTimer({ isActive }) {
  if (timerStarted) return;
  timerStarted = true;
  let lastTick = Date.now();

  window.setInterval(async () => {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (document.visibilityState !== "visible") return;
    if (!isActive()) return;
    await addStudyTime(Math.min(elapsed, 60000));
  }, 30000);
}

export function formatDuration(ms) {
  const minutes = Math.floor(Number(ms || 0) / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function computeStreak(days) {
  const checked = new Set(days.filter((day) => day.checkedIn).map((day) => day.date));
  let streak = 0;
  const cursor = new Date();

  while (checked.has(todayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

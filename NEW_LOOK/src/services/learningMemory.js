import { buildMemoryUpdateMessages } from "../prompts/memory.js";
import { createId, nowIso } from "../utils/ids.js";
import { callJsonCompletion } from "./ai/aiClient.js";
import { get, getAll, put, remove } from "./storage/db.js";

const MEMORY_SETTINGS_ID = "default";
const VALID_CATEGORIES = new Set(["weakness", "style", "recent", "custom"]);

export const MEMORY_CATEGORY_LABELS = {
  weakness: "常错知识点",
  style: "讲题偏好",
  recent: "近期学习",
  custom: "其他"
};

export async function getMemorySettings() {
  return (await get("memorySettings", MEMORY_SETTINGS_ID)) || {
    id: MEMORY_SETTINGS_ID,
    enabled: true,
    updatedAt: nowIso()
  };
}

export async function setMemoryEnabled(enabled) {
  return put("memorySettings", {
    ...(await getMemorySettings()),
    id: MEMORY_SETTINGS_ID,
    enabled: Boolean(enabled),
    updatedAt: nowIso()
  });
}

export async function getLearningMemories() {
  return (await getAll("learningMemories")).sort((a, b) =>
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  );
}

export async function getActiveLearningMemories() {
  const settings = await getMemorySettings();
  if (!settings.enabled) return [];
  return (await getLearningMemories()).filter((item) => item.enabled !== false && item.content).slice(0, 30);
}

export async function saveLearningMemory(memory) {
  const now = nowIso();
  const content = String(memory?.content || "").trim().slice(0, 500);
  if (!content) throw new Error("记忆内容不能为空");
  return put("learningMemories", {
    id: memory?.id || createId("memory"),
    category: normalizeCategory(memory?.category),
    content,
    enabled: memory?.enabled !== false,
    source: memory?.source === "ai" ? "ai" : "user",
    lastEditedBy: memory?.lastEditedBy === "ai" ? "ai" : "user",
    createdAt: memory?.createdAt || now,
    updatedAt: now
  });
}

export async function deleteLearningMemory(id) {
  return remove("learningMemories", id);
}

export async function updateMemoriesWithAi() {
  const [memories, wrongItems, notes, chatMessages, learningProgress] = await Promise.all([
    getLearningMemories(),
    getAll("wrongItems"),
    getAll("notes"),
    getAll("chatMessages"),
    getAll("learningProgress")
  ]);

  const result = await callJsonCompletion({
    role: "chat",
    messages: buildMemoryUpdateMessages({
      memories,
      wrongItems: newestFirst(wrongItems),
      notes: newestFirst(notes),
      recentMessages: newestFirst(chatMessages.filter((item) => item.role === "user")),
      learningProgress: newestFirst(learningProgress)
    }),
    temperature: 0.1,
    timeoutMs: 120000
  });

  return applyMemoryPlan(result, memories);
}

export function buildMemoryMarkdown(memories) {
  const groups = Object.keys(MEMORY_CATEGORY_LABELS).map((category) => ({
    category,
    title: MEMORY_CATEGORY_LABELS[category],
    items: memories.filter((item) => item.enabled !== false && item.category === category && item.content)
  }));
  const sections = groups
    .filter((group) => group.items.length)
    .map((group) => `## ${group.title}\n\n${group.items.map((item) => `- ${item.content}`).join("\n")}`);
  return `# QuizNest Learning Memory\n\n> 此文件由 QuizNest 本地长期记忆导出。\n\n${sections.join("\n\n") || "暂无记忆。"}\n`;
}

async function applyMemoryPlan(plan, existingMemories) {
  const existing = new Map(existingMemories.map((item) => [item.id, item]));
  let updated = 0;
  let created = 0;
  let deleted = 0;

  for (const entry of Array.isArray(plan?.updates) ? plan.updates.slice(0, 30) : []) {
    const current = existing.get(String(entry?.id || ""));
    const content = String(entry?.content || "").trim();
    if (!current || !content) continue;
    await saveLearningMemory({
      ...current,
      category: normalizeCategory(entry.category || current.category),
      content,
      lastEditedBy: "ai"
    });
    updated += 1;
  }

  for (const entry of Array.isArray(plan?.creates) ? plan.creates.slice(0, 12) : []) {
    const content = String(entry?.content || "").trim();
    if (!content || isDuplicate(content, existingMemories)) continue;
    await saveLearningMemory({
      category: normalizeCategory(entry.category),
      content,
      source: "ai",
      lastEditedBy: "ai"
    });
    created += 1;
  }

  for (const id of Array.isArray(plan?.deleteIds) ? plan.deleteIds.slice(0, 20) : []) {
    const current = existing.get(String(id));
    if (!current || current.source !== "ai") continue;
    await deleteLearningMemory(current.id);
    deleted += 1;
  }

  return { updated, created, deleted };
}

function normalizeCategory(category) {
  return VALID_CATEGORIES.has(category) ? category : "custom";
}

function newestFirst(items) {
  return items.slice().sort((a, b) =>
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  );
}

function isDuplicate(content, memories) {
  const normalized = content.replace(/\s+/g, "").toLowerCase();
  return memories.some((item) => String(item.content || "").replace(/\s+/g, "").toLowerCase() === normalized);
}

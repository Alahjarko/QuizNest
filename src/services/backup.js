import { getAll, putMany } from "./storage/db.js";

const BACKUP_KIND = "quiznest.learning-backup";
const BACKUP_VERSION = 2;

export const BACKUP_STORES = [
  "profile",
  "notebooks",
  "notes",
  "questionSets",
  "questions",
  "answers",
  "wrongItems",
  "chatMessages",
  "studyDays",
  "modelUsage",
  "learningMemories",
  "memorySettings",
  "learningProgress",
  "gradingAttempts",
  "knowledgePoints",
  "knowledgeLinks",
  "reviewCards",
  "reviewLogs"
];

export async function buildLearningBackup() {
  const stores = {};

  await Promise.all(
    BACKUP_STORES.map(async (storeName) => {
      stores[storeName] = await getAll(storeName);
    })
  );

  return {
    kind: BACKUP_KIND,
    app: "QuizNest",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    stores,
    counts: countStores(stores)
  };
}

export async function importLearningBackup(rawBackup) {
  const backup = parseLearningBackup(rawBackup);
  const stores = backup.stores;
  const imported = {};
  const skipped = {};

  for (const storeName of BACKUP_STORES) {
    const rows = Array.isArray(stores[storeName]) ? stores[storeName] : [];
    const validRows = rows.filter((row) => row && typeof row === "object" && row.id);
    if (validRows.length > 0) {
      await putMany(storeName, validRows);
    }
    imported[storeName] = validRows.length;
    skipped[storeName] = rows.length - validRows.length;
  }

  return {
    imported,
    skipped,
    totalImported: Object.values(imported).reduce((sum, count) => sum + count, 0),
    exportedAt: backup.exportedAt || ""
  };
}

export function backupFileName(date = new Date()) {
  return `quiznest-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function parseLearningBackup(rawBackup) {
  let backup = rawBackup;
  if (typeof rawBackup === "string") {
    const text = rawBackup.replace(/^\uFEFF/, "").trim();
    if (!text) {
      throw new Error("备份文件为空，请重新导出后再导入");
    }

    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error("备份文件不是合法 JSON，可能是下载未完成或文件内容被修改");
    }
  }

  if (!backup || typeof backup !== "object") {
    throw new Error("备份文件格式不正确");
  }

  const stores = backup.stores || backup.data;
  if (!stores || typeof stores !== "object") {
    throw new Error("备份文件缺少 stores 数据");
  }

  if (backup.kind && backup.kind !== BACKUP_KIND) {
    throw new Error("这不是 QuizNest 学习数据备份文件");
  }

  return { ...backup, stores };
}

function countStores(stores) {
  return Object.fromEntries(
    BACKUP_STORES.map((storeName) => [storeName, Array.isArray(stores[storeName]) ? stores[storeName].length : 0])
  );
}

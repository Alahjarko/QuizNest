import { getAll, getSettings, putMany } from "./storage/db.js";

const BACKUP_KIND = "quiznest.learning-backup";
const BACKUP_VERSION = 2;
const SETTINGS_LOCAL_ONLY_FIELDS = [
  "apiKey",
  "commonApiKey",
  "webdavPassword",
  "homeHeroImageDataUrl",
  "homeHeroImageName"
];
const ROLE_CONFIG_KEYS = ["questionConfig", "noteConfig", "gradingConfig", "chatConfig"];

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
  "reviewLogs",
  "settings"
];

export async function buildLearningBackup(includeDeleted = false) {
  const stores = {};

  await Promise.all(
    BACKUP_STORES.map(async (storeName) => {
      stores[storeName] = await getAll(storeName, includeDeleted);
      if (storeName === "settings") {
        stores[storeName] = stores[storeName].map(sanitizeSettingsForBackup);
      }
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

export function mergeSyncData(localStores, remoteStores) {
  const mergedStores = {};
  
  for (const storeName of BACKUP_STORES) {
    const localArr = Array.isArray(localStores[storeName]) ? localStores[storeName] : [];
    const remoteArr = Array.isArray(remoteStores[storeName]) ? remoteStores[storeName] : [];
    
    const localMap = new Map();
    localArr.forEach(item => { if (item && item.id) localMap.set(item.id, item); });
    
    const remoteMap = new Map();
    remoteArr.forEach(item => { if (item && item.id) remoteMap.set(item.id, item); });
    
    const mergedMap = new Map();
    
    for (const [id, localItem] of localMap.entries()) {
      mergedMap.set(id, localItem);
    }
    
    for (const [id, remoteItem] of remoteMap.entries()) {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, remoteItem);
      } else {
        const localItem = mergedMap.get(id);
        const localTime = localItem.updatedAt || localItem.createdAt || "";
        const remoteTime = remoteItem.updatedAt || remoteItem.createdAt || "";
        
        if (remoteTime > localTime) {
          mergedMap.set(id, remoteItem);
        }
        
        if (storeName === "settings") {
          const winner = mergedMap.get(id);
          if (winner === remoteItem) {
            winner.homeHeroImageDataUrl = localItem.homeHeroImageDataUrl || "";
            winner.homeHeroImageName = localItem.homeHeroImageName || "";
            
            // Protect local API keys so they are not wiped by remote
            winner.apiKey = localItem.apiKey || "";
            winner.commonApiKey = localItem.commonApiKey || "";
            if (winner.questionConfig && localItem.questionConfig) winner.questionConfig.apiKey = localItem.questionConfig.apiKey || "";
            if (winner.noteConfig && localItem.noteConfig) winner.noteConfig.apiKey = localItem.noteConfig.apiKey || "";
            if (winner.gradingConfig && localItem.gradingConfig) winner.gradingConfig.apiKey = localItem.gradingConfig.apiKey || "";
            if (winner.chatConfig && localItem.chatConfig) winner.chatConfig.apiKey = localItem.chatConfig.apiKey || "";

            // Protect WebDAV password
            winner.webdavPassword = localItem.webdavPassword || "";
          }
        }
      }
    }
    mergedStores[storeName] = Array.from(mergedMap.values());
  }
  
  return mergedStores;
}

export function sanitizeSettingsForBackup(settings) {
  const sanitized = { ...settings };
  for (const field of SETTINGS_LOCAL_ONLY_FIELDS) {
    sanitized[field] = "";
  }
  for (const configKey of ROLE_CONFIG_KEYS) {
    if (sanitized[configKey]) {
      sanitized[configKey] = { ...sanitized[configKey], apiKey: "" };
    }
  }
  return sanitized;
}

export function preserveLocalOnlySettings(settings, localSettings = {}) {
  if (!settings || typeof settings !== "object") return settings;

  const preserved = { ...settings };
  for (const field of SETTINGS_LOCAL_ONLY_FIELDS) {
    preserved[field] = localSettings[field] || "";
  }
  for (const configKey of ROLE_CONFIG_KEYS) {
    const localConfig = localSettings[configKey];
    const targetConfig = preserved[configKey];
    if (targetConfig || localConfig?.apiKey) {
      preserved[configKey] = {
        ...(targetConfig && typeof targetConfig === "object" ? targetConfig : {}),
        apiKey: localConfig?.apiKey || ""
      };
    }
  }
  return preserved;
}

export function preserveLocalOnlySettingsInStores(stores, localSettings = {}) {
  if (!stores || typeof stores !== "object" || !Array.isArray(stores.settings)) {
    return stores;
  }

  return {
    ...stores,
    settings: stores.settings.map((settings) => preserveLocalOnlySettings(settings, localSettings))
  };
}

export async function importLearningBackup(rawBackup) {
  const backup = parseLearningBackup(rawBackup);
  const stores = backup.stores;
  const imported = {};
  const skipped = {};
  const localSettings = Array.isArray(stores.settings) && stores.settings.length > 0 ? await getSettings() : null;

  for (const storeName of BACKUP_STORES) {
    const rows = Array.isArray(stores[storeName]) ? stores[storeName] : [];
    let validRows = rows.filter((row) => row && typeof row === "object" && row.id);
    if (storeName === "settings" && localSettings) {
      validRows = validRows.map((row) => preserveLocalOnlySettings(row, localSettings));
    }
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

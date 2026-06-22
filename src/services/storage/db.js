const DB_NAME = "ai-study-assistant-db";
const DB_VERSION = 7;
const SETTINGS_ID = "default";

let dbPromise;

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function getOrCreateStore(db, transaction, name, keyPath = "id") {
  if (db.objectStoreNames.contains(name)) {
    return transaction.objectStore(name);
  }
  return db.createObjectStore(name, { keyPath });
}

export function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持 IndexedDB，本地数据无法保存"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;

      const settings = getOrCreateStore(db, tx, "settings");
      ensureIndex(settings, "updatedAt", "updatedAt");

      const profile = getOrCreateStore(db, tx, "profile");
      ensureIndex(profile, "updatedAt", "updatedAt");

      const notebooks = getOrCreateStore(db, tx, "notebooks");
      ensureIndex(notebooks, "createdAt", "createdAt");
      ensureIndex(notebooks, "updatedAt", "updatedAt");

      const notes = getOrCreateStore(db, tx, "notes");
      ensureIndex(notes, "createdAt", "createdAt");
      ensureIndex(notes, "fileName", "fileName");
      ensureIndex(notes, "notebookId", "notebookId");

      const questionSets = getOrCreateStore(db, tx, "questionSets");
      ensureIndex(questionSets, "noteId", "noteId");
      ensureIndex(questionSets, "createdAt", "createdAt");

      const questions = getOrCreateStore(db, tx, "questions");
      ensureIndex(questions, "noteId", "noteId");
      ensureIndex(questions, "setId", "setId");
      ensureIndex(questions, "type", "type");
      ensureIndex(questions, "relatedNoteSection", "relatedNoteSection");

      const answers = getOrCreateStore(db, tx, "answers");
      ensureIndex(answers, "noteId", "noteId");
      ensureIndex(answers, "setId", "setId");
      ensureIndex(answers, "questionId", "questionId");
      ensureIndex(answers, "submitted", "submitted");

      const wrongItems = getOrCreateStore(db, tx, "wrongItems");
      ensureIndex(wrongItems, "noteId", "noteId");
      ensureIndex(wrongItems, "section", "section");
      ensureIndex(wrongItems, "questionType", "questionType");
      ensureIndex(wrongItems, "mastered", "mastered");
      ensureIndex(wrongItems, "createdAt", "createdAt");

      const chatMessages = getOrCreateStore(db, tx, "chatMessages");
      ensureIndex(chatMessages, "noteId", "noteId");
      ensureIndex(chatMessages, "contextKey", "contextKey");
      ensureIndex(chatMessages, "createdAt", "createdAt");

      const studyDays = getOrCreateStore(db, tx, "studyDays");
      ensureIndex(studyDays, "date", "date");
      ensureIndex(studyDays, "checkedIn", "checkedIn");

      const modelUsage = getOrCreateStore(db, tx, "modelUsage");
      ensureIndex(modelUsage, "date", "date");
      ensureIndex(modelUsage, "role", "role");
      ensureIndex(modelUsage, "modelName", "modelName");
      ensureIndex(modelUsage, "createdAt", "createdAt");

      const learningMemories = getOrCreateStore(db, tx, "learningMemories");
      ensureIndex(learningMemories, "category", "category");
      ensureIndex(learningMemories, "enabled", "enabled");
      ensureIndex(learningMemories, "updatedAt", "updatedAt");

      const memorySettings = getOrCreateStore(db, tx, "memorySettings");
      ensureIndex(memorySettings, "updatedAt", "updatedAt");

      const learningProgress = getOrCreateStore(db, tx, "learningProgress");
      ensureIndex(learningProgress, "noteId", "noteId");
      ensureIndex(learningProgress, "updatedAt", "updatedAt");

      const gradingAttempts = getOrCreateStore(db, tx, "gradingAttempts");
      ensureIndex(gradingAttempts, "questionId", "questionId");
      ensureIndex(gradingAttempts, "answerId", "answerId");
      ensureIndex(gradingAttempts, "wrongItemId", "wrongItemId");
      ensureIndex(gradingAttempts, "source", "source");
      ensureIndex(gradingAttempts, "createdAt", "createdAt");

      const knowledgePoints = getOrCreateStore(db, tx, "knowledgePoints");
      ensureIndex(knowledgePoints, "noteId", "noteId");
      ensureIndex(knowledgePoints, "normalizedLabel", "normalizedLabel");
      ensureIndex(knowledgePoints, "updatedAt", "updatedAt");

      const knowledgeLinks = getOrCreateStore(db, tx, "knowledgeLinks");
      ensureIndex(knowledgeLinks, "knowledgePointId", "knowledgePointId");
      ensureIndex(knowledgeLinks, "sourceType", "sourceType");
      ensureIndex(knowledgeLinks, "sourceId", "sourceId");
      ensureIndex(knowledgeLinks, "noteId", "noteId");

      const reviewCards = getOrCreateStore(db, tx, "reviewCards");
      ensureIndex(reviewCards, "dueAt", "dueAt");
      ensureIndex(reviewCards, "questionId", "questionId");
      ensureIndex(reviewCards, "wrongItemId", "wrongItemId");
      ensureIndex(reviewCards, "knowledgePointId", "knowledgePointId");
      ensureIndex(reviewCards, "state", "state");

      const reviewLogs = getOrCreateStore(db, tx, "reviewLogs");
      ensureIndex(reviewLogs, "cardId", "cardId");
      ensureIndex(reviewLogs, "questionId", "questionId");
      ensureIndex(reviewLogs, "wrongItemId", "wrongItemId");
      ensureIndex(reviewLogs, "knowledgePointId", "knowledgePointId");
      ensureIndex(reviewLogs, "reviewedAt", "reviewedAt");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开 IndexedDB 失败"));
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 操作失败"));
  });
}

export async function getAll(storeName) {
  const db = await openDb();
  return requestToPromise(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

export async function get(storeName, id) {
  const db = await openDb();
  return requestToPromise(db.transaction(storeName, "readonly").objectStore(storeName).get(id));
}

export async function put(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error("保存失败"));
  });
}

export async function putMany(storeName, values) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    values.forEach((value) => store.put(value));
    tx.oncomplete = () => resolve(values);
    tx.onerror = () => reject(tx.error || new Error("批量保存失败"));
  });
}

export async function remove(storeName, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("删除失败"));
  });
}

export async function removeMany(storeName, ids) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("批量删除失败"));
  });
}

export async function getByIndex(storeName, indexName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index(indexName);
  return requestToPromise(index.getAll(value));
}

export async function saveSettings(settings) {
  return put("settings", {
    id: SETTINGS_ID,
    ...settings,
    updatedAt: new Date().toISOString()
  });
}

export async function getSettings() {
  return (await get("settings", SETTINGS_ID)) || {
    id: SETTINGS_ID,
    baseUrl: "",
    apiKey: "",
    questionModel: "",
    noteModel: "",
    gradingModel: "",
    chatModel: "",
    homeHeroImageDataUrl: "",
    homeHeroImageName: "",
    webdavUrl: "",
    webdavUsername: "",
    webdavPassword: "",
    webdavSyncFrequency: "manual",
    timeoutMs: 180000,
    useSeparateConfigs: false,
    gradingSupportsVision: true,
    enableThinking: true,
    questionConfig: {
      baseUrl: "",
      apiKey: "",
      modelName: "",
      supportsVision: true,
      enableThinking: true
    },
    noteConfig: {
      baseUrl: "",
      apiKey: "",
      modelName: "",
      supportsVision: true,
      enableThinking: true
    },
    gradingConfig: {
      baseUrl: "",
      apiKey: "",
      modelName: "",
      supportsVision: true,
      enableThinking: true
    },
    chatConfig: {
      baseUrl: "",
      apiKey: "",
      modelName: "",
      supportsVision: true,
      enableThinking: true
    }
  };
}

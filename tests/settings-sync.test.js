import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeSyncData,
  preserveLocalOnlySettingsInStores,
  sanitizeSettingsForBackup
} from "../src/services/backup.js";
import {
  mergeSettingsForSync,
  withAiConfigUpdatedAt
} from "../src/services/settingsSync.js";

function settings(overrides = {}) {
  return {
    id: "default",
    updatedAt: "2026-01-01T00:00:00.000Z",
    useSeparateConfigs: false,
    commonBaseUrl: "",
    baseUrl: "",
    commonApiKey: "",
    apiKey: "",
    questionModel: "",
    noteModel: "",
    gradingModel: "",
    chatModel: "",
    timeoutMs: 180000,
    questionConfig: { baseUrl: "", apiKey: "", modelName: "" },
    noteConfig: { baseUrl: "", apiKey: "", modelName: "" },
    gradingConfig: { baseUrl: "", apiKey: "", modelName: "" },
    chatConfig: { baseUrl: "", apiKey: "", modelName: "" },
    ...overrides
  };
}

function configuredSettings(overrides = {}) {
  return settings({
    commonBaseUrl: "https://example.invalid/v1",
    baseUrl: "https://example.invalid/v1",
    questionModel: "question-model",
    gradingModel: "grading-model",
    questionConfig: { baseUrl: "https://example.invalid/v1", apiKey: "", modelName: "question-model" },
    noteConfig: { baseUrl: "https://example.invalid/v1", apiKey: "", modelName: "" },
    gradingConfig: { baseUrl: "https://example.invalid/v1", apiKey: "", modelName: "grading-model" },
    chatConfig: { baseUrl: "https://example.invalid/v1", apiKey: "", modelName: "" },
    ...overrides
  });
}

test("legacy populated remote AI config survives a newer blank local settings row", () => {
  const local = settings({
    updatedAt: "2026-07-10T10:00:00.000Z",
    webdavUrl: "https://local.invalid/dav",
    webdavUsername: "local-user"
  });
  const remote = configuredSettings({
    updatedAt: "2026-07-09T10:00:00.000Z",
    webdavUrl: "https://remote.invalid/dav"
  });

  const merged = mergeSettingsForSync(local, remote);

  assert.equal(merged.commonBaseUrl, remote.commonBaseUrl);
  assert.equal(merged.questionModel, "question-model");
  assert.equal(merged.gradingModel, "grading-model");
  assert.equal(merged.questionConfig.baseUrl, remote.questionConfig.baseUrl);
  assert.equal(merged.webdavUrl, local.webdavUrl);
  assert.equal(merged.aiConfigUpdatedAt, remote.updatedAt);
});

test("newer blank legacy remote row cannot erase an existing local AI config", () => {
  const local = configuredSettings({ updatedAt: "2026-07-09T10:00:00.000Z" });
  const remote = settings({
    updatedAt: "2026-07-10T10:00:00.000Z",
    webdavUrl: "https://remote.invalid/dav"
  });

  const merged = mergeSettingsForSync(local, remote);

  assert.equal(merged.commonBaseUrl, local.commonBaseUrl);
  assert.equal(merged.questionModel, local.questionModel);
  assert.equal(merged.webdavUrl, remote.webdavUrl);
});

test("all separate role models and Base URLs move together from the valid side", () => {
  const local = settings({ updatedAt: "2026-07-10T10:00:00.000Z" });
  const remote = settings({
    updatedAt: "2026-07-09T10:00:00.000Z",
    useSeparateConfigs: true,
    questionConfig: { baseUrl: "https://question.invalid/v1", apiKey: "", modelName: "question-model" },
    noteConfig: { baseUrl: "https://note.invalid/v1", apiKey: "", modelName: "note-model" },
    gradingConfig: { baseUrl: "https://grading.invalid/v1", apiKey: "", modelName: "grading-model" },
    chatConfig: { baseUrl: "https://chat.invalid/v1", apiKey: "", modelName: "chat-model" }
  });

  const merged = mergeSettingsForSync(local, remote);

  assert.equal(merged.useSeparateConfigs, true);
  assert.equal(merged.questionConfig.baseUrl, "https://question.invalid/v1");
  assert.equal(merged.noteConfig.modelName, "note-model");
  assert.equal(merged.gradingConfig.baseUrl, "https://grading.invalid/v1");
  assert.equal(merged.chatConfig.modelName, "chat-model");
});

test("an explicit newer AI config revision can intentionally clear synced fields", () => {
  const local = configuredSettings({
    updatedAt: "2026-07-10T09:00:00.000Z",
    aiConfigUpdatedAt: "2026-07-10T09:00:00.000Z"
  });
  const remote = settings({
    updatedAt: "2026-07-10T10:00:00.000Z",
    aiConfigUpdatedAt: "2026-07-10T10:00:00.000Z"
  });

  const merged = mergeSettingsForSync(local, remote);

  assert.equal(merged.commonBaseUrl, "");
  assert.equal(merged.questionModel, "");
  assert.equal(merged.questionConfig.baseUrl, "");
});

test("saving unrelated settings does not advance the AI config revision", () => {
  const previous = configuredSettings({
    updatedAt: "2026-07-09T10:00:00.000Z",
    aiConfigUpdatedAt: "2026-07-08T10:00:00.000Z"
  });
  const next = { ...previous, webdavSyncFrequency: "startup" };

  const saved = withAiConfigUpdatedAt(next, previous, "2026-07-10T10:00:00.000Z");

  assert.equal(saved.aiConfigUpdatedAt, previous.aiConfigUpdatedAt);
});

test("changing a model advances the AI config revision", () => {
  const previous = configuredSettings({ aiConfigUpdatedAt: "2026-07-08T10:00:00.000Z" });
  const next = {
    ...previous,
    questionModel: "new-model",
    questionConfig: { ...previous.questionConfig, modelName: "new-model" }
  };

  const saved = withAiConfigUpdatedAt(next, previous, "2026-07-10T10:00:00.000Z");

  assert.equal(saved.aiConfigUpdatedAt, "2026-07-10T10:00:00.000Z");
});

test("sync payload stays credential-free while local credentials are restored", () => {
  const localRaw = configuredSettings({
    updatedAt: "2026-07-09T10:00:00.000Z",
    commonApiKey: "local-secret",
    apiKey: "local-secret",
    webdavPassword: "webdav-secret",
    questionConfig: {
      baseUrl: "https://example.invalid/v1",
      apiKey: "role-secret",
      modelName: "question-model"
    }
  });
  const local = sanitizeSettingsForBackup(localRaw);
  const remote = configuredSettings({ updatedAt: "2026-07-10T10:00:00.000Z" });
  const mergedStores = mergeSyncData({ settings: [local] }, { settings: [remote] });
  const synced = mergedStores.settings[0];

  assert.equal(synced.commonApiKey, "");
  assert.equal(synced.apiKey, "");
  assert.equal(synced.webdavPassword, "");
  assert.equal(synced.questionConfig.apiKey, "");

  const restored = preserveLocalOnlySettingsInStores(mergedStores, localRaw).settings[0];
  assert.equal(restored.commonApiKey, "local-secret");
  assert.equal(restored.webdavPassword, "webdav-secret");
  assert.equal(restored.questionConfig.apiKey, "role-secret");
});

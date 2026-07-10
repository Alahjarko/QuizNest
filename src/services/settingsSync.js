export const AI_CONFIG_ROLE_KEYS = ["questionConfig", "noteConfig", "gradingConfig", "chatConfig"];

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeRoleConfig(config, fallbackBaseUrl = "", fallbackModelName = "") {
  const source = config && typeof config === "object" ? config : {};
  return {
    baseUrl: cleanString(source.baseUrl) || fallbackBaseUrl,
    modelName: cleanString(source.modelName || source.model) || fallbackModelName,
    supportsVision: source.supportsVision !== false,
    enableThinking: source.enableThinking !== false
  };
}

export function createAiConfigSnapshot(settings = {}) {
  const useSeparateConfigs = settings.useSeparateConfigs === true;
  const rawRoles = Object.fromEntries(
    AI_CONFIG_ROLE_KEYS.map((key) => [key, settings[key] && typeof settings[key] === "object" ? settings[key] : {}])
  );
  const commonBaseUrl = cleanString(settings.commonBaseUrl || settings.baseUrl || rawRoles.questionConfig.baseUrl);
  const questionModel = cleanString(settings.questionModel || rawRoles.questionConfig.modelName || rawRoles.questionConfig.model);
  const noteModel = cleanString(settings.noteModel || rawRoles.noteConfig.modelName || rawRoles.noteConfig.model);
  const gradingModel = cleanString(settings.gradingModel || rawRoles.gradingConfig.modelName || rawRoles.gradingConfig.model);
  const chatModel = cleanString(settings.chatModel || rawRoles.chatConfig.modelName || rawRoles.chatConfig.model);

  const commonRoleBaseUrl = useSeparateConfigs ? "" : commonBaseUrl;
  return {
    useSeparateConfigs,
    commonBaseUrl,
    baseUrl: cleanString(settings.baseUrl || rawRoles.questionConfig.baseUrl || commonBaseUrl),
    questionModel,
    noteModel,
    gradingModel,
    chatModel,
    timeoutMs: Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : 180000,
    gradingSupportsVision: settings.gradingSupportsVision !== false,
    enableThinking: settings.enableThinking !== false,
    roles: {
      questionConfig: normalizeRoleConfig(rawRoles.questionConfig, commonRoleBaseUrl, useSeparateConfigs ? "" : questionModel),
      noteConfig: normalizeRoleConfig(rawRoles.noteConfig, commonRoleBaseUrl, useSeparateConfigs ? "" : noteModel),
      gradingConfig: normalizeRoleConfig(rawRoles.gradingConfig, commonRoleBaseUrl, useSeparateConfigs ? "" : gradingModel),
      chatConfig: normalizeRoleConfig(rawRoles.chatConfig, commonRoleBaseUrl, useSeparateConfigs ? "" : chatModel)
    }
  };
}

export function hasAiConnectionConfig(settings = {}) {
  const snapshot = createAiConfigSnapshot(settings);
  if (snapshot.commonBaseUrl || snapshot.baseUrl) return true;
  if (snapshot.questionModel || snapshot.noteModel || snapshot.gradingModel || snapshot.chatModel) return true;
  return AI_CONFIG_ROLE_KEYS.some((key) => {
    const role = snapshot.roles[key];
    return Boolean(role.baseUrl || role.modelName);
  });
}

export function resolveAiConfigUpdatedAt(settings = {}) {
  const explicitTimestamp = cleanString(settings.aiConfigUpdatedAt);
  if (explicitTimestamp) return explicitTimestamp;
  if (!hasAiConnectionConfig(settings)) return "";
  return cleanString(settings.updatedAt || settings.createdAt);
}

function aiConfigFingerprint(settings = {}) {
  return JSON.stringify(createAiConfigSnapshot(settings));
}

export function withAiConfigUpdatedAt(settings = {}, previousSettings = {}, now = new Date().toISOString()) {
  const changed = aiConfigFingerprint(settings) !== aiConfigFingerprint(previousSettings);
  const aiConfigUpdatedAt = changed
    ? now
    : cleanString(settings.aiConfigUpdatedAt) || resolveAiConfigUpdatedAt(previousSettings) || resolveAiConfigUpdatedAt(settings);
  return { ...settings, aiConfigUpdatedAt };
}

function recordTimestamp(record = {}) {
  return cleanString(record.updatedAt || record.createdAt);
}

function applyAiConfig(target, source, aiConfigUpdatedAt) {
  const snapshot = createAiConfigSnapshot(source);
  const merged = {
    ...target,
    useSeparateConfigs: snapshot.useSeparateConfigs,
    commonBaseUrl: snapshot.commonBaseUrl,
    baseUrl: snapshot.baseUrl,
    questionModel: snapshot.questionModel,
    noteModel: snapshot.noteModel,
    gradingModel: snapshot.gradingModel,
    chatModel: snapshot.chatModel,
    timeoutMs: snapshot.timeoutMs,
    gradingSupportsVision: snapshot.gradingSupportsVision,
    enableThinking: snapshot.enableThinking,
    aiConfigUpdatedAt
  };

  for (const configKey of AI_CONFIG_ROLE_KEYS) {
    const targetConfig = target[configKey] && typeof target[configKey] === "object" ? target[configKey] : {};
    const sourceConfig = source[configKey] && typeof source[configKey] === "object" ? source[configKey] : {};
    merged[configKey] = {
      ...targetConfig,
      ...sourceConfig,
      ...snapshot.roles[configKey],
      apiKey: ""
    };
  }

  return merged;
}

export function mergeSettingsForSync(localSettings = {}, remoteSettings = {}) {
  const localRecordTimestamp = recordTimestamp(localSettings);
  const remoteRecordTimestamp = recordTimestamp(remoteSettings);
  const remoteRecordWins = remoteRecordTimestamp > localRecordTimestamp;
  const recordWinner = remoteRecordWins ? remoteSettings : localSettings;
  const recordLoser = remoteRecordWins ? localSettings : remoteSettings;

  const localAiTimestamp = resolveAiConfigUpdatedAt(localSettings);
  const remoteAiTimestamp = resolveAiConfigUpdatedAt(remoteSettings);
  const remoteAiWins = remoteAiTimestamp > localAiTimestamp
    || (remoteAiTimestamp === localAiTimestamp && remoteRecordWins);
  const aiWinner = remoteAiWins ? remoteSettings : localSettings;
  const aiTimestamp = remoteAiWins ? remoteAiTimestamp : localAiTimestamp;

  return applyAiConfig({ ...recordLoser, ...recordWinner }, aiWinner, aiTimestamp);
}

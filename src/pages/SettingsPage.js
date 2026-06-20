import { callJsonCompletionWithConfig, resolveRoleConfig } from "../services/ai/aiClient.js";
import { backupFileName, buildLearningBackup, importLearningBackup } from "../services/backup.js";
import { getSettings, saveSettings } from "../services/storage/db.js";
import { showToast } from "../components/Toast.js";
import { confirmAction } from "../components/Modal.js";
import { downloadJson, readImageFile, readTextFile } from "../utils/file.js";
import { escapeHtml } from "../utils/markdown.js";
import { THEME_VALUES, getStoredTheme, setTheme } from "../services/theme.js";
import {
  bindMemorySettingsSection,
  getMemoryOverview,
  renderMemorySettingsSection
} from "../components/MemoryManager.js";

export async function renderSettingsPage(container, app) {
  app.setContext({ contextKey: "settings" });
  const [rawSettings, memoryOverview] = await Promise.all([getSettings(), getMemoryOverview()]);
  const settings = normalizeSettingsForForm(rawSettings);

  container.innerHTML = `
    <section class="settings-page-header">
      <div>
        <p class="page-kicker">Settings</p>
        <h1>设置</h1>
        <p>管理模型、外观、长期记忆与本地学习数据。</p>
      </div>
    </section>

    <nav class="settings-index" aria-label="设置分组">
      <button type="button" data-settings-jump="settings-model"><span>01</span>模型配置</button>
      <button type="button" data-settings-jump="settings-appearance"><span>02</span>外观</button>
      <button type="button" data-settings-jump="settings-memory"><span>03</span>长期记忆</button>
      <button type="button" data-settings-jump="settings-data"><span>04</span>数据管理</button>
    </nav>

    <form class="settings-form apple-form settings-model-form" data-settings-form id="settings-model">
      <div class="settings-group-intro">
        <p class="eyebrow">Model Configuration</p>
        <h2>模型配置</h2>
        <p>配置 OpenAI-compatible Chat Completions。默认共用一套 API，也可以按任务拆分服务。</p>
      </div>
      <section class="settings-section model-settings-section">
        <div class="section-heading inline">
          <div>
            <h2>通用配置</h2>
            <p>适合大多数兼容服务：同一个 Base URL 和 API Key，分别填写不同模型名。</p>
          </div>
          <label class="switch-row">
            <input name="useSeparateConfigs" type="checkbox" ${settings.useSeparateConfigs ? "checked" : ""} />
            <span>使用不同 API 配置</span>
          </label>
        </div>

        <div data-common-config class="model-config-body ${settings.useSeparateConfigs ? "hidden" : ""}">
          <label>
            <span>Base URL</span>
            <input name="commonBaseUrl" placeholder="https://api.openai.com/v1" value="${escapeHtml(settings.commonBaseUrl)}" />
          </label>
          ${renderSecretInput("commonApiKey", "API Key", settings.commonApiKey)}
          <div class="form-grid">
            <label>
              <span>出题模型名称</span>
              <input name="questionModel" placeholder="qwen-plus / gpt-4.1-mini" value="${escapeHtml(settings.questionModel)}" />
            </label>
            <label>
              <span>笔记模型名称</span>
              <input name="noteModel" placeholder="用于 PDF 生成 Markdown 笔记，留空则使用出题模型" value="${escapeHtml(settings.noteModel)}" />
            </label>
          </div>
          <div class="form-grid">
            <label>
              <span>判题模型名称</span>
              <input name="gradingModel" placeholder="建议支持视觉输入" value="${escapeHtml(settings.gradingModel)}" />
            </label>
            <label>
              <span>解惑模型名称（可选）</span>
              <input name="chatModel" placeholder="留空则使用出题模型" value="${escapeHtml(settings.chatModel)}" />
            </label>
          </div>
          <div class="form-grid">
            <label>
              <span>请求超时（毫秒）</span>
              <input name="timeoutMs" type="number" min="30000" step="10000" value="${Number(settings.timeoutMs || 180000)}" />
            </label>
          </div>
          <div class="status-box">
            图片/视觉输入和模型思考默认开启。上传图片答案时，QuizNest 会按 OpenAI-compatible 多模态消息发送给判题模型；请求会附带 enable_thinking=true。如果服务端不支持对应能力，会返回错误，请更换模型或只提交文字答案。
          </div>
          <div class="form-actions">
            <button class="secondary-button" type="button" data-test-role="question">测试出题模型</button>
            <button class="secondary-button" type="button" data-test-role="note">测试笔记模型</button>
            <button class="secondary-button" type="button" data-test-role="grading">测试判题模型</button>
            <button class="secondary-button" type="button" data-test-role="chat">测试解惑</button>
          </div>
        </div>
      </section>

      <div data-separate-configs class="separate-configs ${settings.useSeparateConfigs ? "" : "hidden"}">
        ${renderRoleConfig("question", "出题模型配置", "负责生成题目、解析、错题讲解和薄弱点分析。", settings.questionConfig)}
        ${renderRoleConfig("note", "笔记模型配置", "负责把 PDF 文本整理成 Markdown 笔记，并生成或抽取例题与答案。", settings.noteConfig)}
        ${renderRoleConfig("grading", "判题模型配置", "负责判断文字和图片答案。图片答案会默认以视觉输入发送，请选择实际支持图片的模型。", settings.gradingConfig)}
        ${renderRoleConfig("chat", "解惑对话配置（可选）", "留空时使用出题模型配置。", settings.chatConfig)}
      </div>

      <section class="settings-section appearance-section" id="settings-appearance">
        <div class="section-heading inline">
          <div>
            <p class="eyebrow">外观</p>
            <h2>主题</h2>
            <p>选择应用的整体配色。跟随系统时会自动匹配操作系统的浅色 / 深色设置。</p>
          </div>
        </div>
        <div class="theme-control">
          <div class="theme-segmented" data-theme-segmented role="group" aria-label="主题">
            ${renderThemeOptions(getStoredTheme())}
          </div>
          <p class="theme-hint">切换会立即生效，无需点击保存。</p>
        </div>

        <div class="section-heading inline">
          <div>
            <h2>首页封面</h2>
            <p>选择一张本地图片作为首页顶部背景。首页会自动叠加暗色遮罩，让标题和按钮保持可读。</p>
          </div>
        </div>
        <div class="hero-background-control">
          <div class="hero-background-preview ${settings.homeHeroImageDataUrl ? "has-image" : ""}" data-hero-image-preview>
            <div>
              <span>QuizNest Workspace</span>
              <strong>QuizNest</strong>
              <small>首页封面预览</small>
            </div>
          </div>
          <div class="hero-background-panel">
            <div class="form-actions">
              <label class="secondary-button file-button">
                选择背景图
                <input data-hero-image-input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden />
              </label>
              <button class="secondary-button" data-remove-hero-image type="button" ${settings.homeHeroImageDataUrl ? "" : "disabled"}>移除图片</button>
            </div>
            <input name="homeHeroImageDataUrl" type="hidden" value="${escapeHtml(settings.homeHeroImageDataUrl)}" />
            <input name="homeHeroImageName" type="hidden" value="${escapeHtml(settings.homeHeroImageName)}" />
            <p class="hint" data-hero-image-name>${settings.homeHeroImageName ? `当前图片：${escapeHtml(settings.homeHeroImageName)}` : "尚未设置首页封面图片。"}</p>
            <div class="status-box">建议使用横向图片。图片只保存在本机设置中，不会被上传到模型或导出到学习数据备份。</div>
          </div>
        </div>
      </section>

      <div class="form-actions sticky-actions">
        <button class="primary-button" type="submit">保存设置</button>
      </div>
      <p class="hint">API Key 会保存在本机浏览器 IndexedDB 中。请只在可信设备上使用。出题请求较重，建议超时设置为 180000-300000 毫秒。</p>
    </form>

    <div id="settings-memory" class="settings-anchor-section">
      ${renderMemorySettingsSection(memoryOverview)}
    </div>

    <section class="settings-section data-section" id="settings-data">
      <div class="section-heading inline">
        <div>
          <p class="eyebrow">数据管理</p>
          <h2>学习数据备份</h2>
          <p>导出笔记本、笔记、题组、题目、作答记录、错题本、聊天记录、长期记忆、学习进度、学习统计和模型用量。不会导出 Base URL、API Key 或模型配置。</p>
        </div>
      </div>
      <div class="backup-actions">
        <button class="primary-button" type="button" data-export-backup>导出学习数据</button>
        <label class="secondary-button file-button">
          导入学习数据
          <input type="file" accept="application/json,.json" data-import-backup hidden />
        </label>
      </div>
      <div class="status-box">导入会合并到当前本机数据中；如果记录 ID 相同，会用备份内容覆盖本机同一条记录。</div>
    </section>
  `;

  const form = container.querySelector("[data-settings-form]");
  bindSettingsInteractions(container, form);
  bindBackupActions(container, app);
  bindMemorySettingsSection(container);

  container.querySelectorAll("[data-settings-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      container.querySelector(`#${button.dataset.settingsJump}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSettings(readSettingsForm(form));
    showToast("设置已保存", "success");
  });
}

function bindBackupActions(container, app) {
  container.querySelector("[data-export-backup]")?.addEventListener("click", async () => {
    const button = container.querySelector("[data-export-backup]");
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "正在导出...";
    try {
      const backup = await buildLearningBackup();
      downloadJson(backupFileName(), backup);
      showToast("学习数据已导出", "success");
    } catch (error) {
      showToast(`导出失败：${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  });

  container.querySelector("[data-import-backup]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!confirmAction("确定导入这份学习数据备份？同 ID 的笔记、题目和作答记录会被备份内容覆盖。")) return;

    try {
      const text = await readTextFile(file);
      const result = await importLearningBackup(text);
      showToast(`导入完成：${result.totalImported} 条记录`, "success");
      app.refresh();
    } catch (error) {
      showToast(`导入失败：${error.message}`, "error");
    }
  });
}

const THEME_OPTION_LABELS = {
  light: "浅色",
  dark: "深色",
  auto: "跟随系统",
};

function renderThemeOptions(current) {
  return THEME_VALUES.map((value) => {
    const isActive = current === value;
    return `<button type="button" data-theme-value="${value}" class="theme-option${isActive ? " active" : ""}" aria-pressed="${isActive ? "true" : "false"}">${THEME_OPTION_LABELS[value]}</button>`;
  }).join("");
}

function bindSettingsInteractions(container, form) {
  const separateToggle = form.elements.useSeparateConfigs;
  const common = container.querySelector("[data-common-config]");
  const separate = container.querySelector("[data-separate-configs]");

  separateToggle.addEventListener("change", () => {
    common.classList.toggle("hidden", separateToggle.checked);
    separate.classList.toggle("hidden", !separateToggle.checked);
  });

  // 主题切换：即时生效，写入 localStorage。
  const themeSegmented = container.querySelector("[data-theme-segmented]");
  if (themeSegmented) {
    themeSegmented.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-value]");
      if (!button) return;
      const value = button.dataset.themeValue;
      setTheme(value);
      themeSegmented.innerHTML = renderThemeOptions(value);
    });
  }

  container.querySelectorAll("[data-toggle-secret]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = form.elements[button.dataset.toggleSecret];
      input.type = input.type === "password" ? "text" : "password";
      button.textContent = input.type === "password" ? "显示" : "隐藏";
    });
  });

  container.querySelectorAll("[data-test-role]").forEach((button) => {
    button.addEventListener("click", async () => {
      const role = button.dataset.testRole;
      const settings = readSettingsForm(form);
      await saveSettings(settings);
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = "测试中...";
      try {
        const config = resolveRoleConfig(settings, role);
        const result = await callJsonCompletionWithConfig({
          config,
          role,
          messages: [
            { role: "system", content: "你只返回合法 JSON。" },
            { role: "user", content: "请返回 {\"ok\":true,\"message\":\"连接成功\"}" }
          ],
          temperature: 0,
          timeoutMs: 60000
        });
        if (!result.ok) throw new Error("模型返回 JSON 中 ok 不是 true");
        showToast(`${roleLabel(role)}连接成功`, "success");
      } catch (error) {
        showToast(`${roleLabel(role)}测试失败：${error.message}`, "error");
      } finally {
        button.disabled = false;
        button.textContent = oldText;
      }
    });
  });

  bindHeroImageSettings(container, form);
}

function bindHeroImageSettings(container, form) {
  const fileInput = container.querySelector("[data-hero-image-input]");
  const removeButton = container.querySelector("[data-remove-hero-image]");
  const preview = container.querySelector("[data-hero-image-preview]");
  const nameLabel = container.querySelector("[data-hero-image-name]");
  const dataInput = form.elements.homeHeroImageDataUrl;
  const nameInput = form.elements.homeHeroImageName;

  const updatePreview = () => {
    const dataUrl = String(dataInput.value || "");
    const imageName = String(nameInput.value || "");
    preview.classList.toggle("has-image", Boolean(dataUrl));
    preview.style.setProperty("--settings-hero-bg", dataUrl ? `url("${dataUrl.replaceAll('"', '\\"')}")` : "none");
    removeButton.disabled = !dataUrl;
    nameLabel.textContent = imageName ? `当前图片：${imageName}` : "尚未设置首页封面图片。";
  };

  updatePreview();

  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      if (file.type === "image/svg+xml") {
        throw new Error("请上传 PNG、JPG、WebP、GIF 或 AVIF 图片");
      }
      const image = await readImageFile(file);
      dataInput.value = image.dataUrl;
      nameInput.value = image.name;
      updatePreview();
      showToast("首页封面已选择，保存设置后生效", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  removeButton?.addEventListener("click", () => {
    dataInput.value = "";
    nameInput.value = "";
    updatePreview();
    showToast("首页封面已移除，保存设置后生效", "success");
  });
}

function renderRoleConfig(role, title, description, config) {
  return `
    <section class="settings-section role-config">
      <div class="section-heading inline">
        <div>
          <h2>${title}</h2>
          <p>${description}</p>
        </div>
        <button class="secondary-button" type="button" data-test-role="${role}">测试连接</button>
      </div>
      <label>
        <span>Base URL</span>
        <input name="${role}BaseUrl" placeholder="https://api.openai.com/v1" value="${escapeHtml(config.baseUrl)}" />
      </label>
      ${renderSecretInput(`${role}ApiKey`, "API Key", config.apiKey)}
      <label>
        <span>模型名称</span>
        <input name="${role}ModelName" placeholder="${role === "chat" ? "留空则使用出题模型" : "模型名称"}" value="${escapeHtml(config.modelName)}" />
      </label>
      <div class="status-box">视觉输入和模型思考默认开启；请求会附带 enable_thinking=true。如果这里填写的模型不支持图片，请避免上传图片答案或换用多模态模型。</div>
    </section>
  `;
}

function renderSecretInput(name, label, value) {
  return `
    <label>
      <span>${label}</span>
      <div class="secret-input">
        <input name="${name}" type="password" placeholder="sk-..." value="${escapeHtml(value)}" />
        <button class="secondary-button" type="button" data-toggle-secret="${name}">显示</button>
      </div>
    </label>
  `;
}

function readSettingsForm(form) {
  const formData = new FormData(form);
  const useSeparateConfigs = form.elements.useSeparateConfigs.checked;
  const commonBaseUrl = String(formData.get("commonBaseUrl") || "").trim();
  const commonApiKey = String(formData.get("commonApiKey") || "").trim();
  const questionModel = String(formData.get("questionModel") || "").trim();
  const noteModel = String(formData.get("noteModel") || "").trim();
  const gradingModel = String(formData.get("gradingModel") || "").trim();
  const chatModel = String(formData.get("chatModel") || "").trim();
  const homeHeroImageDataUrl = String(formData.get("homeHeroImageDataUrl") || "");
  const homeHeroImageName = String(formData.get("homeHeroImageName") || "").trim();

  const settings = {
    useSeparateConfigs,
    commonBaseUrl,
    commonApiKey,
    baseUrl: commonBaseUrl,
    apiKey: commonApiKey,
    questionModel,
    noteModel,
    gradingModel,
    chatModel,
    homeHeroImageDataUrl,
    homeHeroImageName,
    gradingSupportsVision: true,
    enableThinking: true,
    timeoutMs: Number(formData.get("timeoutMs") || 180000),
    questionConfig: readRoleConfig(formData, "question"),
    noteConfig: readRoleConfig(formData, "note"),
    gradingConfig: readRoleConfig(formData, "grading"),
    chatConfig: readRoleConfig(formData, "chat")
  };

  if (!useSeparateConfigs) {
    settings.questionConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: questionModel,
      supportsVision: true,
      enableThinking: true
    };
    settings.noteConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: noteModel,
      supportsVision: true,
      enableThinking: true
    };
    settings.gradingConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: gradingModel,
      supportsVision: true,
      enableThinking: true
    };
    settings.chatConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: chatModel,
      supportsVision: true,
      enableThinking: true
    };
  } else {
    settings.baseUrl = settings.questionConfig.baseUrl;
    settings.apiKey = settings.questionConfig.apiKey;
    settings.questionModel = settings.questionConfig.modelName;
    settings.noteModel = settings.noteConfig.modelName;
    settings.gradingModel = settings.gradingConfig.modelName;
    settings.chatModel = settings.chatConfig.modelName;
    settings.gradingSupportsVision = settings.gradingConfig.supportsVision;
  }

  return settings;
}

function readRoleConfig(formData, role) {
  return {
    baseUrl: String(formData.get(`${role}BaseUrl`) || "").trim(),
    apiKey: String(formData.get(`${role}ApiKey`) || "").trim(),
    modelName: String(formData.get(`${role}ModelName`) || "").trim(),
    supportsVision: true,
    enableThinking: true
  };
}

function normalizeSettingsForForm(settings) {
  const commonBaseUrl = settings.commonBaseUrl || settings.baseUrl || settings.questionConfig?.baseUrl || "";
  const commonApiKey = settings.commonApiKey || settings.apiKey || settings.questionConfig?.apiKey || "";
  const questionModel = settings.questionModel || settings.questionConfig?.modelName || "";
  const noteModel = settings.noteModel || settings.noteConfig?.modelName || "";
  const gradingModel = settings.gradingModel || settings.gradingConfig?.modelName || "";
  const chatModel = settings.chatModel || settings.chatConfig?.modelName || "";
  const homeHeroImageDataUrl = settings.homeHeroImageDataUrl || "";
  const homeHeroImageName = settings.homeHeroImageName || "";

  return {
    ...settings,
    commonBaseUrl,
    commonApiKey,
    questionModel,
    noteModel,
    gradingModel,
    chatModel,
    homeHeroImageDataUrl,
    homeHeroImageName,
    gradingSupportsVision: true,
    enableThinking: true,
    questionConfig: normalizeRoleConfig(settings.questionConfig, commonBaseUrl, commonApiKey, questionModel),
    noteConfig: normalizeRoleConfig(settings.noteConfig, commonBaseUrl, commonApiKey, noteModel),
    gradingConfig: normalizeRoleConfig(settings.gradingConfig, commonBaseUrl, commonApiKey, gradingModel, settings.gradingSupportsVision),
    chatConfig: normalizeRoleConfig(settings.chatConfig, commonBaseUrl, commonApiKey, chatModel)
  };
}

function normalizeRoleConfig(config = {}, baseUrl = "", apiKey = "", modelName = "", supportsVision = false) {
  return {
    baseUrl: config.baseUrl || baseUrl,
    apiKey: config.apiKey || apiKey,
    modelName: config.modelName || modelName,
    supportsVision: true,
    enableThinking: config.enableThinking !== false
  };
}

function roleLabel(role) {
  return (
    {
      question: "出题模型",
      note: "笔记模型",
      grading: "判题模型",
      chat: "解惑"
    }[role] || "模型"
  );
}

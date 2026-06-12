import { callJsonCompletionWithConfig, resolveRoleConfig } from "../services/ai/aiClient.js";
import { backupFileName, buildLearningBackup, importLearningBackup } from "../services/backup.js";
import { getSettings, saveSettings } from "../services/storage/db.js";
import { showToast } from "../components/Toast.js";
import { confirmAction } from "../components/Modal.js";
import { downloadJson, readTextFile } from "../utils/file.js";
import { escapeHtml } from "../utils/markdown.js";

export async function renderSettingsPage(container, app) {
  app.setContext({ contextKey: "settings" });
  const settings = normalizeSettingsForForm(await getSettings());

  container.innerHTML = `
    <section class="page-header hero-panel">
      <div>
        <p class="eyebrow">QuizNest AI 配置</p>
        <h1>模型设置</h1>
        <p>配置 OpenAI-compatible Chat Completions。默认共用一套 API，也可以按出题、判题和解惑拆分模型。</p>
      </div>
    </section>

    <form class="settings-form apple-form" data-settings-form>
      <section class="settings-section">
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

        <div data-common-config class="${settings.useSeparateConfigs ? "hidden" : ""}">
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
              <span>判题模型名称</span>
              <input name="gradingModel" placeholder="建议支持视觉输入" value="${escapeHtml(settings.gradingModel)}" />
            </label>
          </div>
          <div class="form-grid">
            <label>
              <span>解惑模型名称（可选）</span>
              <input name="chatModel" placeholder="留空则使用出题模型" value="${escapeHtml(settings.chatModel)}" />
            </label>
            <label>
              <span>请求超时（毫秒）</span>
              <input name="timeoutMs" type="number" min="30000" step="10000" value="${Number(settings.timeoutMs || 180000)}" />
            </label>
          </div>
          <div class="status-box">
            图片/视觉输入默认开启。上传图片答案时，QuizNest 会按 OpenAI-compatible 多模态消息发送给判题模型；如果模型本身不支持图片，服务端会返回错误，请改用支持视觉的模型或只提交文字答案。
          </div>
          <div class="form-actions">
            <button class="secondary-button" type="button" data-test-role="question">测试出题模型</button>
            <button class="secondary-button" type="button" data-test-role="grading">测试判题模型</button>
            <button class="secondary-button" type="button" data-test-role="chat">测试解惑</button>
          </div>
        </div>
      </section>

      <div data-separate-configs class="separate-configs ${settings.useSeparateConfigs ? "" : "hidden"}">
        ${renderRoleConfig("question", "出题模型配置", "负责生成题目、解析、错题讲解和薄弱点分析。", settings.questionConfig)}
        ${renderRoleConfig("grading", "判题模型配置", "负责判断文字和图片答案。图片答案会默认以视觉输入发送，请选择实际支持图片的模型。", settings.gradingConfig)}
        ${renderRoleConfig("chat", "解惑对话配置（可选）", "留空时使用出题模型配置。", settings.chatConfig)}
      </div>

      <div class="form-actions sticky-actions">
        <button class="primary-button" type="submit">保存设置</button>
      </div>
      <p class="hint">API Key 会保存在本机浏览器 IndexedDB 中。请只在可信设备上使用。出题请求较重，建议超时设置为 180000-300000 毫秒。</p>
    </form>

    <section class="settings-section data-section">
      <div class="section-heading inline">
        <div>
          <p class="eyebrow">数据管理</p>
          <h2>学习数据备份</h2>
          <p>导出笔记本、笔记、题组、题目、作答记录、错题本、聊天记录、学习统计和模型用量。不会导出 Base URL、API Key 或模型配置。</p>
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

function bindSettingsInteractions(container, form) {
  const separateToggle = form.elements.useSeparateConfigs;
  const common = container.querySelector("[data-common-config]");
  const separate = container.querySelector("[data-separate-configs]");

  separateToggle.addEventListener("change", () => {
    common.classList.toggle("hidden", separateToggle.checked);
    separate.classList.toggle("hidden", !separateToggle.checked);
  });

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
      <div class="status-box">视觉输入默认开启；如果这里填写的模型不支持图片，请避免上传图片答案或换用多模态模型。</div>
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
  const gradingModel = String(formData.get("gradingModel") || "").trim();
  const chatModel = String(formData.get("chatModel") || "").trim();

  const settings = {
    useSeparateConfigs,
    commonBaseUrl,
    commonApiKey,
    baseUrl: commonBaseUrl,
    apiKey: commonApiKey,
    questionModel,
    gradingModel,
    chatModel,
    gradingSupportsVision: true,
    timeoutMs: Number(formData.get("timeoutMs") || 180000),
    questionConfig: readRoleConfig(formData, "question"),
    gradingConfig: readRoleConfig(formData, "grading"),
    chatConfig: readRoleConfig(formData, "chat")
  };

  if (!useSeparateConfigs) {
    settings.questionConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: questionModel,
      supportsVision: true
    };
    settings.gradingConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: gradingModel,
      supportsVision: true
    };
    settings.chatConfig = {
      baseUrl: commonBaseUrl,
      apiKey: commonApiKey,
      modelName: chatModel,
      supportsVision: true
    };
  } else {
    settings.baseUrl = settings.questionConfig.baseUrl;
    settings.apiKey = settings.questionConfig.apiKey;
    settings.questionModel = settings.questionConfig.modelName;
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
    supportsVision: true
  };
}

function normalizeSettingsForForm(settings) {
  const commonBaseUrl = settings.commonBaseUrl || settings.baseUrl || settings.questionConfig?.baseUrl || "";
  const commonApiKey = settings.commonApiKey || settings.apiKey || settings.questionConfig?.apiKey || "";
  const questionModel = settings.questionModel || settings.questionConfig?.modelName || "";
  const gradingModel = settings.gradingModel || settings.gradingConfig?.modelName || "";
  const chatModel = settings.chatModel || settings.chatConfig?.modelName || "";

  return {
    ...settings,
    commonBaseUrl,
    commonApiKey,
    questionModel,
    gradingModel,
    chatModel,
    gradingSupportsVision: true,
    questionConfig: normalizeRoleConfig(settings.questionConfig, commonBaseUrl, commonApiKey, questionModel),
    gradingConfig: normalizeRoleConfig(settings.gradingConfig, commonBaseUrl, commonApiKey, gradingModel, settings.gradingSupportsVision),
    chatConfig: normalizeRoleConfig(settings.chatConfig, commonBaseUrl, commonApiKey, chatModel)
  };
}

function normalizeRoleConfig(config = {}, baseUrl = "", apiKey = "", modelName = "", supportsVision = false) {
  return {
    baseUrl: config.baseUrl || baseUrl,
    apiKey: config.apiKey || apiKey,
    modelName: config.modelName || modelName,
    supportsVision: true
  };
}

function roleLabel(role) {
  return (
    {
      question: "出题模型",
      grading: "判题模型",
      chat: "解惑"
    }[role] || "模型"
  );
}

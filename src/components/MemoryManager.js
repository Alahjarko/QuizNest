import { confirmAction, openModal } from "./Modal.js";
import { showToast } from "./Toast.js";
import {
  MEMORY_CATEGORY_LABELS,
  buildMemoryMarkdown,
  deleteLearningMemory,
  getLearningMemories,
  getMemorySettings,
  saveLearningMemory,
  setMemoryEnabled,
  updateMemoriesWithAi
} from "../services/learningMemory.js";
import { downloadText } from "../utils/file.js";
import { escapeHtml } from "../utils/markdown.js";

export async function getMemoryOverview() {
  const [settings, memories] = await Promise.all([getMemorySettings(), getLearningMemories()]);
  return {
    enabled: settings.enabled !== false,
    total: memories.length,
    active: memories.filter((item) => item.enabled !== false).length
  };
}

export function renderMemorySettingsSection(overview) {
  return `
    <section class="settings-section memory-settings-section">
      <div class="section-heading inline">
        <div>
          <p class="eyebrow">长期使用</p>
          <h2>AI 长期记忆</h2>
          <p>在本机记录常错知识点、讲题偏好和近期学习内容，并在解惑时作为个性化上下文。</p>
        </div>
        <label class="switch-row">
          <input data-memory-enabled type="checkbox" ${overview.enabled ? "checked" : ""} />
          <span>启用长期记忆</span>
        </label>
      </div>
      <div class="memory-settings-summary">
        <div>
          <strong data-memory-count>${overview.active}</strong>
          <span>条启用记忆</span>
        </div>
        <p>记忆只保存在本机。AI 整理仅在你主动点击时调用模型，不会在每次聊天后额外消耗 token。</p>
        <button class="secondary-button" data-manage-memory type="button">管理长期记忆</button>
      </div>
    </section>`;
}

export function bindMemorySettingsSection(container) {
  container.querySelector("[data-memory-enabled]")?.addEventListener("change", async (event) => {
    await setMemoryEnabled(event.currentTarget.checked);
    showToast(event.currentTarget.checked ? "长期记忆已启用" : "长期记忆已停用", "success");
  });

  container.querySelector("[data-manage-memory]")?.addEventListener("click", () => {
    openMemoryManager(container);
  });
}

async function openMemoryManager(settingsContainer) {
  const content = document.createElement("div");
  content.className = "memory-manager";
  const modal = openModal({ title: "长期记忆", content, width: "860px" });

  const render = async () => {
    const memories = await getLearningMemories();
    content.innerHTML = `
      <div class="memory-manager-toolbar">
        <div>
          <strong>${memories.length} 条本地记忆</strong>
          <span>用户可以编辑全部记忆；AI 整理会基于本地错题和近期学习记录更新内容。</span>
        </div>
        <div class="form-actions">
          <button class="secondary-button" data-export-memory type="button">导出 memory.md</button>
          <button class="secondary-button" data-ai-memory type="button">AI 整理记忆</button>
          <button class="primary-button" data-add-memory type="button">添加记忆</button>
        </div>
      </div>
      <div class="status-box">AI 整理会调用当前“解惑模型”，因此会产生一次模型用量；用户手动编辑不会调用模型。</div>
      <div class="memory-list" data-memory-list>
        ${memories.length ? memories.map(renderMemoryRow).join("") : `<div class="empty-state compact">还没有长期记忆。可以手动添加，或让 AI 根据已有学习记录整理。</div>`}
      </div>
      ${memories.length ? `<div class="form-actions memory-save-actions"><button class="primary-button" data-save-memories type="button">保存全部修改</button></div>` : ""}
    `;

    content.querySelector("[data-add-memory]")?.addEventListener("click", async () => {
      await saveLearningMemory({ category: "custom", content: "新记忆", source: "user" });
      await render();
      const rows = content.querySelectorAll("[data-memory-row]");
      rows[rows.length - 1]?.querySelector("textarea")?.select();
    });

    content.querySelector("[data-save-memories]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await Promise.all(
          Array.from(content.querySelectorAll("[data-memory-row]")).map((row) => {
            const original = memories.find((item) => item.id === row.dataset.memoryRow);
            return saveLearningMemory({
              ...original,
              category: row.querySelector("select").value,
              content: row.querySelector("textarea").value,
              enabled: row.querySelector("input[type='checkbox']").checked,
              lastEditedBy: "user"
            });
          })
        );
        showToast("长期记忆已保存", "success");
        await render();
        await refreshOverview(settingsContainer);
      } catch (error) {
        showToast(`保存失败：${error.message}`, "error");
        button.disabled = false;
      }
    });

    content.querySelectorAll("[data-delete-memory]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!(await confirmAction("确定删除这条长期记忆？"))) return;
        await deleteLearningMemory(button.dataset.deleteMemory);
        showToast("记忆已删除", "success");
        await render();
        await refreshOverview(settingsContainer);
      });
    });

    content.querySelector("[data-ai-memory]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "AI 正在整理...";
      try {
        const result = await updateMemoriesWithAi();
        showToast(`AI 已整理：新增 ${result.created}，更新 ${result.updated}，删除 ${result.deleted}`, "success");
        await render();
        await refreshOverview(settingsContainer);
      } catch (error) {
        showToast(`AI 整理失败：${error.message}`, "error");
        button.disabled = false;
        button.textContent = "AI 整理记忆";
      }
    });

    content.querySelector("[data-export-memory]")?.addEventListener("click", () => {
      downloadText("memory.md", buildMemoryMarkdown(memories), "text/markdown;charset=utf-8");
      showToast("memory.md 已导出", "success");
    });
  };

  await render();
  return modal;
}

function renderMemoryRow(memory) {
  return `
    <article class="memory-row" data-memory-row="${escapeHtml(memory.id)}">
      <div class="memory-row-meta">
        <select aria-label="记忆类型">
          ${Object.entries(MEMORY_CATEGORY_LABELS)
            .map(([value, label]) => `<option value="${value}" ${memory.category === value ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
        <span class="memory-source ${memory.lastEditedBy === "ai" ? "ai" : "user"}">${memorySourceLabel(memory)}</span>
        <label class="memory-enable-row"><input type="checkbox" ${memory.enabled !== false ? "checked" : ""} /> 启用</label>
        <button class="danger-button" data-delete-memory="${escapeHtml(memory.id)}" type="button">删除</button>
      </div>
      <textarea rows="3" maxlength="500" aria-label="记忆内容">${escapeHtml(memory.content)}</textarea>
    </article>`;
}

function memorySourceLabel(memory) {
  const creator = memory.source === "ai" ? "AI 创建" : "用户创建";
  return memory.lastEditedBy === "ai" && memory.source !== "ai" ? `${creator} · AI 最近编辑` : creator;
}

async function refreshOverview(container) {
  const overview = await getMemoryOverview();
  const count = container.querySelector("[data-memory-count]");
  if (count) count.textContent = String(overview.active);
}

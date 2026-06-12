import { showToast } from "../components/Toast.js";
import { getAll } from "../services/storage/db.js";
import { getModelUsageRecords } from "../services/modelUsageTracker.js";
import { getProfile, profileInitials, saveProfile } from "../services/profile.js";
import { formatDuration } from "../services/studyTracker.js";
import { readImageFile } from "../utils/file.js";
import { escapeHtml } from "../utils/markdown.js";

const ROLE_LABELS = {
  question: "出题",
  grading: "判题",
  chat: "解惑"
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_MODES = [
  { key: "daily", label: "每日" },
  { key: "month", label: "本月" },
  { key: "cumulative", label: "累计" }
];
const DEFAULT_HEATMAP_MODES = {
  token: "daily",
  practice: "month"
};

const activeHeatmapModes = { ...DEFAULT_HEATMAP_MODES };

export async function renderStatsPage(container, app) {
  app.setContext({ contextKey: "stats" });
  const [profile, studyDays, usageRecords, notes, sets, questions, wrongItems, chatMessages] = await Promise.all([
    getProfile(),
    getAll("studyDays"),
    getModelUsageRecords(),
    getAll("notes"),
    getAll("questionSets"),
    getAll("questions"),
    getAll("wrongItems"),
    getAll("chatMessages")
  ]);

  const todayDate = formatDate(new Date());
  const studyMap = new Map(studyDays.map((day) => [day.date, day]));
  const usageByDate = groupUsageByDate(usageRecords);
  const modelRows = buildModelRows(usageRecords);
  const todayStudy = studyMap.get(todayDate) || {};
  const tokenMode = activeHeatmapModes.token || DEFAULT_HEATMAP_MODES.token;
  const practiceMode = activeHeatmapModes.practice || DEFAULT_HEATMAP_MODES.practice;
  const totalTokens = usageRecords.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0);
  const peakTokens = Math.max(0, ...[...usageByDate.values()].map((item) => item.totalTokens));
  const totalQuestions = studyDays.reduce((sum, item) => sum + Number(item.practicedQuestions || 0), 0);
  const totalStudyMs = studyDays.reduce((sum, item) => sum + Number(item.studyMs || 0), 0);
  const streaks = computeStreaks(studyDays);
  const estimatedUsageRate = usageRecords.length
    ? Math.round((usageRecords.filter((item) => item.estimated).length / usageRecords.length) * 100)
    : 0;

  container.innerHTML = `
    <section class="profile-page">
      <div class="profile-page-title">个人资料</div>
      <section class="profile-hero-profile">
        <div class="profile-avatar-block">
          <label class="profile-avatar-control" title="选择本地头像">
            ${renderAvatar(profile)}
            <input data-profile-avatar type="file" accept="image/*" hidden />
          </label>
          <div class="profile-actions-row">
            <label class="secondary-button file-button">
              更换头像
              <input data-profile-avatar-secondary type="file" accept="image/*" hidden />
            </label>
            <button class="secondary-button" data-remove-avatar type="button" ${profile.avatarDataUrl ? "" : "disabled"}>移除头像</button>
          </div>
        </div>
        <form class="profile-name-form" data-profile-form>
          <h1>${escapeHtml(profile.displayName)}</h1>
          <p>本地个人资料 · 只保存在这台设备上</p>
          <div class="profile-name-row">
            <label>
              <span>显示名称</span>
              <input name="displayName" maxlength="32" value="${escapeHtml(profile.displayName)}" />
            </label>
            <button class="primary-button" type="submit">保存资料</button>
          </div>
        </form>
      </section>

      <section class="profile-metric-strip">
        <div><strong>${formatCompact(totalTokens)}</strong><span>累计 Token 数</span></div>
        <div><strong>${formatCompact(peakTokens)}</strong><span>峰值 Token 数</span></div>
        <div><strong>${formatDuration(totalStudyMs)}</strong><span>累计学习时长</span></div>
        <div><strong>${streaks.current}</strong><span>当前连续天数</span></div>
        <div><strong>${streaks.longest}</strong><span>最长连续天数</span></div>
      </section>

      <section class="profile-activity-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Token Activity</p>
            <h2>Token 活动</h2>
          </div>
          ${renderHeatmapModeTabs("token", tokenMode)}
        </div>
        ${renderMetricHeatmap({
          mode: tokenMode,
          kind: "token",
          dailyMap: usageByDate,
          valueKey: "totalTokens",
          todayDate
        })}
      </section>

      <section class="profile-lower-grid">
        <article class="profile-activity-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Practice Activity</p>
              <h2>做题活动</h2>
            </div>
            ${renderHeatmapModeTabs("practice", practiceMode)}
          </div>
          ${renderMetricHeatmap({
            mode: practiceMode,
            kind: "practice",
            dailyMap: studyMap,
            valueKey: "practicedQuestions",
            todayDate
          })}
        </article>

        <article class="profile-activity-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Insight</p>
              <h2>活动洞察</h2>
            </div>
          </div>
          <div class="insight-list">
            <div><span>今日做题</span><strong>${Number(todayStudy.practicedQuestions || 0)}</strong></div>
            <div><span>近 7 日做题</span><strong>${sumRecent(studyMap, buildRecentDays(7), 7, "practicedQuestions")}</strong></div>
            <div><span>笔记总数</span><strong>${notes.length}</strong></div>
            <div><span>题组总数</span><strong>${sets.length}</strong></div>
            <div><span>题目总数</span><strong>${questions.length}</strong></div>
            <div><span>未掌握错题</span><strong>${wrongItems.filter((item) => !item.mastered).length}</strong></div>
            <div><span>解惑消息</span><strong>${chatMessages.length}</strong></div>
            <div><span>估算 Token 占比</span><strong>${estimatedUsageRate}%</strong></div>
          </div>
        </article>
      </section>

      <section class="profile-lower-grid">
        <article class="profile-activity-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Models</p>
              <h2>常用模型</h2>
            </div>
          </div>
          ${renderTopModels(modelRows)}
        </article>

        <article class="profile-activity-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Study Log</p>
              <h2>最近学习日</h2>
            </div>
          </div>
          ${renderRecentDays(studyDays, usageByDate)}
        </article>
      </section>
    </section>
  `;

  alignHeatmaps(container, todayDate);
  bindHeatmapEvents(container, app);
  bindHeatmapTooltips(container);
  bindProfileEvents(container, profile, app);
}

function alignHeatmaps(container, todayDate) {
  window.requestAnimationFrame(() => {
    container.querySelectorAll('[data-heatmap-align="today"]').forEach((scrollArea) => {
      const track = scrollArea.querySelector(".activity-heatmap-track");
      const todayCell = scrollArea.querySelector(`[data-date="${todayDate}"]`);
      if (!track || !todayCell) return;

      track.style.paddingLeft = "";
      track.style.paddingRight = "";
      track.style.minWidth = "";
      scrollArea.scrollLeft = 0;

      const desiredCenter = scrollArea.clientWidth * 0.66;
      const edgePad = 32;
      const measure = () => {
        const scrollRect = scrollArea.getBoundingClientRect();
        const cellRect = todayCell.getBoundingClientRect();
        return {
          cellCenter: cellRect.left - scrollRect.left + scrollArea.scrollLeft + cellRect.width / 2,
          maxScroll: Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth)
        };
      };

      let metrics = measure();
      if (metrics.cellCenter < desiredCenter) {
        const currentPadding = Number.parseFloat(window.getComputedStyle(track).paddingLeft) || 0;
        track.style.paddingLeft = `${currentPadding + desiredCenter - metrics.cellCenter}px`;
        metrics = measure();
      }

      let target = Math.max(0, metrics.cellCenter - desiredCenter);
      if (target > metrics.maxScroll) {
        const currentPadding = Number.parseFloat(window.getComputedStyle(track).paddingRight) || 0;
        track.style.paddingRight = `${currentPadding + target - metrics.maxScroll + edgePad}px`;
        metrics = measure();
        target = Math.max(0, metrics.cellCenter - desiredCenter);
      }

      if (scrollArea.scrollWidth <= scrollArea.clientWidth) {
        track.style.minWidth = `${scrollArea.clientWidth + edgePad * 4}px`;
        metrics = measure();
        target = Math.max(0, metrics.cellCenter - desiredCenter);
      }

      scrollArea.scrollLeft = Math.min(target, metrics.maxScroll);
    });
  });
}

function bindHeatmapEvents(container, app) {
  container.querySelectorAll("[data-heatmap-scope][data-heatmap-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.dataset.heatmapScope;
      const mode = button.dataset.heatmapMode;
      if (activeHeatmapModes[scope] === mode) return;
      activeHeatmapModes[scope] = mode;
      app.refresh();
    });
  });
}

function bindHeatmapTooltips(container) {
  const tooltip = document.createElement("div");
  tooltip.className = "heatmap-floating-tooltip";
  tooltip.hidden = true;
  container.appendChild(tooltip);

  const hide = () => {
    tooltip.hidden = true;
  };

  const show = (cell) => {
    const text = cell.dataset.tooltip;
    if (!text) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    const cellRect = cell.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tipRect.width - 12, Math.max(12, cellRect.left + cellRect.width / 2 - tipRect.width / 2));
    const preferredTop = cellRect.top - tipRect.height - 10;
    const top = preferredTop > 12 ? preferredTop : cellRect.bottom + 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  container.querySelectorAll(".activity-cell[data-tooltip]").forEach((cell) => {
    cell.addEventListener("pointerenter", () => show(cell));
    cell.addEventListener("pointerleave", hide);
    cell.addEventListener("focus", () => show(cell));
    cell.addEventListener("blur", hide);
  });

  container.querySelectorAll(".activity-heatmap-scroll").forEach((scrollArea) => {
    scrollArea.addEventListener("scroll", hide, { passive: true });
  });
}

function bindProfileEvents(container, profile, app) {
  const handleAvatarFile = async (file) => {
    if (!file) return;
    try {
      const image = await readImageFile(file);
      await saveProfile({ ...profile, avatarDataUrl: image.dataUrl });
      showToast("头像已更新", "success");
      app.refresh();
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  container.querySelectorAll("[data-profile-avatar], [data-profile-avatar-secondary]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      await handleAvatarFile(file);
    });
  });

  container.querySelector("[data-remove-avatar]")?.addEventListener("click", async () => {
    await saveProfile({ ...profile, avatarDataUrl: "" });
    showToast("头像已移除", "success");
    app.refresh();
  });

  container.querySelector("[data-profile-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = String(new FormData(event.currentTarget).get("displayName") || "").trim();
    await saveProfile({ ...profile, displayName });
    showToast("个人资料已保存", "success");
    app.refresh();
  });
}

function renderAvatar(profile) {
  if (profile.avatarDataUrl) {
    return `<img class="profile-avatar-image" src="${escapeHtml(profile.avatarDataUrl)}" alt="${escapeHtml(profile.displayName)} 的头像" />`;
  }
  return `<span class="profile-avatar-fallback">${escapeHtml(profileInitials(profile.displayName))}</span>`;
}

function buildRecentDays(count) {
  const days = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const day = new Date(cursor.getTime() - index * DAY_MS);
    days.push(formatDate(day));
  }
  return days;
}

function buildCurrentYearDays(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  const end = new Date(date);
  return buildDaysBetween(start, end);
}

function buildCurrentMonthDays(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date);
  return buildDaysBetween(start, end);
}

function buildDaysBetween(start, end) {
  const days = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cursor <= last) {
    days.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthDay(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function groupUsageByDate(records) {
  const map = new Map();
  records.forEach((record) => {
    const date = record.date || String(record.createdAt || "").slice(0, 10);
    if (!date) return;
    const current = map.get(date) || { totalTokens: 0, requests: 0 };
    current.totalTokens += Number(record.totalTokens || 0);
    current.requests += 1;
    map.set(date, current);
  });
  return map;
}

function buildModelRows(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = `${record.modelName || "未命名模型"}::${record.role || "unknown"}`;
    const current =
      map.get(key) || {
        modelName: record.modelName || "未命名模型",
        role: record.role || "unknown",
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCount: 0
      };
    current.requests += 1;
    current.promptTokens += Number(record.promptTokens || 0);
    current.completionTokens += Number(record.completionTokens || 0);
    current.totalTokens += Number(record.totalTokens || 0);
    current.estimatedCount += record.estimated ? 1 : 0;
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function renderHeatmapModeTabs(scope, activeMode) {
  return `
    <div class="profile-period-tabs" aria-label="${scope === "token" ? "Token" : "做题"}统计范围">
      ${HEATMAP_MODES.map(
        (mode) => `
          <button
            class="${mode.key === activeMode ? "active" : ""}"
            data-heatmap-scope="${scope}"
            data-heatmap-mode="${mode.key}"
            type="button"
            aria-pressed="${mode.key === activeMode ? "true" : "false"}"
          >${mode.label}</button>`
      ).join("")}
    </div>
  `;
}

function renderMetricHeatmap({ mode, kind, dailyMap, valueKey, todayDate }) {
  const days = mode === "month" ? buildCurrentMonthDays() : buildCurrentYearDays();
  const data = mode === "cumulative"
    ? buildCumulativeHeatmapData({ days, kind, dailyMap, valueKey, todayDate })
    : buildDailyHeatmapData({ days, kind, dailyMap, valueKey, todayDate });
  return renderActivityHeatmap({
    mode,
    days,
    values: data.values,
    details: data.details,
    unit: kind === "token" ? "Token" : "题",
    todayDate
  });
}

function buildDailyHeatmapData({ days, kind, dailyMap, valueKey, todayDate }) {
  const values = [];
  const details = [];
  days.forEach((date) => {
    if (date > todayDate) {
      values.push(0);
      details.push(`${formatMonthDay(date)} 尚未到来`);
      return;
    }

    const row = dailyMap.get(date) || {};
    const value = Number(row[valueKey] || 0);
    values.push(value);
    if (kind === "token") {
      details.push(`${formatMonthDay(date)} 使用了 ${formatCompact(value)} 个 Token`);
    } else {
      details.push(`${formatMonthDay(date)} 完成 ${value} 题，正确 ${Number(row.correctAnswers || 0)} 题`);
    }
  });
  return { values, details };
}

function buildCumulativeHeatmapData({ days, kind, dailyMap, valueKey, todayDate }) {
  const entries = [...dailyMap.entries()]
    .map(([date, row]) => ({ date, value: Number(row?.[valueKey] || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const values = [];
  const details = [];
  let entryIndex = 0;
  let runningTotal = 0;

  days.forEach((date) => {
    while (entryIndex < entries.length && entries[entryIndex].date <= date) {
      runningTotal += entries[entryIndex].value;
      entryIndex += 1;
    }

    if (date > todayDate) {
      values.push(0);
      details.push(`${formatMonthDay(date)} 尚未到来`);
      return;
    }

    values.push(runningTotal);
    if (kind === "token") {
      details.push(`截至 ${formatMonthDay(date)} 累计使用 ${formatCompact(runningTotal)} 个 Token`);
    } else {
      details.push(`截至 ${formatMonthDay(date)} 累计完成 ${formatCompact(runningTotal)} 题`);
    }
  });

  return { values, details };
}

function renderActivityHeatmap({ mode, days, values, details, unit, todayDate }) {
  const max = Math.max(1, ...values);
  const columnCount = Math.ceil(days.length / 7);
  const monthLabels = buildMonthLabels(days, columnCount);
  const alignAttr = mode === "daily" ? 'data-heatmap-align="today"' : "";
  const cells = days
    .map((date, index) => {
      const value = values[index];
      const level = heatLevel(value, max);
      const detail = details[index];
      return `<button class="activity-cell level-${level}" type="button" data-date="${escapeHtml(date)}" data-tooltip="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}" ${date > todayDate ? 'data-future="true"' : ""}></button>`;
    })
    .join("");

  return `
    <div class="activity-heatmap">
      <div class="activity-heatmap-scroll" ${alignAttr}>
        <div class="activity-heatmap-track">
          <div class="activity-grid" style="grid-template-columns: repeat(${columnCount}, 13px)" aria-label="${escapeHtml(unit)} 活动热力图">
            ${cells}
          </div>
          <div class="activity-months" style="grid-template-columns: repeat(${columnCount}, 13px)">
            ${monthLabels.map((item) => `<span style="grid-column:${item.column}">${item.label}</span>`).join("")}
          </div>
        </div>
      </div>
      <div class="heatmap-legend">
        <span>少</span><i class="activity-cell level-1"></i><i class="activity-cell level-2"></i><i class="activity-cell level-3"></i><i class="activity-cell level-4"></i><span>多</span>
      </div>
    </div>
  `;
}

function buildMonthLabels(days, columnCount) {
  const labels = [];
  const seen = new Set();
  days.forEach((date, index) => {
    const parsed = new Date(`${date}T00:00:00`);
    const key = date.slice(0, 7);
    if (parsed.getDate() <= 7 && !seen.has(key)) {
      seen.add(key);
      labels.push({
        label: `${parsed.getMonth() + 1}月`,
        column: Math.min(columnCount, Math.floor(index / 7) + 1)
      });
    }
  });
  return labels;
}

function heatLevel(value, max) {
  if (!value) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

function renderTopModels(rows) {
  const topRows = rows.slice(0, 6);
  if (!topRows.length) return `<div class="empty-state compact">还没有模型调用记录。</div>`;
  return `
    <div class="top-model-list">
      ${topRows
        .map(
          (row) => `
            <div class="top-model-row">
              <div>
                <strong>${escapeHtml(row.modelName)}</strong>
                <span>${ROLE_LABELS[row.role] || escapeHtml(row.role)} · ${formatCompact(row.totalTokens)} tokens</span>
              </div>
              <span>${row.requests} 次运行</span>
            </div>`
        )
        .join("")}
    </div>
  `;
}

function renderRecentDays(studyDays, usageByDate) {
  const rows = [...studyDays]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 8)
    .map((day) => {
      const usage = usageByDate.get(day.date) || {};
      return `
        <tr>
          <td>${escapeHtml(day.date)}</td>
          <td>${Number(day.practicedQuestions || 0)}</td>
          <td>${Number(day.correctAnswers || 0)}</td>
          <td>${formatDuration(day.studyMs)}</td>
          <td>${formatCompact(usage.totalTokens || 0)}</td>
        </tr>`;
    });

  if (!rows.length) return `<div class="empty-state compact">还没有学习日记录。</div>`;

  return `
    <div class="table-wrap">
      <table class="result-table compact-table">
        <thead><tr><th>日期</th><th>做题</th><th>正确</th><th>学习时长</th><th>Token</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

function sumRecent(dayMap, days, count, key) {
  return days
    .slice(-count)
    .reduce((sum, date) => sum + Number(dayMap.get(date)?.[key] || 0), 0);
}

function computeStreaks(days) {
  const checked = new Set(days.filter((day) => day.checkedIn).map((day) => day.date));
  const sorted = [...checked].sort();
  let longest = 0;
  let currentRun = 0;
  let previousTime = 0;

  sorted.forEach((date) => {
    const time = new Date(`${date}T00:00:00`).getTime();
    currentRun = previousTime && time - previousTime === DAY_MS ? currentRun + 1 : 1;
    longest = Math.max(longest, currentRun);
    previousTime = time;
  });

  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (checked.has(formatDate(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest };
}

function formatCompact(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

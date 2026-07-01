import { APP_NAME, APP_TAGLINE } from "../config/appMeta.js";
import { getAll } from "../services/storage/db.js";
import { getProfile, profileInitials } from "../services/profile.js";
import { escapeHtml } from "../utils/markdown.js";

let cleanupLayoutEvents = null;
const SIDEBAR_NOTEBOOK_STATE_KEY = "quiznest:sidebar:notebook-state";
const SIDEBAR_MODE_KEY = "quiznest:sidebar-mode";
const SIDEBAR_MODE_EXPANDED = "expanded";
const SIDEBAR_MODE_COLLAPSED = "collapsed";
const UNFILED_NOTEBOOK_STATE_ID = "__unfiled__";

export const SIDEBAR_NAV_ITEMS = [
  { path: "/", label: "首页", icon: "home", match: (segments) => segments.length === 0 },
  { path: "/notebooks", label: "笔记本", icon: "folder", match: (segments) => ["notebooks", "note"].includes(segments[0]) },
  { path: "/pdf-note", label: "PDF 笔记", icon: "file-text", match: (segments) => segments[0] === "pdf-note" },
  { path: "/sets", label: "题组库", icon: "library", match: (segments) => segments[0] === "sets" || segments[0] === "practice" },
  { path: "/wrong", label: "错题本", icon: "circle-alert", match: (segments) => segments[0] === "wrong" },
  { path: "/chat", label: "解惑", icon: "message-circle", match: (segments) => segments[0] === "chat" },
  { path: "/stats", label: "统计与个人资料", icon: "chart", match: (segments) => segments[0] === "stats" }
];

// 手机端底部 tab：仅这四项是一级目的地，其余功能进中心 + 动作表或头像菜单。
export const MOBILE_NAV_ITEMS = [
  { path: "/", label: "首页", icon: "home", match: (segments) => segments.length === 0 },
  { path: "/wrong", label: "错题本", icon: "circle-alert", match: (segments) => segments[0] === "wrong" },
  { path: "/sets", label: "题组库", icon: "library", match: (segments) => segments[0] === "sets" || segments[0] === "practice" },
  { path: "/chat", label: "解惑", icon: "message-circle", match: (segments) => segments[0] === "chat" }
];

// 中心 + 动作表项：上传 md / 从笔记出题 / 笔记本 / PDF 导入 / PPT 导入。
// 注意：上传 .md 当前导航到首页（首页有上传按钮），后续 Phase 2 再做成 FAB 直接触发。
const MOBILE_FAB_ACTIONS = [
  { path: "/", label: "上传 .md 笔记", icon: "upload" },
  { path: "/notebooks", label: "从笔记生成题组", icon: "book-open" },
  { path: "/notebooks", label: "笔记本", icon: "folder" },
  { path: "/pdf-note", label: "导入 PDF", icon: "file-text" },
  { path: "/pdf-note", label: "导入 PPT", icon: "presentation" }
];

// 判断路由是否为手机底部 tab 的一级页面（用于决定顶部栏显示头像还是返回按钮）。
function isMobileMainTabRoute(route) {
  // 仅 4 个一级 tab 路由算"主 tab"（显示头像、隐藏返回按钮）。
  // /practice/:id、/note/:id、/notebooks、/pdf-note、/stats、/settings 等子页都算子页（显示返回按钮）。
  // 题组库 tab 在 /practice/:id 下仍高亮，靠 renderMobileNavItem 的 match（含 practice）独立判断。
  const seg = route.segments;
  if (seg.length === 0) return true;
  if (seg.length === 1 && (seg[0] === "wrong" || seg[0] === "sets" || seg[0] === "chat")) return true;
  return false;
}

export async function getAppLayoutData() {
  const [notes, notebooks, profile] = await Promise.all([getAll("notes"), getAll("notebooks"), getProfile()]);
  return {
    notes: notes
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))),
    notebooks: notebooks
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))),
    profile
  };
}

export function renderAppLayout({ route, title, notes, notebooks = [], profile }) {
  const notebookGroups = buildNotebookGroups(notes, notebooks, route, readSidebarNotebookState());
  const sidebarMode = readSidebarMode();
  const sidebarCollapsed = sidebarMode === SIDEBAR_MODE_COLLAPSED;
  const isMainTab = isMobileMainTabRoute(route);
  const mobileNavLeft = MOBILE_NAV_ITEMS.slice(0, 2).map((item) => renderMobileNavItem(item, route)).join("");
  const mobileNavRight = MOBILE_NAV_ITEMS.slice(2).map((item) => renderMobileNavItem(item, route)).join("");
  const mobileFabHtml = MOBILE_FAB_ACTIONS.map(renderMobileFabAction).join("");
  return `
    <div class="app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}" data-sidebar-mode="${sidebarMode}" data-route="${route.segments[0] || "home"}">
      <aside class="app-sidebar" id="app-sidebar" aria-label="QuizNest 导航">
        <div class="sidebar-brand-block">
          <button class="sidebar-brand" data-nav="/" type="button" aria-label="返回首页">
            <span class="brand-mark">QN</span>
            <span class="brand-copy">
              <strong>${escapeHtml(APP_NAME)}</strong>
              <small>${escapeHtml(APP_TAGLINE)}</small>
            </span>
          </button>

        </div>

        <div class="sidebar-scroll">
          <nav class="sidebar-nav" aria-label="主导航">
            ${SIDEBAR_NAV_ITEMS.map((item) => renderNavItem(item, route)).join("")}
          </nav>

          <section class="sidebar-section" aria-label="笔记本">
            <div class="sidebar-section-title">笔记本</div>
            <div class="sidebar-notebook-list">
              ${notebookGroups.length ? renderNotebookTree(notebookGroups, route) : renderEmptyNotes()}
            </div>
          </section>
        </div>

        <div class="sidebar-footer">
          <div class="sidebar-settings-menu" data-sidebar-settings-menu hidden>
            <button type="button" data-nav="/stats">
              ${icon("user-round")}
              <span>统计与个人资料</span>
            </button>
            <button type="button" data-nav="/settings">
              ${icon("settings")}
              <span>设置</span>
            </button>
          </div>
          <button class="sidebar-settings-button ${["settings", "stats"].includes(route.segments[0]) ? "active" : ""}" type="button" data-sidebar-settings-toggle aria-expanded="false" aria-label="打开个人资料与设置" title="个人资料与设置">
            <span class="sidebar-profile-avatar">${renderProfileAvatar(profile)}</span>
            <span class="sidebar-settings-copy">
              <strong>${escapeHtml(profile.displayName)}</strong>
              <small>设置</small>
            </span>
            ${icon("chevron-up")}
          </button>
        </div>
        <div class="sidebar-tooltip" data-sidebar-tooltip role="tooltip" hidden></div>
      </aside>

      <section class="app-main">
        <header class="mobile-top-bar" role="banner">
          <button class="mobile-avatar-button" type="button" data-mobile-avatar-toggle aria-label="个人资料与设置" title="个人资料与设置" ${isMainTab ? "" : "hidden"}>
            <span class="mobile-avatar">${renderProfileAvatar(profile)}</span>
          </button>
          <button class="mobile-back-button" type="button" data-mobile-back aria-label="返回" title="返回" ${isMainTab ? "hidden" : ""}>
            ${icon("chevron-left")}
          </button>
          <h1 class="mobile-page-title">${escapeHtml(title)}</h1>
        </header>
        <header class="app-content-header">
          <button
            class="sidebar-collapse-button"
            data-sidebar-collapse-toggle
            type="button"
            aria-controls="app-sidebar"
            aria-pressed="${sidebarCollapsed}"
            aria-label="${sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}"
            title="${sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}"
          >
            ${icon(sidebarCollapsed ? "panel-left-open" : "panel-left-close")}
          </button>
          <div>
            <p>${escapeHtml(APP_NAME)}</p>
            <h1>${escapeHtml(title)}</h1>
          </div>
        </header>
        <main class="page" data-page-container aria-label="${escapeHtml(title)}">
          <div class="loading">正在加载...</div>
        </main>
      </section>

      <div class="mobile-avatar-menu" data-mobile-avatar-menu hidden role="menu" aria-label="个人资料与设置">
        <button type="button" data-nav="/stats" role="menuitem">
          ${icon("chart")}
          <span>统计与个人资料</span>
        </button>
        <button type="button" data-nav="/settings" role="menuitem">
          ${icon("settings")}
          <span>设置</span>
        </button>
      </div>

      <nav class="mobile-bottom-nav" aria-label="主导航">
        ${mobileNavLeft}
        <button class="mobile-fab-button" type="button" data-mobile-fab-toggle aria-label="更多操作" title="更多操作">
          ${icon("plus")}
        </button>
        ${mobileNavRight}
      </nav>

      <div class="mobile-fab-sheet" data-mobile-fab-sheet hidden role="dialog" aria-label="更多操作">
        <div class="mobile-fab-sheet-handle" aria-hidden="true"></div>
        ${mobileFabHtml}
      </div>
    </div>
  `;
}

export function bindAppLayout(root, { navigate }) {
  if (cleanupLayoutEvents) cleanupLayoutEvents();

  const menu = root.querySelector("[data-sidebar-settings-menu]");
  const toggle = root.querySelector("[data-sidebar-settings-toggle]");
  const shell = root.querySelector(".app-shell");
  const collapseToggle = root.querySelector("[data-sidebar-collapse-toggle]");
  const tooltip = root.querySelector("[data-sidebar-tooltip]");
  const tooltipSources = Array.from(root.querySelectorAll("[data-sidebar-tooltip-label]"));
  const notebookDetails = Array.from(root.querySelectorAll("[data-sidebar-notebook-id]"));

  const dockMenu = () => {
    if (!menu || !toggle) return;
    menu.classList.remove("sidebar-settings-menu-floating");
    delete menu.dataset.sidebarMenuFloating;
    menu.style.left = "";
    menu.style.bottom = "";
    menu.style.width = "";

    const footer = root.querySelector(".sidebar-footer");
    if (footer?.contains(toggle) && menu.parentElement !== footer) {
      footer.insertBefore(menu, toggle);
    } else if (!footer?.contains(toggle) && menu.parentElement === document.body) {
      menu.remove();
    }
  };

  const floatMenu = () => {
    if (!menu || !toggle) return;
    const rect = toggle.getBoundingClientRect();
    menu.classList.add("sidebar-settings-menu-floating");
    menu.dataset.sidebarMenuFloating = "true";
    menu.style.left = `${Math.round(rect.right + 10)}px`;
    menu.style.bottom = `${Math.max(12, Math.round(window.innerHeight - rect.bottom))}px`;
    menu.style.width = "220px";
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
  };

  const shouldFloatMenu = () => (
    Boolean(shell?.classList.contains("sidebar-collapsed")) &&
    !window.matchMedia("(max-width: 760px)").matches
  );

  const openMenu = () => {
    if (!menu || !toggle) return;
    menu.hidden = false;
    if (shouldFloatMenu()) floatMenu();
    else dockMenu();
    toggle.setAttribute("aria-expanded", "true");
  };

  const closeMenu = () => {
    if (!menu || !toggle) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    dockMenu();
  };

  const toggleMenu = () => {
    if (!menu || !toggle) return;
    if (menu.hidden) openMenu();
    else closeMenu();
  };

  // 手机端：中心 + 动作表、头像菜单、返回按钮。仅 ≤760px 渲染，大屏这些元素 CSS 隐藏不参与交互。
  const fabToggle = root.querySelector("[data-mobile-fab-toggle]");
  const fabSheet = root.querySelector("[data-mobile-fab-sheet]");
  const avatarToggle = root.querySelector("[data-mobile-avatar-toggle]");
  const avatarMenu = root.querySelector("[data-mobile-avatar-menu]");
  const backButton = root.querySelector("[data-mobile-back]");

  const closeMobileMenus = () => {
    if (fabSheet) fabSheet.hidden = true;
    if (fabToggle) fabToggle.setAttribute("aria-expanded", "false");
    if (avatarMenu) avatarMenu.hidden = true;
    if (avatarToggle) avatarToggle.setAttribute("aria-expanded", "false");
  };

  const openFabSheet = () => {
    if (!fabSheet || !fabToggle) return;
    if (avatarMenu) avatarMenu.hidden = true;
    if (avatarToggle) avatarToggle.setAttribute("aria-expanded", "false");
    fabSheet.hidden = false;
    fabToggle.setAttribute("aria-expanded", "true");
  };

  const openAvatarMenu = () => {
    if (!avatarMenu || !avatarToggle) return;
    if (fabSheet) fabSheet.hidden = true;
    if (fabToggle) fabToggle.setAttribute("aria-expanded", "false");
    avatarMenu.hidden = false;
    avatarToggle.setAttribute("aria-expanded", "true");
  };

  const toggleFabSheet = () => {
    if (!fabSheet) return;
    if (fabSheet.hidden) openFabSheet();
    else closeMobileMenus();
  };

  const toggleAvatarMenu = () => {
    if (!avatarMenu) return;
    if (avatarMenu.hidden) openAvatarMenu();
    else closeMobileMenus();
  };

  const hideTooltip = () => {
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.textContent = "";
  };

  const showTooltip = (event) => {
    if (!tooltip || !shell?.classList.contains("sidebar-collapsed") || window.matchMedia("(max-width: 760px)").matches) return;
    const source = event.currentTarget;
    const label = source.dataset.sidebarTooltipLabel;
    if (!label) return;
    const rect = source.getBoundingClientRect();
    tooltip.textContent = label;
    tooltip.style.left = `${Math.round(rect.right + 10)}px`;
    tooltip.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
    tooltip.hidden = false;
  };

  const applySidebarMode = (mode) => {
    if (!shell || !collapseToggle) return;
    const collapsed = mode === SIDEBAR_MODE_COLLAPSED;

    const applyDomChanges = () => {
      shell.classList.toggle("sidebar-collapsed", collapsed);
      shell.dataset.sidebarMode = collapsed ? SIDEBAR_MODE_COLLAPSED : SIDEBAR_MODE_EXPANDED;
      collapseToggle.setAttribute("aria-pressed", String(collapsed));
      collapseToggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
      collapseToggle.setAttribute("title", collapsed ? "展开侧边栏" : "收起侧边栏");
      collapseToggle.innerHTML = icon(collapsed ? "panel-left-open" : "panel-left-close");
      writeSidebarMode(collapsed ? SIDEBAR_MODE_COLLAPSED : SIDEBAR_MODE_EXPANDED);
      closeMenu();
      hideTooltip();
    };

    // B方案：禁用 View Transitions 转场，直接执行 DOM 改变，仅利用 CSS Grid 过渡宽度
    applyDomChanges();
  };

  root.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      closeMenu();
      closeMobileMenus();
      navigate(button.dataset.nav);
    });
  });

  toggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu();
  });

  fabToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFabSheet();
  });

  avatarToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAvatarMenu();
  });

  backButton?.addEventListener("click", () => {
    // 优先 hash 回退；若无历史则回首页，避免停在子页面无法返回。
    if (window.history.length > 1) window.history.back();
    else navigate("/");
  });

  collapseToggle?.addEventListener("click", () => {
    applySidebarMode(shell?.classList.contains("sidebar-collapsed") ? SIDEBAR_MODE_EXPANDED : SIDEBAR_MODE_COLLAPSED);
  });

  tooltipSources.forEach((source) => {
    source.addEventListener("mouseenter", showTooltip);
    source.addEventListener("mouseleave", hideTooltip);
    source.addEventListener("focus", showTooltip);
    source.addEventListener("blur", hideTooltip);
  });

  const onDocumentPointerDown = (event) => {
    const footer = root.querySelector(".sidebar-footer");
    if (!footer?.contains(event.target) && !menu?.contains(event.target)) closeMenu();
    // 手机端：点 + 动作表/头像菜单外部时关闭
    const inFab = fabToggle?.contains(event.target) || fabSheet?.contains(event.target);
    const inAvatar = avatarToggle?.contains(event.target) || avatarMenu?.contains(event.target);
    if (!inFab && !inAvatar) closeMobileMenus();
  };

  const onDocumentKeydown = (event) => {
    if (event.key === "Escape") {
      closeMenu();
      closeMobileMenus();
    }
  };

  const onNotebookToggle = (event) => {
    const details = event.currentTarget;
    const state = readSidebarNotebookState();
    state[details.dataset.sidebarNotebookId] = details.open;
    writeSidebarNotebookState(state);
  };

  notebookDetails.forEach((details) => details.addEventListener("toggle", onNotebookToggle));

  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("resize", closeMobileMenus);
  cleanupLayoutEvents = () => {
    if (menu?.dataset.sidebarMenuFloating === "true") menu.remove();
    tooltipSources.forEach((source) => {
      source.removeEventListener("mouseenter", showTooltip);
      source.removeEventListener("mouseleave", hideTooltip);
      source.removeEventListener("focus", showTooltip);
      source.removeEventListener("blur", hideTooltip);
    });
    notebookDetails.forEach((details) => details.removeEventListener("toggle", onNotebookToggle));
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onDocumentKeydown);
    window.removeEventListener("resize", closeMenu);
    window.removeEventListener("resize", closeMobileMenus);
  };
}

function renderNavItem(item, route) {
  const active = item.match(route.segments);
  return `
    <button class="sidebar-nav-item ${active ? "active" : ""}" data-nav="${item.path}" data-sidebar-tooltip-label="${escapeHtml(item.label)}" type="button" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}" ${active ? 'aria-current="page"' : ""}>
      ${icon(item.icon)}
      <span>${escapeHtml(item.label)}</span>
    </button>
  `;
}

function renderMobileNavItem(item, route) {
  const active = item.match(route.segments);
  return `
    <button class="mobile-nav-item ${active ? "active" : ""}" data-nav="${item.path}" type="button" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}" ${active ? 'aria-current="page"' : ""}>
      ${icon(item.icon)}
      <span>${escapeHtml(item.label)}</span>
    </button>
  `;
}

function renderMobileFabAction(action) {
  return `
    <button class="mobile-fab-action" type="button" data-nav="${action.path}">
      <span class="mobile-fab-action-icon">${icon(action.icon)}</span>
      <span class="mobile-fab-action-label">${escapeHtml(action.label)}</span>
    </button>
  `;
}

function buildNotebookGroups(notes, notebooks, route, savedState = {}) {
  const notebookMap = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const groupedNotes = new Map();
  const unfiledNotes = [];
  const activeNoteId = route.segments[0] === "note" ? route.segments[1] : "";
  const forceActiveOpen = route.segments[0] === "note";

  notes.forEach((note) => {
    if (note.notebookId && notebookMap.has(note.notebookId)) {
      const groupNotes = groupedNotes.get(note.notebookId) || [];
      groupNotes.push(note);
      groupedNotes.set(note.notebookId, groupNotes);
    } else {
      unfiledNotes.push(note);
    }
  });

  const groups = notebooks
    .map((notebook) => {
      const groupNotes = groupedNotes.get(notebook.id) || [];
      return {
        id: notebook.id,
        title: notebook.title || "未命名笔记本",
        notes: groupNotes,
        active: groupNotes.some((note) => note.id === activeNoteId)
      };
    })
    .filter((group) => group.notes.length > 0);

  if (unfiledNotes.length) {
    groups.push({
      id: "",
      title: "未归档",
      notes: unfiledNotes,
      active: unfiledNotes.some((note) => note.id === activeNoteId)
    });
  }

  const hasActiveGroup = groups.some((group) => group.active);
  return groups.map((group, index) => ({
    ...group,
    open: getNotebookOpenState(group, index, hasActiveGroup, savedState, forceActiveOpen)
  }));
}

function getNotebookOpenState(group, index, hasActiveGroup, savedState, forceActiveOpen) {
  if (forceActiveOpen && group.active) return true;
  const stateKey = group.id || UNFILED_NOTEBOOK_STATE_ID;
  if (Object.prototype.hasOwnProperty.call(savedState, stateKey)) {
    return Boolean(savedState[stateKey]);
  }
  return group.active || (!hasActiveGroup && index === 0);
}

function renderNotebookTree(groups, route) {
  return groups.map((group) => renderNotebookGroup(group, route)).join("");
}

function renderNotebookGroup(group, route) {
  const stateKey = group.id || UNFILED_NOTEBOOK_STATE_ID;
  return `
    <details class="sidebar-notebook-group ${group.active ? "active" : ""}" data-sidebar-notebook-id="${escapeHtml(stateKey)}" ${group.open ? "open" : ""}>
      <summary class="sidebar-notebook-summary">
        ${icon("chevron-right")}
        <span>${escapeHtml(group.title)}</span>
      </summary>
      <div class="sidebar-notebook-notes">
        ${group.notes.map((note) => renderNotebookNoteItem(note, route)).join("")}
      </div>
    </details>
  `;
}

function readSidebarNotebookState() {
  try {
    return JSON.parse(window.localStorage.getItem(SIDEBAR_NOTEBOOK_STATE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeSidebarNotebookState(state) {
  try {
    window.localStorage.setItem(SIDEBAR_NOTEBOOK_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable in restricted WebViews; the sidebar still works without persistence.
  }
}

function readSidebarMode() {
  try {
    return window.localStorage.getItem(SIDEBAR_MODE_KEY) === SIDEBAR_MODE_COLLAPSED
      ? SIDEBAR_MODE_COLLAPSED
      : SIDEBAR_MODE_EXPANDED;
  } catch {
    return SIDEBAR_MODE_EXPANDED;
  }
}

function writeSidebarMode(mode) {
  try {
    window.localStorage.setItem(SIDEBAR_MODE_KEY, mode);
  } catch {
    // localStorage may be unavailable in restricted WebViews; expanded mode remains the default.
  }
}

function renderNotebookNoteItem(note, route) {
  const active = route.segments[0] === "note" && route.segments[1] === note.id;
  return `
    <button class="sidebar-notebook-note ${active ? "active" : ""}" data-nav="/note/${escapeHtml(note.id)}" type="button" ${active ? 'aria-current="page"' : ""}>
      <strong>${escapeHtml(note.title || "未命名笔记")}</strong>
      <small>${escapeHtml(note.fileName || "Markdown 笔记")}</small>
    </button>
  `;
}

function renderEmptyNotes() {
  return `
    <div class="sidebar-empty">
      <strong>暂无笔记</strong>
      <span>上传 Markdown 笔记开始学习</span>
    </div>
  `;
}

function renderProfileAvatar(profile) {
  if (profile.avatarDataUrl) {
    return `<img src="${escapeHtml(profile.avatarDataUrl)}" alt="${escapeHtml(profile.displayName)} 的头像" />`;
  }
  return `<span>${escapeHtml(profileInitials(profile.displayName))}</span>`;
}

function icon(name) {
  const paths = {
    home: `<path d="m3 10.5 9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-6h6v6"/>`,
    folder: `<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v8.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z"/>`,
    library: `<path d="M4 19.5V5a2 2 0 0 1 2-2h12"/><path d="M6 17h12"/><path d="M6 21h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2"/><path d="M8 7h8"/>`,
    "circle-alert": `<circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/>`,
    "message-circle": `<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-4-.96L3 20l1.2-4.6A8.4 8.4 0 1 1 21 11.5Z"/>`,
    chart: `<path d="M3 3v18h18"/><path d="M7 15v-4"/><path d="M12 15V7"/><path d="M17 15v-7"/>`,
    settings: `<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2 2 0 1 1-4 0v-.09a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-1.98.36l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.1H3a2 2 0 1 1 0-4h.09a1.8 1.8 0 0 0 1.65-1.1 1.8 1.8 0 0 0-.36-1.98l-.06-.06A2 2 0 1 1 7.15 3.93l.06.06a1.8 1.8 0 0 0 1.98.36 1.8 1.8 0 0 0 1.1-1.65V3a2 2 0 1 1 4 0v.09a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.1H21a2 2 0 1 1 0 4h-.09A1.8 1.8 0 0 0 19.4 15Z"/>`,
    "book-open": `<path d="M2 4.5A3 3 0 0 1 5 3h6v18H5a3 3 0 0 0-3 1.5Z"/><path d="M22 4.5A3 3 0 0 0 19 3h-6v18h6a3 3 0 0 1 3 1.5Z"/>`,
    "file-text": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>`,
    "user-round": `<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>`,
    "chevron-up": `<path d="m18 15-6-6-6 6"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`,
    "panel-left-close": `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>`,
    "panel-left-open": `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m13 9 3 3-3 3"/>`,
    "plus": `<path d="M12 5v14"/><path d="M5 12h14"/>`,
    "chevron-left": `<path d="m15 18-6-6 6-6"/>`,
    "upload": `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>`,
    "presentation": `<path d="M12 16v5"/><path d="M9 21h6"/><path d="M3 7h18"/><path d="M5 7v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7"/><path d="M8 11h.01"/><path d="M12 11h.01"/><path d="M16 11h.01"/>`
  };

  return `<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

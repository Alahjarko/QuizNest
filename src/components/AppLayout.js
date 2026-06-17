import { APP_NAME, APP_TAGLINE } from "../config/appMeta.js";
import { getAll } from "../services/storage/db.js";
import { getProfile, profileInitials } from "../services/profile.js";
import { escapeHtml } from "../utils/markdown.js";

let cleanupLayoutEvents = null;
const SIDEBAR_NOTEBOOK_STATE_KEY = "quiznest:sidebar:notebook-state";
const UNFILED_NOTEBOOK_STATE_ID = "__unfiled__";

export const SIDEBAR_NAV_ITEMS = [
  { path: "/", label: "首页", icon: "home", match: (segments) => segments.length === 0 },
  { path: "/notebooks", label: "笔记本", icon: "folder", match: (segments) => segments[0] === "notebooks" },
  { path: "/pdf-note", label: "PDF 笔记", icon: "file-text", match: (segments) => segments[0] === "pdf-note" },
  { path: "/sets", label: "题组库", icon: "library", match: (segments) => segments[0] === "sets" || segments[0] === "practice" },
  { path: "/wrong", label: "错题本", icon: "circle-alert", match: (segments) => segments[0] === "wrong" },
  { path: "/chat", label: "解惑", icon: "message-circle", match: (segments) => segments[0] === "chat" },
  { path: "/stats", label: "统计", icon: "chart", match: (segments) => segments[0] === "stats" }
];

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
  return `
    <div class="app-shell">
      <aside class="app-sidebar" aria-label="QuizNest 导航">
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
              <span>个人资料与统计</span>
            </button>
            <button type="button" data-nav="/settings">
              ${icon("settings")}
              <span>设置</span>
            </button>
          </div>
          <button class="sidebar-settings-button ${["settings", "stats"].includes(route.segments[0]) ? "active" : ""}" type="button" data-sidebar-settings-toggle aria-expanded="false">
            <span class="sidebar-profile-avatar">${renderProfileAvatar(profile)}</span>
            <span class="sidebar-settings-copy">
              <strong>${escapeHtml(profile.displayName)}</strong>
              <small>设置</small>
            </span>
            ${icon("chevron-up")}
          </button>
        </div>
      </aside>

      <section class="app-main">
        <header class="app-content-header">
          <div>
            <p>${escapeHtml(APP_NAME)}</p>
            <h1>${escapeHtml(title)}</h1>
          </div>
        </header>
        <main class="page" data-page-container aria-label="${escapeHtml(title)}">
          <div class="loading">正在加载...</div>
        </main>
      </section>
    </div>
  `;
}

export function bindAppLayout(root, { navigate }) {
  if (cleanupLayoutEvents) cleanupLayoutEvents();

  const menu = root.querySelector("[data-sidebar-settings-menu]");
  const toggle = root.querySelector("[data-sidebar-settings-toggle]");
  const notebookDetails = Array.from(root.querySelectorAll("[data-sidebar-notebook-id]"));

  const closeMenu = () => {
    if (!menu || !toggle) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  const toggleMenu = () => {
    if (!menu || !toggle) return;
    menu.hidden = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
  };

  root.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      closeMenu();
      navigate(button.dataset.nav);
    });
  });

  toggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu();
  });

  const onDocumentPointerDown = (event) => {
    const footer = root.querySelector(".sidebar-footer");
    if (!footer?.contains(event.target)) closeMenu();
  };

  const onDocumentKeydown = (event) => {
    if (event.key === "Escape") closeMenu();
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
  cleanupLayoutEvents = () => {
    notebookDetails.forEach((details) => details.removeEventListener("toggle", onNotebookToggle));
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onDocumentKeydown);
  };
}

function renderNavItem(item, route) {
  const active = item.match(route.segments);
  return `
    <button class="sidebar-nav-item ${active ? "active" : ""}" data-nav="${item.path}" type="button" ${active ? 'aria-current="page"' : ""}>
      ${icon(item.icon)}
      <span>${escapeHtml(item.label)}</span>
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
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`
  };

  return `<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

import { showToast } from "./components/Toast.js";
import { bindAppLayout, getAppLayoutData, renderAppLayout } from "./components/AppLayout.js";
import { renderChatPage } from "./pages/ChatPage.js";
import { renderHomePage } from "./pages/HomePage.js";
import { renderNotePage } from "./pages/NotePage.js";
import { renderNotebooksPage } from "./pages/NotebooksPage.js";
import { renderPdfNotePage } from "./pages/PdfNotePage.js";
import { renderPracticePage } from "./pages/PracticePage.js";
import { renderSetLibraryPage } from "./pages/SetLibraryPage.js";
import { renderSettingsPage } from "./pages/SettingsPage.js";
import { renderWrongBookPage } from "./pages/WrongBookPage.js";
import { openDb } from "./services/storage/db.js";
import { watchSystemTheme } from "./services/theme.js";
import { startStudyTimer } from "./services/studyTracker.js";
import { typesetMath } from "./utils/math.js";
import { getSettings } from "./services/storage/db.js";
import { performBidirectionalSync } from "./services/webdav.js";
import { checkUpdates } from "./services/updater.js";


const appRoot = document.getElementById("app");
const chatRoot = document.getElementById("chat-root");

let activeContext = {};
let chatOpen = false;
let renderVersion = 0;

function parseRoute() {
  const hash = window.location.hash || "#/";
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryString = ""] = clean.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  return {
    path: pathPart || "/",
    segments,
    query: new URLSearchParams(queryString)
  };
}

function navigate(path) {
  window.location.hash = path.startsWith("/") ? `#${path}` : `#/${path}`;
}

function setContext(context) {
  activeContext = context || {};
}

function getContext() {
  return activeContext;
}

function setChatOpen(value) {
  chatOpen = value;
  if (value) navigate("/chat");
  else refreshChat();
}

function isChatOpen() {
  return chatOpen;
}

function isStudyRouteActive() {
  const route = parseRoute();
  return ["note", "practice", "wrong"].includes(route.segments[0]) || chatOpen;
}

function pageTitle(route) {
  const first = route.segments[0] || "home";
  return (
    {
      home: "首页",
      note: "笔记",
      practice: "练习",
      sets: "题组库",
      notebooks: "笔记本",
      "pdf-note": "PDF 笔记",
      wrong: "错题本",
      chat: "解惑",
      stats: "统计",
      settings: "设置"
    }[first] || "首页"
  );
}

let autoSyncTimer = null;
let currentAutoSyncFrequency = null;

async function setupAutoSync() {
  try {
    const settings = await getSettings();
    const freq = settings.webdavSyncFrequency;
    
    if (currentAutoSyncFrequency === freq) return;
    currentAutoSyncFrequency = freq;
    
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    
    let intervalMs = 0;
    if (freq === "10m") intervalMs = 10 * 60 * 1000;
    else if (freq === "30m") intervalMs = 30 * 60 * 1000;
    else if (freq === "1h") intervalMs = 60 * 60 * 1000;
    
    if (intervalMs > 0) {
      console.log(`[AutoSync] Configured interval: ${freq}`);
      autoSyncTimer = setInterval(async () => {
        try {
          const currentSettings = await getSettings();
          if (!currentSettings.webdavUrl || !currentSettings.webdavUsername || !currentSettings.webdavPassword) return;
          
          await performBidirectionalSync();
          console.log(`[AutoSync] WebDAV sync successful at ${new Date().toISOString()}`);
          
          if (!isStudyRouteActive()) {
            renderApp();
          }
        } catch (err) {
          console.error(`[AutoSync] WebDAV sync failed: ${err.message}`);
        }
      }, intervalMs);
    }
  } catch (e) {
    console.error("[AutoSync] Setup failed", e);
  }
}

async function renderApp() {
  const current = ++renderVersion;
  const route = parseRoute();
  let pageContainer = null;

  try {
    await openDb();
    if (current !== renderVersion) return;

    const layoutData = await getAppLayoutData();
    if (current !== renderVersion) return;

    const title = pageTitle(route);
    appRoot.innerHTML = renderAppLayout({
      route,
      title,
      notes: layoutData.notes,
      notebooks: layoutData.notebooks,
      profile: layoutData.profile
    });
    bindAppLayout(appRoot, { navigate });

    pageContainer = appRoot.querySelector("[data-page-container]");
    const app = {
      route,
      navigate,
      refresh: renderApp,
      setContext,
      getContext,
      setChatOpen,
      isChatOpen,
      refreshChat,
      showToast
    };

    try {
      if (route.segments[0] === "settings") {
        await renderSettingsPage(pageContainer, app);
      } else if (route.segments[0] === "note") {
        await renderNotePage(pageContainer, app, route.segments[1]);
      } else if (route.segments[0] === "practice") {
        await renderPracticePage(pageContainer, app, route.segments[1]);
      } else if (route.segments[0] === "sets") {
        await renderSetLibraryPage(pageContainer, app);
      } else if (route.segments[0] === "notebooks") {
        await renderNotebooksPage(pageContainer, app);
      } else if (route.segments[0] === "pdf-note") {
        await renderPdfNotePage(pageContainer, app);
      } else if (route.segments[0] === "wrong") {
        await renderWrongBookPage(pageContainer, app);
      } else if (route.segments[0] === "chat") {
        await renderChatPage(pageContainer, app);
      } else if (route.segments[0] === "stats") {
        const { renderStatsPage } = await import("./pages/StatsPage.js");
        await renderStatsPage(pageContainer, app);
      } else {
        await renderHomePage(pageContainer, app);
      }
    } catch (error) {
      pageContainer.innerHTML = `<div class="error-state"><h1>页面加载失败</h1><p>${error.message}</p></div>`;
    }
    typesetMath(pageContainer);
  } catch (error) {
    appRoot.innerHTML = `<main class="page standalone-error"><div class="error-state"><h1>页面加载失败</h1><p>${error.message}</p></div></main>`;
  } finally {
    refreshChat();
    setupAutoSync();
  }
}

async function refreshChat() {
  if (chatRoot) chatRoot.innerHTML = "";
}

window.addEventListener("hashchange", renderApp);
if (!window.location.hash) window.location.hash = "#/";
startStudyTimer({ isActive: isStudyRouteActive });
// 主题偏好为“跟随系统”时，响应操作系统深浅色变化即时切换。
watchSystemTheme();
renderApp();

(async () => {
  try {
    const settings = await getSettings();
    if (settings.webdavSyncFrequency !== "manual" && settings.webdavUrl) {
      console.log("启动时触发 WebDAV 自动双向同步...");
      await performBidirectionalSync();
      console.log("启动 WebDAV 同步完成");
    }
  } catch (err) {
    console.error("启动 WebDAV 同步失败:", err);
  }
})();

// 延迟检查更新，避免影响启动性能
window.setTimeout(() => {
  checkUpdates();
}, 5000);

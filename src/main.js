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
import { startStudyTimer } from "./services/studyTracker.js";
import { typesetMath } from "./utils/math.js";

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
  }
}

async function refreshChat() {
  if (chatRoot) chatRoot.innerHTML = "";
}

window.addEventListener("hashchange", renderApp);
if (!window.location.hash) window.location.hash = "#/";
startStudyTimer({ isActive: isStudyRouteActive });
renderApp();

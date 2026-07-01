import { showInteractiveToast, showToast } from "../components/Toast.js";

const GITHUB_REPO = "Alahjarko/QuizNest";
const UPDATE_MANIFEST_URLS = [
  `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`,
  `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`
];
const UPDATE_CHECK_CACHE_KEY = "quiznest:update-check:v2";
const UPDATE_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function getCurrentAppVersion() {
  let currentVersion = window.__APP_VERSION__;
  if (!currentVersion && window.__TAURI__?.app?.getVersion) {
    try {
      currentVersion = await window.__TAURI__.app.getVersion();
    } catch (e) {
      console.warn("[updater] Tauri app.getVersion 调用失败:", e);
    }
  }
  return currentVersion || "";
}

export async function checkUpdates(options = {}) {
  const silent = options.silent !== false;
  const force = options.force === true || !silent;
  let currentVersion = "";

  try {
    currentVersion = await getCurrentAppVersion();
    if (!currentVersion) {
      throw new Error("无法获取当前应用版本");
    }

    if (!force) {
      const cached = readUpdateCheckCache(currentVersion);
      if (cached) {
        return {
          ...cached.result,
          cached: true,
          skipped: true,
          nextCheckAt: new Date(cached.checkedAt + UPDATE_CHECK_MIN_INTERVAL_MS).toISOString()
        };
      }
    }

    const { latestVersion, releaseUrl } = await fetchLatestReleaseInfo({ force });
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    if (hasUpdate) {
      showInteractiveToast(`发现新版本 v${latestVersion}，点击此处前往下载`, {
        duration: 10000,
        onClick: () => openReleaseUrl(releaseUrl)
      });
    } else if (!silent) {
      showToast(`当前已是最新版本（v${currentVersion}）`, "success");
    }

    const result = {
      ok: true,
      status: hasUpdate ? "available" : "current",
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseUrl
    };
    writeUpdateCheckCache(currentVersion, result);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      status: "error",
      message: err.message,
      currentVersion
    };
    if (currentVersion) writeUpdateCheckCache(currentVersion, result);

    if (silent) {
      console.warn("自动检查更新失败，已暂缓后续自动检查:", err);
    } else {
      showToast(`检查更新失败：${err.message}`, "error");
    }
    return result;
  }
}

async function fetchLatestReleaseInfo({ force = false } = {}) {
  const errors = [];

  for (const baseUrl of UPDATE_MANIFEST_URLS) {
    const url = force ? appendCacheBuster(baseUrl) : baseUrl;
    try {
      const res = await fetch(url, {
        cache: force ? "no-store" : "default",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const latestVersion = normalizeVersion(data.version || data.latestVersion || data.tag_name);
      if (!latestVersion) {
        throw new Error("缺少版本号");
      }

      return {
        latestVersion,
        releaseUrl: data.releaseUrl || data.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/v${latestVersion}`
      };
    } catch (err) {
      errors.push(`${sourceLabel(baseUrl)} ${err.message || err}`);
    }
  }

  throw new Error(`更新清单获取失败：${errors.join("；") || "所有来源均不可用"}`);
}

function readUpdateCheckCache(currentVersion) {
  try {
    const raw = window.localStorage?.getItem(UPDATE_CHECK_CACHE_KEY);
    if (!raw) return null;

    const cache = JSON.parse(raw);
    const checkedAt = Number(cache?.checkedAt || 0);
    if (!checkedAt || Date.now() - checkedAt >= UPDATE_CHECK_MIN_INTERVAL_MS) return null;
    if (cache.currentVersion !== currentVersion) return null;
    if (!cache.result || typeof cache.result !== "object") return null;

    return {
      checkedAt,
      result: cache.result
    };
  } catch {
    return null;
  }
}

function writeUpdateCheckCache(currentVersion, result) {
  try {
    window.localStorage?.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify({
      checkedAt: Date.now(),
      currentVersion,
      result
    }));
  } catch {
    // localStorage may be unavailable in restricted WebViews; update checks still work without cache.
  }
}

function openReleaseUrl(url) {
  const fallback = () => window.open(url, "_blank", "noopener,noreferrer");
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) {
      invoke("plugin:opener|open_url", { url }).catch((err) => {
        console.error("Failed to open URL via plugin:", err);
        fallback();
      });
      return;
    }
  } catch (err) {
    console.error("Failed to open URL via Tauri:", err);
  }
  fallback();
}

function appendCacheBuster(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

function sourceLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "更新源";
  }
}

function normalizeVersion(version) {
  return String(version || "").trim().replace(/^v/i, "");
}

function compareVersions(v1, v2) {
  const parts1 = normalizeVersion(v1).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const parts2 = normalizeVersion(v2).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

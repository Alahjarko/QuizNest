import { showInteractiveToast } from "../components/Toast.js";

const GITHUB_REPO = "Alahjarko/QuizNest";

export async function checkUpdates() {
  try {
    let currentVersion = window.__APP_VERSION__;
    if (!currentVersion && window.__TAURI__?.app?.getVersion) {
      try {
        currentVersion = await window.__TAURI__.app.getVersion();
      } catch (e) {
        console.warn("[updater] Tauri app.getVersion 调用失败:", e);
      }
    }
    if (!currentVersion) {
      console.warn(
        "[updater] 无法获取当前应用版本，跳过更新检查。window.__APP_VERSION__ =",
        window.__APP_VERSION__
      );
      return;
    }
    
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return;
    
    const data = await res.json();
    if (!data.tag_name) return;

    const latestVersion = data.tag_name.replace(/^v/, '');

    if (compareVersions(latestVersion, currentVersion) > 0) {
      showInteractiveToast(`发现新版本 v${latestVersion}，点击此处前往下载`, {
        duration: 10000,
        onClick: () => {
          const url = data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`;
          // In Tauri v2, opening URLs can be done with shell or opener plugin. 
          // If we have tauri-plugin-opener installed, we can invoke it. 
          // Otherwise, window.open is a generic fallback that works in some contexts.
          window.__TAURI__.core.invoke("plugin:opener|open_url", { url }).catch(err => {
            console.error("Failed to open URL via plugin:", err);
            // Fallback for older configurations or browser environments
            window.open(url, "_blank");
          });
        }
      });
    }
  } catch (err) {
    console.error("自动检查更新失败:", err);
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

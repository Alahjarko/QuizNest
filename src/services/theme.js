// 主题（浅色 / 深色 / 跟随系统）核心模块。
// 偏好持久化在 localStorage，应用时在 <html> 上打 light/dark class。
// index.html 的内联脚本会在首屏前完成首次 apply，避免闪烁（FOUC）。

export const THEME_KEY = "quiznest:theme";
export const THEME_VALUES = ["light", "dark", "auto"];
export const DEFAULT_THEME = "auto";

const root = typeof document !== "undefined" ? document.documentElement : null;
const darkMedia = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

/** 读取持久化的主题偏好；非法值兜底为 auto。 */
export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEME_VALUES.includes(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** auto -> 根据系统当前深浅色解析为实际 light/dark；light/dark 原样返回。 */
export function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") return preference;
  return darkMedia && darkMedia.matches ? "dark" : "light";
}

/** 根据偏好（light/dark/auto）在 <html> 上应用对应 class。 */
export function applyTheme(preference) {
  if (!root) return;
  const resolved = resolveTheme(preference);
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
}

/** 保存偏好并立即应用。 */
export function setTheme(preference) {
  const next = THEME_VALUES.includes(preference) ? preference : DEFAULT_THEME;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* localStorage 不可用时降级为仅本次会话生效 */
  }
  applyTheme(next);
}

/**
 * 监听系统深浅色变化；仅当偏好为 auto 时重新 apply。
 * 应在应用启动时调用一次。
 */
export function watchSystemTheme() {
  if (!darkMedia || typeof darkMedia.addEventListener !== "function") return;
  darkMedia.addEventListener("change", () => {
    if (getStoredTheme() === "auto") applyTheme("auto");
  });
}

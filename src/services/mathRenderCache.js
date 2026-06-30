import { deleteHard, get, getAll, put } from "./storage/db.js";

export const MATH_RENDERER_VERSION = "mathjax-svg-v1";

const STORE = "mathRenderCache";
const MAX_MEMORY_ITEMS = 500;
const MAX_PERSISTED_ITEMS = 2500;

const memoryCache = new Map();
let cleanupQueued = false;

export async function createMathCacheKey({ tex, display }) {
  const payload = JSON.stringify({
    renderer: MATH_RENDERER_VERSION,
    display: Boolean(display),
    tex: String(tex || "")
  });
  const digest = await sha256(payload);
  return `${MATH_RENDERER_VERSION}:${digest}`;
}

export async function getCachedMathSvg(key) {
  if (!key) return "";
  const memoryValue = memoryCache.get(key);
  if (memoryValue) return memoryValue;

  try {
    const cached = await get(STORE, key);
    if (!cached || cached.rendererVersion !== MATH_RENDERER_VERSION || !cached.svg) return "";
    remember(key, cached.svg);
    return cached.svg;
  } catch (error) {
    console.warn("读取公式缓存失败", error);
    return "";
  }
}

export async function saveCachedMathSvg({ key, source, tex, display, svg }) {
  if (!key || !svg) return;
  remember(key, svg);

  try {
    await put(STORE, {
      id: key,
      rendererVersion: MATH_RENDERER_VERSION,
      source: String(source || ""),
      tex: String(tex || ""),
      display: Boolean(display),
      svg,
      updatedAt: new Date().toISOString()
    });
    queueCleanup();
  } catch (error) {
    console.warn("写入公式缓存失败", error);
  }
}

function remember(key, svg) {
  if (memoryCache.has(key)) memoryCache.delete(key);
  memoryCache.set(key, svg);
  while (memoryCache.size > MAX_MEMORY_ITEMS) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
}

function queueCleanup() {
  if (cleanupQueued) return;
  cleanupQueued = true;
  window.setTimeout(async () => {
    cleanupQueued = false;
    try {
      const rows = await getAll(STORE, true);
      if (rows.length <= MAX_PERSISTED_ITEMS) return;
      const expired = rows
        .slice()
        .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")))
        .slice(0, rows.length - MAX_PERSISTED_ITEMS);
      await Promise.all(expired.map((row) => deleteHard(STORE, row.id)));
    } catch (error) {
      console.warn("清理公式缓存失败", error);
    }
  }, 30000);
}

async function sha256(text) {
  if (window.crypto?.subtle) {
    const data = new TextEncoder().encode(text);
    const buffer = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHash(text);
}

function fallbackHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

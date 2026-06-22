import { buildLearningBackup, importLearningBackup } from "./backup.js";
import { getSettings, saveSettings } from "./storage/db.js";

function getWebdavAuth(settings) {
  const credentials = `${settings.webdavUsername}:${settings.webdavPassword}`;
  const utf8Encode = new TextEncoder().encode(credentials);
  const binaryString = String.fromCodePoint(...utf8Encode);
  return "Basic " + btoa(binaryString);
}

async function doWebdavRequest(method, url, authHeader, body = null) {
  // If running inside Tauri, use the Rust command to completely bypass CORS
  if (typeof window !== "undefined" && window.__TAURI__) {
    return window.__TAURI__.core.invoke("webdav_request", {
      method,
      url,
      authHeader,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : null
    });
  }

  // Fallback to browser fetch (might fail due to CORS)
  const headers = { "Authorization": authHeader };
  if (method === "PROPFIND") headers["Depth"] = "0";
  if (method === "PUT") headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : null
  });

  if (!response.ok) {
    throw new Error(response.status.toString());
  }
  return response.text();
}

function getWebdavBaseUrl(url) {
  let cleanUrl = url.replace(/\/$/, "");
  // 如果用户填写的刚好是坚果云等网盘的根目录 (dav)，因为坚果云根目录不允许直接放文件
  // 我们自动为其追加一个 /QuizNest 文件夹
  if (cleanUrl.endsWith("/dav")) {
    cleanUrl += "/QuizNest";
  }
  return cleanUrl;
}

export async function testWebdavConnection(settings) {
  if (!settings.webdavUrl) throw new Error("WebDAV 地址不能为空");
  
  try {
    const baseUrl = getWebdavBaseUrl(settings.webdavUrl);
    // 尝试探测目录，哪怕探测失败也会返回错误码
    await doWebdavRequest("PROPFIND", baseUrl, getWebdavAuth(settings));
    return true;
  } catch (err) {
    const msg = err.message || err.toString();
    if (msg.includes("401")) throw new Error("用户名或密码错误 (HTTP 401)");
    if (msg.includes("404")) {
      // 404 说明目录不存在，这是正常的（还没上传过），只要不是 401 就算连接成功
      return true; 
    }
    if (msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("Network Error")) {
      throw new Error("网络连接失败，请检查地址是否正确。");
    }
    // 只要能通，遇到 405/409 等也认为连接成功
    return true;
  }
}

export async function syncToWebdav() {
  const settings = await getSettings();
  if (!settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
    throw new Error("请先配置完整的 WebDAV 信息");
  }
  
  const backup = await buildLearningBackup();
  const baseUrl = getWebdavBaseUrl(settings.webdavUrl);
  const fileUrl = baseUrl + "/quiznest-backup.json";
  
  try {
    // 自动尝试创建文件夹（不管它存不存在，如果已存在会忽略报错）
    try {
      await doWebdavRequest("MKCOL", baseUrl + "/", getWebdavAuth(settings));
    } catch (e) { /* ignore existing */ }
    
    await doWebdavRequest("PUT", fileUrl, getWebdavAuth(settings), backup);
    await saveSettings({ ...settings, lastWebdavSyncAt: new Date().toISOString() });
  } catch (err) {
    const msg = err.message || err.toString();
    throw new Error(`上传备份失败: ${msg}`);
  }
}

export async function syncFromWebdav() {
  const settings = await getSettings();
  if (!settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
    throw new Error("请先配置完整的 WebDAV 信息");
  }
  
  const baseUrl = getWebdavBaseUrl(settings.webdavUrl);
  const fileUrl = baseUrl + "/quiznest-backup.json";
  
  try {
    const data = await doWebdavRequest("GET", fileUrl, getWebdavAuth(settings));
    const result = await importLearningBackup(data);
    await saveSettings({ ...settings, lastWebdavSyncAt: new Date().toISOString() });
    return result;
  } catch (err) {
    const msg = err.message || err.toString();
    if (msg.includes("404")) throw new Error("云端未找到备份文件，请先推送一次。");
    throw new Error(`下载备份失败: ${msg}`);
  }
}

import { buildLearningBackup, importLearningBackup } from "./backup.js";
import { getSettings, saveSettings } from "./storage/db.js";

function getWebdavAuth(settings) {
  // Use UTF-8 encoding for credentials before base64 to avoid issues with special chars
  const credentials = `${settings.webdavUsername}:${settings.webdavPassword}`;
  // Using btoa directly is fine for ASCII, but for full utf-8 we should encode
  const utf8Encode = new TextEncoder().encode(credentials);
  const binaryString = String.fromCodePoint(...utf8Encode);
  return "Basic " + btoa(binaryString);
}

export async function testWebdavConnection(settings) {
  if (!settings.webdavUrl) throw new Error("WebDAV 地址不能为空");
  
  try {
    const response = await fetch(settings.webdavUrl, {
      method: "PROPFIND",
      headers: {
        "Authorization": getWebdavAuth(settings),
        "Depth": "0"
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) throw new Error("用户名或密码错误 (HTTP 401)");
      if (response.status === 404) throw new Error("WebDAV 地址不存在 (HTTP 404)");
      throw new Error(`连接失败 (HTTP ${response.status})`);
    }
    return true;
  } catch (err) {
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      throw new Error("网络错误或跨域拦截 (CORS)，请检查地址是否正确或网盘是否支持本地应用直连。");
    }
    throw err;
  }
}

export async function syncToWebdav() {
  const settings = await getSettings();
  if (!settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
    throw new Error("请先配置完整的 WebDAV 信息");
  }
  
  const backup = await buildLearningBackup();
  const fileUrl = settings.webdavUrl.replace(/\/$/, "") + "/quiznest-backup.json";
  
  const response = await fetch(fileUrl, {
    method: "PUT",
    headers: {
      "Authorization": getWebdavAuth(settings),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(backup, null, 2)
  });
  
  if (!response.ok) throw new Error(`上传备份失败: HTTP ${response.status}`);
  
  await saveSettings({ ...settings, lastWebdavSyncAt: new Date().toISOString() });
}

export async function syncFromWebdav() {
  const settings = await getSettings();
  if (!settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
    throw new Error("请先配置完整的 WebDAV 信息");
  }
  
  const fileUrl = settings.webdavUrl.replace(/\/$/, "") + "/quiznest-backup.json";
  
  const response = await fetch(fileUrl, {
    method: "GET",
    headers: {
      "Authorization": getWebdavAuth(settings)
    }
  });
  
  if (!response.ok) {
    if (response.status === 404) throw new Error("云端未找到 quiznest-backup.json 文件");
    throw new Error(`下载备份失败: HTTP ${response.status}`);
  }
  
  const data = await response.text();
  const result = await importLearningBackup(data);
  await saveSettings({ ...settings, lastWebdavSyncAt: new Date().toISOString() });
  return result;
}

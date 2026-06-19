import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(root, "src-tauri");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"));
const productName = tauriConfig.productName || "QuizNest";
const version = tauriConfig.version || "0.1.0";
const outputApk = path.join(root, `${productName}_${version}_arm64-v8a.apk`);
const alignedApk = path.join(root, `${productName}_${version}_arm64-v8a.aligned.apk`);
const isWindows = process.platform === "win32";
const androidHome = process.env.ANDROID_HOME || path.join(os.homedir(), "Library", "Android", "sdk");
const javaHome = resolveJavaHome();
const ndkHome = process.env.NDK_HOME || findInstalledNdk(androidHome);
const buildToolsDir = findInstalledBuildTools(androidHome);
const debugKeystore = path.join(os.homedir(), ".android", "debug.keystore");

// Windows 上 spawnSync 调用 .bat/.cmd 需要走 shell；普通可执行文件/脚本直接调用。
function run(command, args, options = {}) {
  const useShell = isWindows && /\.(bat|cmd)$/i.test(command);
  const result = spawnSync(useShell ? `"${command}"` : command, useShell ? args : args, {
    cwd: options.cwd || root,
    stdio: "inherit",
    shell: useShell,
    env: {
      ...process.env,
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || androidHome,
      NDK_HOME: ndkHome,
      JAVA_HOME: javaHome,
      PATH: [
        path.join(androidHome, "platform-tools"),
        path.join(androidHome, "cmdline-tools", "latest", "bin"),
        javaHome ? path.join(javaHome, "bin") : "",
        process.env.PATH || ""
      ].join(path.delimiter)
    }
  });
  return result.status ?? 1;
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

  if (process.platform === "darwin") {
    const javaHomeResult = spawnSync("/usr/libexec/java_home", ["-v", "17"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false
    });
    const detectedHome = javaHomeResult.stdout?.trim();
    if (javaHomeResult.status === 0 && detectedHome) return detectedHome;
    return "/Library/Java/JavaVirtualMachines/liberica-jdk-17.jdk/Contents/Home";
  }

  throw new Error(
    "未设置 JAVA_HOME。请先设置 JAVA_HOME 指向 JDK 17（Android Gradle Plugin 要求）。"
  );
}

function findInstalledNdk(sdkRoot) {
  const ndkRoot = path.join(sdkRoot, "ndk");
  if (!fs.existsSync(ndkRoot)) {
    throw new Error(`未找到 Android NDK：${ndkRoot}`);
  }

  const versions = fs.readdirSync(ndkRoot).filter((entry) => {
    return fs.statSync(path.join(ndkRoot, entry)).isDirectory();
  });
  if (versions.length === 0) {
    throw new Error(`Android NDK 目录为空：${ndkRoot}`);
  }

  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return path.join(ndkRoot, versions.at(-1));
}

function findInstalledBuildTools(sdkRoot) {
  const buildToolsRoot = path.join(sdkRoot, "build-tools");
  if (!fs.existsSync(buildToolsRoot)) {
    throw new Error(`未找到 Android build-tools：${buildToolsRoot}`);
  }

  // Windows 上 apksigner 是 apksigner.bat，zipalign 是 zipalign.exe；其他平台无扩展名。
  const apksignerNames = isWindows ? ["apksigner.bat", "apksigner"] : ["apksigner"];
  const versions = fs.readdirSync(buildToolsRoot).filter((entry) => {
    return apksignerNames.some((name) => fs.existsSync(path.join(buildToolsRoot, entry, name)));
  });
  if (versions.length === 0) {
    throw new Error(`Android build-tools 中没有找到 apksigner：${buildToolsRoot}`);
  }

  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return path.join(buildToolsRoot, versions.at(-1));
}

function resolveBuildTool(name) {
  // zipalign 在 Windows 上是 .exe，apksigner 是 .bat；其他平台直接用名字。
  const candidates = isWindows
    ? [`${name}.exe`, `${name}.bat`, name]
    : [name];
  for (const candidate of candidates) {
    const full = path.join(buildToolsDir, candidate);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(`build-tools 中未找到 ${name}：${buildToolsDir}`);
}

function findBuiltApk() {
  const apkRoot = path.join(tauriDir, "gen", "android", "app", "build", "outputs", "apk");
  if (!fs.existsSync(apkRoot)) return "";

  const stack = [apkRoot];
  const candidates = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.endsWith(".apk") && entry.name.includes("arm64")) {
        candidates.push(fullPath);
      }
    }
  }

  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || "";
}

function keytoolPath() {
  const candidate = path.join(javaHome, "bin", isWindows ? "keytool.exe" : "keytool");
  if (fs.existsSync(candidate)) return candidate;
  return "keytool";
}

function ensureDebugKeystore() {
  if (fs.existsSync(debugKeystore)) return;

  fs.mkdirSync(path.dirname(debugKeystore), { recursive: true });
  const status = run(keytoolPath(), [
    "-genkeypair",
    "-v",
    "-keystore",
    debugKeystore,
    "-storepass",
    "android",
    "-alias",
    "androiddebugkey",
    "-keypass",
    "android",
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "10000",
    "-dname",
    "CN=Android Debug,O=Android,C=US"
  ]);
  if (status !== 0) {
    throw new Error("生成 Android debug keystore 失败。");
  }
}

function signApk(inputApk) {
  ensureDebugKeystore();

  const zipalign = resolveBuildTool("zipalign");
  const apksigner = resolveBuildTool("apksigner");

  fs.rmSync(alignedApk, { force: true });
  const alignStatus = run(zipalign, ["-f", "-p", "4", inputApk, alignedApk]);
  if (alignStatus !== 0) {
    throw new Error("APK zipalign 失败。");
  }

  fs.rmSync(outputApk, { force: true });
  const signStatus = run(apksigner, [
    "sign",
    "--ks",
    debugKeystore,
    "--ks-key-alias",
    "androiddebugkey",
    "--ks-pass",
    "pass:android",
    "--key-pass",
    "pass:android",
    "--out",
    outputApk,
    alignedApk
  ]);
  if (signStatus !== 0) {
    throw new Error("APK 签名失败。");
  }

  const verifyStatus = run(apksigner, ["verify", "--verbose", outputApk]);
  if (verifyStatus !== 0) {
    throw new Error("APK 签名验证失败。");
  }

  fs.rmSync(alignedApk, { force: true });
}

const syncStatus = run(process.execPath, [path.join(root, "scripts", "sync-dist.mjs")]);
if (syncStatus !== 0) {
  throw new Error("同步 dist 失败。");
}

const buildStatus = run(
  "cargo",
  ["tauri", "android", "build", "--target", "aarch64", "--apk", "--split-per-abi", "--ci"],
  { cwd: tauriDir }
);
if (buildStatus !== 0) {
  throw new Error("Android arm64-v8a APK 构建失败。");
}

const builtApk = findBuiltApk();
if (!builtApk) {
  throw new Error("构建完成，但没有找到 arm64-v8a APK。");
}

signApk(builtApk);
console.log(`已生成 Android 安装包：${outputApk}`);

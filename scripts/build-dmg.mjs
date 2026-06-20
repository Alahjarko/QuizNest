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
const archLabel = process.arch === "arm64" ? "aarch64" : process.arch;
const outputDmg = path.join(root, `${productName}_${version}_${archLabel}.dmg`);
const targetDir = path.join(tauriDir, "target");
let stagingDir = "";
let temporaryDmg = "";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: "inherit",
    shell: false
  });
  return result.status ?? 1;
}

function findAppBundle() {
  const macosBundleDir = path.join(targetDir, "release", "bundle", "macos");
  if (!fs.existsSync(macosBundleDir)) return "";
  const appName = fs.readdirSync(macosBundleDir).find((entry) => entry.endsWith(".app"));
  return appName ? path.join(macosBundleDir, appName) : "";
}

function findDmgBundle() {
  const dmgBundleDir = path.join(targetDir, "release", "bundle", "dmg");
  if (!fs.existsSync(dmgBundleDir)) return "";
  const dmgName = fs.readdirSync(dmgBundleDir).find((entry) => entry.endsWith(".dmg"));
  return dmgName ? path.join(dmgBundleDir, dmgName) : "";
}

function signAppBundle(appBundle) {
  const signStatus = run("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    appBundle
  ]);
  if (signStatus !== 0) {
    throw new Error("macOS app 签名失败。");
  }

  const verifyStatus = run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appBundle
  ]);
  if (verifyStatus !== 0) {
    throw new Error("macOS app 签名校验失败。");
  }
}

function createDmgFromApp(appBundle) {
  stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiznest-dmg-"));
  temporaryDmg = path.join(os.tmpdir(), `${productName}_${version}_${archLabel}_${process.pid}.dmg`);
  fs.rmSync(temporaryDmg, { force: true });
  fs.cpSync(appBundle, path.join(stagingDir, `${productName}.app`), { recursive: true });
  fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"), "dir");

  const dmgStatus = run("hdiutil", [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    stagingDir,
    "-ov",
    "-format",
    "UDZO",
    temporaryDmg
  ]);
  if (dmgStatus !== 0) {
    throw new Error("DMG 生成失败。");
  }
  fs.rmSync(outputDmg, { force: true });
  fs.copyFileSync(temporaryDmg, outputDmg);
}

function cleanBuildCache() {
  if (process.env.QUIZNEST_CLEAN_BUILD_CACHE === "1") {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

try {
  if (process.platform !== "darwin") {
    throw new Error("build:dmg 目前只在 macOS 上生成 DMG。");
  }

  const syncStatus = run(process.execPath, [path.join(root, "scripts", "sync-dist.mjs")]);
  if (syncStatus !== 0) {
    throw new Error("同步 dist 失败。");
  }

  const buildStatus = run("cargo", ["tauri", "build"], { cwd: tauriDir });
  const appBundle = findAppBundle();
  if (!appBundle) {
    throw new Error(
      buildStatus === 0
        ? "Tauri 构建完成，但没有找到可用于封包的 .app。"
        : "Tauri 构建失败，且没有找到可用于封包的 .app。"
    );
  }
  if (buildStatus !== 0) {
    console.warn("Tauri 自带封包未完全成功，将使用已生成的 .app 继续制作 DMG。");
  }

  const builtInDmg = findDmgBundle();
  if (builtInDmg) {
    console.log(`忽略 Tauri 自带 DMG，改用重新签名后的 .app 制作安装包：${builtInDmg}`);
  }
  signAppBundle(appBundle);
  createDmgFromApp(appBundle);

  console.log(`已生成安装包：${outputDmg}`);
} finally {
  if (stagingDir) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  if (temporaryDmg) {
    fs.rmSync(temporaryDmg, { force: true });
  }
  cleanBuildCache();
}

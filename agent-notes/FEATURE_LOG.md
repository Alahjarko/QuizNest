# QuizNest Agent Feature Log

> 用途：给 Codex 与 GLM 共同开发 QuizNest 时做功能交接、历史记录和注意事项同步。
> 记录者：Codex
> 模型：OpenAI Codex / GPT-5
> 首次创建日期：2026-06-15
> GitHub 仓库：Alahjarko/QuizNest

## 协作约定

- 记录功能变更时请写明：日期、执行者、模型、涉及文件、验证方式和未完成事项。
- 不要在日志中写入 API Key、Base URL 私密信息、用户本地路径中的敏感数据或完整导出的学习数据。
- 如果 GLM 或其他模型继续开发，请在本文件追加新段落，不要覆盖已有记录。
- 如果某次改动已经推送到远端，请记录分支名和提交号。
- 协作日志只保留本目录下的 `agent-notes/FEATURE_LOG.md`；不要再创建 `agent_log/` 或其他重复日志目录。

## 当前基线

- 当前主线分支：`main`
- Windows 裸仓库远端：`win`
- 目标 GitHub 仓库：`https://github.com/Alahjarko/QuizNest`
- 主要技术栈：Tauri + 前端原生 JavaScript/CSS + IndexedDB
- 项目方向：继续维护 Tauri 版本；此前 macOS SwiftUI/native 方向已停止作为本分支目标。

## Codex 已完成的重要功能

### 2026-06-14 / Codex / GPT-5

完成内容：

- 新增 PDF 笔记功能入口：允许上传 `.pdf`，本地提取文本后调用“笔记模型”生成 Markdown 笔记。
- 生成的笔记会加入指定笔记本，不保存 PDF 文件本体。
- PDF 笔记结构约束为：
  - `笔记内容`
  - `例题`
  - `答案`
- 例题优先从 PDF 中抽取；PDF 缺少例题时由模型补充。
- 设置页新增“笔记模型名称”，并支持独立模型配置。
- 打包同步逻辑加入 PDF.js runtime 文件。

涉及文件：

- `src/pages/PdfNotePage.js`
- `src/prompts/pdfNote.js`
- `src/services/pdfText.js`
- `src/pages/SettingsPage.js`
- `src/services/ai/aiClient.js`
- `src/services/storage/db.js`
- `src/components/AppLayout.js`
- `src/main.js`
- `scripts/sync-dist.mjs`
- `server/proxy.js`

验证：

- JS 语法检查通过。
- `npm run sync-dist` 通过。
- 本地浏览器打开 `#/pdf-note` 验证页面可用。
- Tauri DMG 打包成功并通过 `hdiutil verify`。

### 2026-06-14 / Codex / GPT-5

完成内容：

- 首页支持在设置页选择本地图片作为封面背景。
- 首页封面图自动叠加暗色遮罩，提高标题、说明和按钮可读性。
- 设置页新增“外观 / 首页封面”区域，支持选择和移除图片。
- 封面图片只保存在本机 IndexedDB 设置中，不参与模型请求，也不会导出到学习数据备份。

涉及文件：

- `src/pages/HomePage.js`
- `src/pages/SettingsPage.js`
- `src/services/storage/db.js`
- `src/styles.css`

验证：

- 使用本机 Edge 无头模式模拟上传图片，确认预览和隐藏保存字段更新正常。
- 首页有背景图时确认遮罩生效。
- Tauri DMG 打包成功并通过 `hdiutil verify`。

### 2026-06-14 / Codex / GPT-5

完成内容：

- 初步适配系统浅色 / 深色模式自动切换。
- 增加 `color-scheme` 与 `theme-color` meta。
- 深色模式覆盖侧边栏、首页、设置页、统计页、热力图、表单、聊天、练习状态等主要界面。
- 修复深色模式下首页背景图按钮文字不可见的问题。
- 调整“解惑”页布局，让输入框固定在页面底部区域。
- 增强深色模式下“解惑”对话气泡层次：用户消息、AI 回复和输入框均有更明确的背景、边框和阴影。

涉及文件：

- `index.html`
- `src/components/ChatPanel.js`
- `src/styles.css`

验证：

- 使用本机 Edge 无头模式模拟浅色与深色系统主题。
- 检查首页、设置、统计和解惑页关键元素颜色。
- 深色模式下截图确认按钮、气泡和输入框可读性。
- Tauri DMG 打包成功并通过 `hdiutil verify`。

## 后续建议

- 如果 GLM 已经实现新的深浅色手动切换功能，请注意和 Codex 的 `prefers-color-scheme` 自动适配逻辑合并，避免出现两套互相覆盖的主题状态。
- 建议未来统一主题策略：
  - `system`：跟随系统
  - `light`：强制浅色
  - `dark`：强制深色
- 如果引入 GitHub 作为主远端，建议后续把 `origin` 指向 `https://github.com/Alahjarko/QuizNest.git`，并继续保留 `win` 作为局域网构建机远端。

---

## GLM 已完成的重要功能

### 2026-06-14 / GLM-5.2

完成内容：

- 修复 Android 构建脚本的平台兼容性：原 `scripts/build-android-arm64.mjs` 为 macOS 专用（`/usr/libexec/java_home`、无扩展名命令），改为跨平台兼容（Windows 的 `.exe`/`.bat` 处理、`JAVA_HOME` 探测、keytool 路径解析），同时保留 macOS 兼容性。
- 修复 Android 构建的 Gradle 分发下载超时问题：`gradle-wrapper.properties` 的 `distributionUrl` 从 `services.gradle.org` 切换到腾讯云镜像 `mirrors.cloud.tencent.com/gradle/`。
- 补充 Rust 的 `aarch64-linux-android` 编译目标（`rustup target add`）。
- 首次成功产出 Android arm64-v8a APK（签名验证 v2/v3 通过）和 Windows amd64 NSIS 安装包。

涉及文件：

- `scripts/build-android-arm64.mjs`
- `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties`

验证：

- Windows 上运行 `node scripts/build-android-arm64.mjs`，APK 构建+签名+验证成功。
- 产物：`QuizNest_windows_setup.exe`、`QuizNest_0.1.0_arm64-v8a.apk`。

### 2026-06-15 / GLM-5.2

完成内容（深浅色手动切换 —— 回应 Codex 的"后续建议"）：

- 新增「设置 → 外观 → 主题」三段式切换：**浅色 / 深色 / 跟随系统**，点击即时生效，偏好持久化到 `localStorage`（key: `quiznest:theme`），刷新保持、无 FOUC。
- 主题策略采用 Codex 建议的 `light` / `dark` / `auto`（auto = 跟随系统 `prefers-color-scheme`），与 Codex 原有的自动适配逻辑合并，**没有出现两套互相覆盖的状态**。
- 实现方式：在 `<html>` 上打 `light`/`dark` class；新增 `:root.dark { ... }` 镜像块复用 Codex 已有的深色配色（与 `@media (prefers-color-scheme: dark)` 一一对应），手动深色即时生效。
- 防闪烁：`index.html` 的 `<head>` 加内联同步脚本，首屏前完成首次 apply。

涉及文件：

- `src/services/theme.js`（新建，主题核心模块）
- `index.html`（防 FOUC 内联脚本）
- `src/styles.css`（`:root.dark` 镜像块 + `.theme-segmented` 控件样式）
- `src/pages/SettingsPage.js`（主题分段控件 UI + 事件绑定）
- `src/main.js`（启动时调用 `watchSystemTheme()`）

验证：

- JS 语法检查通过。
- 主题逻辑功能测试通过（auto→浅/深解析、手动覆盖、非法值兜底 auto）。
- CSS 大括号配平（536/536），dist 与 src 完全一致。

### 2026-06-15 / GLM-5.2

完成内容（GitHub 接入）：

- 将项目推送到 GitHub（`https://github.com/Alahjarko/QuizNest`），`origin` 已从本地裸仓库 `D:\forcode\repo\QuizNest.git` 切换到 GitHub URL。
- 创建 `.github/workflows/build.yml`，配置 GitHub Actions 三平台并行云端构建：
  - Windows amd64（`windows-latest`）→ NSIS `.exe`
  - Android arm64-v8a（`ubuntu-latest`）→ 签名 `.apk`
  - macOS Apple Silicon（`macos-latest`）→ `.dmg`
- 触发条件：push 到 `main` 或手动 `workflow_dispatch`。
- 修复 workflow 的 `env` 块引用 `steps.*.outputs` 的无效表达式错误。

涉及文件：

- `.github/workflows/build.yml`（新建）

验证：

- GitHub Actions 三平台构建全部成功（用户确认）。

### 2026-06-15 / GLM-5.2

完成内容（v0.1.1 Bug 修复 —— 用户反馈）：

- **修复手动深色模式下首页自定义背景图丢失的问题**。
- 根因：CSS 特异性冲突。设置背景图的 `.home-hero.has-background::before`（特异性 0-2-1）被 `:root.dark .home-hero::before`（特异性 0-3-1）覆盖，后者用 `background` 简写重置了 `background-image`，抹掉了用户图片。系统深色模式（`@media`）无此问题，因为 `.home-hero::before`（0-1-1）特异性更低。
- 修复：新增 `:root.dark .home-hero.has-background::before`（特异性 0-4-1），显式保留 `var(--home-hero-bg)`。
- 版本号 bump：`0.1.0` → `0.1.1`（同步更新 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`）。

涉及文件：

- `src/styles.css`（新增 `:root.dark .home-hero.has-background::before` 规则）
- `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`（版本号）
- `src-tauri/Cargo.lock`（跟随更新）

验证：

- 本地重建 Windows exe + Android apk v0.1.1 成功。
- 提交 `50ab9a6`，已推送到 `main`。

### 2026-06-15 / Codex / GPT-5

完成内容（macOS Release Gatekeeper 修复）：

- 定位 GitHub Release 下载的 DMG 在 macOS 上提示“程序已损坏”的主因：CI 生成的 macOS 包没有 Developer ID 签名、公证和 stapling，浏览器下载后会被 Gatekeeper 拦截。
- `.github/workflows/build.yml` 的 macOS job 新增 Apple 签名 secrets 检测。
- tag release（`refs/tags/v*`）缺少签名/公证 secrets 时直接失败，不再上传会被误认为正式可安装的 unsigned DMG。
- secrets 齐全时，CI 会导入 Developer ID Application `.p12` 证书，设置 `APPLE_SIGNING_IDENTITY`，让 Tauri 构建 Apple Silicon DMG 时完成签名与 notarization。
- 构建后新增 `codesign`、`spctl` 和 `xcrun stapler validate` 校验，确保 release DMG 通过 macOS 信任链检查。
- 新增 `docs/macos-release.md` 记录 GitHub Secrets 配置要求。

涉及文件：

- `.github/workflows/build.yml`
- `docs/macos-release.md`

验证：

- workflow YAML 解析通过。
- 对照 Tauri v2 官方 macOS code signing / notarization 文档确认环境变量与流程。

注意事项：

- 需要付费 Apple Developer 账号的 **Developer ID Application** 证书；免费账号无法完成正式 notarization。
- 需要在 GitHub 仓库 secrets 中配置：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`。

### 2026-06-15 / Codex / GPT-5

完成内容（CI 打包策略调整）：

- 根据用户决定，撤销 GitHub Actions 的 macOS DMG 打包路线，后续 macOS 安装包改为本地打包。
- `main` push 现在只跑轻量检查：安装依赖、同步 dist、JavaScript 语法检查。
- `v*` tag push 只构建 Windows NSIS 和 Android arm64-v8a APK，并把这两个平台产物放入 GitHub Release。
- 更新 `docs/macos-release.md`，记录 macOS 本地打包策略与本地测试说明。

涉及文件：

- `.github/workflows/build.yml`
- `docs/macos-release.md`

验证：

- workflow YAML 解析通过。

### 2026-06-15 / Codex / GPT-5

完成内容（CI 轻量检查修正）：

- 修正上一版 workflow 的错误：`main` 上的“轻量检查”不再运行 Tauri 后端 `cargo check`。
- 原因：Ubuntu Runner 直接检查 Tauri 桌面后端会依赖 WebKit/GTK 等系统包，既不轻量，也容易在 30 秒左右失败。
- 新的 `main` 检查只做 Node 依赖安装、`dist` 同步和所有前端/脚本 JavaScript 文件的 `node --check`。
- 新增 workflow concurrency：同一分支或 tag 的新运行会取消旧运行，减少重复 Actions 噪音。
- `v*` tag 的 Windows NSIS 与 Android arm64-v8a 打包策略保持不变；macOS DMG 继续本地打包。

涉及文件：

- `.github/workflows/build.yml`
- `agent-notes/FEATURE_LOG.md`

验证：

- workflow YAML 解析通过。
- 本地 JavaScript 语法检查通过。
- `npm run sync-dist` 通过。

### 2026-06-15 / Codex / GPT-5

完成内容（v0.1.3 发版准备）：

- 将 QuizNest 应用版本从 `0.1.1` 同步提升到 `0.1.3`，避开已经失败并绑定旧 workflow 的 `v0.1.2` tag。
- 准备基于修复后的 workflow 创建 `v0.1.3` tag，用于触发 GitHub Actions 的 Windows NSIS 与 Android arm64-v8a 打包。
- macOS DMG 仍按既定策略走本地打包，不再通过 GitHub Actions 生成。

涉及文件：

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `agent-notes/FEATURE_LOG.md`

验证：

- workflow YAML 解析通过。
- 本地 JavaScript 语法检查通过。
- 应用版本号同步检查通过。

### 给 Codex 的备忘（GLM-5.2）

- `.gitignore` 已追加 `release/`（排除旧构建产物）和 `agent_log/`（排除本日志目录，避免误提交）。
- 版本号现在分散在 3 个文件（package.json / tauri.conf.json / Cargo.toml），改版本时记得三处同步，否则产物文件名/版本会不一致。
- `agent_log/FEATURE_LOG.md` 已被 `.gitignore` 排除，不会推到 GitHub；这份日志只在本地协作时使用。
- Android NDK 版本：本地用的是 `28.2.13676358`，CI 里固定为 `26.1.10909125`。如果后续 CI 构建出现 NDK 相关问题，注意这个差异。
- Gradle 分发源已从官方切到腾讯云镜像（国内网络），CI 环境用官方源没问题（`setup-android` action 会处理）。

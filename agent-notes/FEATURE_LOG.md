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

### 2026-06-16 / GLM-5.2

完成内容（PPT 笔记功能 —— 支持 .pptx 上传做笔记）：

- 复用现有 `/pdf-note` 笔记页，文件输入扩展为同时接受 `.pdf` 与 `.pptx`，按类型自动分流，无需新增路由或侧边栏入口。
- 关键决策：**不生成真实 PDF 文件**。现有 PDF 笔记链路本质是"抽文本 → 喂笔记模型"，模型只读文本从不读图，因此 PPT 只需把幻灯片文字抽出来即可，把"渲染 PDF（极难）"降级为"PPTX 文本抽取（可行）"。
- 新增 `src/services/pptxText.js`，与 `pdfText.js` 形成镜像：用 jszip 解包 .pptx，遍历 `ppt/slides/slideN.xml`，用 `DOMParser` 抽取 `<a:t>` 文本节点（DrawingML 文本），按 `<a:p>` 段落聚合。返回结构与 `extractPdfText` 完全对齐（`fileName` / `pageCount` / `pages[]` / `text` / `truncated` 等），下游提示词与入库逻辑零改动。
- 幻灯片按数字排序（`slideNumberOf` 提取页号比较，规避 `slide10 < slide2` 的字典序坑）；干扰文件（`[Content_Types].xml`、`_rels` 等）被正则严格过滤。
- jszip 只发 UMD（无 ESM 产物），前端用动态 `<script>` 注入后从 `window.JSZip` 取，双路径加载（`/vendor/jszip` 打包优先，`/node_modules/jszip` dev 回退），与 pdfjs 的 vendor 模式一致。
- `PdfNotePage.js` 保存字段泛化：`sourceType` 按来源记 `pdf-generated` / `pptx-generated`；`sourcePdfName` 改名 `sourceFileName`（已确认全项目仅此一处写入、无读取，改名安全）。

涉及文件：

- `src/services/pptxText.js`（新建，PPTX 文本抽取核心）
- `src/pages/PdfNotePage.js`（文件输入扩展、类型分流、变量 pdf→doc、保存字段泛化、文案润色）
- `scripts/sync-dist.mjs`（新增 jszip vendor 到 `dist/vendor/jszip/`）
- `package.json` + `package-lock.json`（新增依赖 `jszip ^3.10.1`）

验证：

- `node --check` 通过（pptxText.js / PdfNotePage.js / sync-dist.mjs）。
- `npm run sync-dist` 通过，`dist/vendor/jszip/jszip.min.js`（97KB）就位，`dist/src/services/pptxText.js` 已同步。
- Node 端用真实 DrawingML 结构构造 .pptx 验证抽取逻辑：多文本框/多段落聚合正确、`slide10` 排序正确、干扰文件过滤正确、文本结构 `第 N 张幻灯片\n...` 与 PDF 骨架一致。

注意事项（给 Codex）：

- **保真度限制**：只抽 `<a:t>` 文本，不含图片/图表/SmartArt 视觉信息；Office Math（OMML）公式抽不到。对文字/公式文本为主的讲义 PPT 效果好，对图表驱动的 PPT 信息会丢失——这是"做笔记"场景可接受的取舍。
- **格式范围**：只支持 `.pptx`（ZIP+XML），不支持老版二进制 `.ppt`（前端 JS 无成熟解析库，要支持只能上 LibreOffice 重依赖路线，已与用户确认不做）。
- **无打包器**：本项目用原生 ES modules + sync-dist 复制。jszip 是 UMD，靠 `window.JSZip` 全局变量工作，`pptxText.js` 的 `loadScript` + `injectJsZipScript` 负责加载，若后续引入打包器（Vite 等）可改为正常 `import`。
- **字段改名**：`sourcePdfName` → `sourceFileName`。历史已存的笔记不受影响（IndexedDB schemaless，旧字段只是不再被写入），但若日后要展示来源，注意老笔记可能仍是 `sourcePdfName`。


### 2026-06-16 / Codex / GPT-5

完成内容（PPT 笔记收尾与首页删除修复）：

- 修复 `PdfNotePage.js` 中 `status-box` 的中文弯引号，恢复状态框样式命中。
- 优化 PDF/PPT 笔记入口文案，明确 PDF 走文本提取、PPTX 走幻灯片图片多模态读取。
- 首页“笔记档案”的“删除”按钮不再依赖 `window.confirm`，改为项目内 `openModal` 确认框，避免桌面壳中原生确认弹窗无响应或不可见。
- 保留 `.gitignore` 对废弃 `agent_log/` 的忽略规则，防止以后误生成重复协作日志目录后被提交。

涉及文件：

- `src/pages/HomePage.js`
- `src/pages/PdfNotePage.js`
- `.gitignore`
- `agent-notes/FEATURE_LOG.md`

验证：

- 本地 JavaScript 语法检查通过。
- `npm run sync-dist` 通过。
- `curl http://localhost:5173` 可返回首页 HTML。

### 给 Codex 的备忘（GLM-5.2）

- `.gitignore` 已追加 `release/`（排除旧构建产物）。日志目录统一为 `agent-notes/`（连字符），原先的 `agent_log/`（下划线）已废弃删除。
- 版本号现在分散在 3 个文件（package.json / tauri.conf.json / Cargo.toml），改版本时记得三处同步，否则产物文件名/版本会不一致。
- 协作日志路径为 `agent-notes/FEATURE_LOG.md`，已纳入版本控制、随 `main` 同步，便于 Codex 与 GLM 在不同机器上交接；不要再创建 `agent_log/` 等重复目录。
- Android NDK 版本：本地用的是 `28.2.13676358`，CI 里固定为 `26.1.10909125`。如果后续 CI 构建出现 NDK 相关问题，注意这个差异。
- Gradle 分发源已从官方切到腾讯云镜像（国内网络），CI 环境用官方源没问题（`setup-android` action 会处理）。

### 2026-06-16 / GLM-5.2

完成内容（PPT 笔记功能升级 —— pptx-svg 整页渲染 + 多模态模型读图）：

- **方案重大变更**：原 PPT 笔记链路是"jszip 抽 `<a:t>` 文本 → 喂文本笔记模型"，但用量子力学课件实测发现 895 字全是目录骨架——所有公式、推导、图解都在嵌入图片中，纯文本抽取对图片型 PPT 完全失效。**新方案改为 pptx-svg 整页渲染 + 多模态视觉模型直接读图**。
- 新方案流程：用户上传 .pptx → `extractPptxSlides` 用 pptx-svg（WASM 渲染器）将每张幻灯片渲染为完整 SVG → Canvas API 转 PNG data URL → `buildVisionNoteMessages` 构建多模态消息（image_url + text caption）→ `callJsonCompletion` 调用多模态笔记模型 → 模型从图片中识别公式、定理、推导和图解 → 返回 JSON 笔记。
- 已用 DashScope qwen3.7-plus 实测验证：4 张渲染幻灯片图片发给模型，成功识别 Stern-Gerlach 实验细节、自旋假设公式 S_z=±ℏ/2、Pauli 矩阵对易关系 σ_xσ_y−σ_yσ_x=2iσ_z 和自旋态 χ_{1/2}=(1,0)。
- `extractPptxSlides` 为主路径（整页渲染 PNG），`extractPptxText` 保留为备用路径（纯文本抽取，文字型 PPT 可用）。
- pptx-svg 是 WASM 幻灯片渲染器（~310KB WASM，零 npm 依赖），API：`new PptxRenderer(); await renderer.init(); await renderer.loadPptx(buffer); renderer.renderSlideSvg(index)` 返回自包含 SVG（嵌入图片为 base64 data URL，无外部引用，Canvas 不被 tainted）。
- SVG→PNG 用浏览器 Canvas API（Image → drawImage → toDataURL），输出限制 1280×960。
- pptx-svg 动态 ESM import 加载：先试 `/vendor/pptx-svg/index.js`（dist 打包），回退 `/node_modules/pptx-svg/dist/index.js`（dev）。WASM 自动通过 `import.meta.url` 定位。
- `buildVisionNoteMessages` 构建多模态消息：`content` 为数组（text + image_url parts），复用 grading.js 已验证的模式。系统提示词声明"擅长从教学幻灯片图片中提取知识点"，要求模型用 LaTeX 书写公式。
- `modelUsageTracker.js` 新增 `stripImageUrlsFromMessages`：在 fallback token 估算前将 image_url 的 base64 替换为 `[image-stripped]`，避免数 MB 图片数据导致估算值虚高。IndexedDB 中本就不存 messages 内容，只存 token 数。
- PDF 路径完全不变，PPT 路径与 PDF 路径在 `PdfNotePage.js` submit handler 中明确分流（`if (isPptx) { ... } else { ... }`）。
- `titleFromFile` 同时去除 .pdf 和 .pptx 后缀。
- 状态文案更新："PDF 会提取文本后调用笔记模型整理；PPT 会将每页渲染为图片，调用多模态模型直接读图，可识别公式、推导和图解。原始文件不会保存。"

涉及文件：

- `src/services/pptxText.js`（重写：新增 `extractPptxSlides` 主路径 + 保留 `extractPptxText` 备用路径）
- `src/prompts/pdfNote.js`（新增 `buildVisionNoteMessages` 多模态消息构建）
- `src/pages/PdfNotePage.js`（PPT→视觉路径分流、import 更新、状态文案、titleFromFile 泛化）
- `src/services/modelUsageTracker.js`（新增 `stripImageUrlsFromMessages`）
- `scripts/sync-dist.mjs`（新增 pptx-svg dist vendor：.js + .wasm 文件拷贝到 `dist/vendor/pptx-svg/`）
- `package.json`（新增依赖 `pptx-svg ^0.6.1`）

验证：

- JS 语法检查通过（pptxText.js / pdfNote.js / PdfNotePage.js / modelUsageTracker.js / sync-dist.mjs）。
- `npm run sync-dist` 通过，`dist/vendor/pptx-svg/` 包含 9 个 .js 文件 + main.wasm。
- DashScope qwen3.7-plus 多模态实测：4 张量子力学幻灯片图片成功识别公式和推导。
- dist 与 src 完全同步一致。

注意事项（给 Codex）：

- **多模态模型要求**：PPT 笔记路径需要笔记模型支持 vision/图片输入（如 qwen-vl、gpt-4o、gemini-pro-vision 等）。如果用户笔记模型不支持图片，Rust 后端已有 `vision_not_supported` 错误分类，前端会收到友好提示。
- **WASM 兼容性**：pptx-svg WASM 需要 Chrome 111+（WebAssembly SIMD），不支持的环境会 init 失败并抛出明确错误。
- **PPT 幻灯片数上限**：目前未硬限幻灯片数量，但每张图片约 200-500KB PNG，20 张幻灯片 ≈ 4-10MB 消息体，大部分模型 API 可承受。如果后续需要支持超大 PPT（>50 页），可考虑分组发送或压缩分辨率。
- **`extractPptxText` 保留**：纯文本抽取路径仍可用（`extractPptxText` export），如果将来某些场景只想抽文字不走视觉模型，可直接调用。
- **`buildVisionNoteMessages` 参数格式**：`slides` 需为 `{pageNumber, title, images: [{dataUrl}]}` 格式。`extractPptxSlides` 返回 `{pageNumber, title, dataUrl}`（扁平），在 PdfNotePage.js 中做了适配映射 `images: [{dataUrl: s.dataUrl}]`。

### 2026-06-16 / Codex / GPT-5

完成内容（侧栏笔记本树）：

- 将左侧侧栏的“笔记”区改为“笔记本”区，按笔记本分组展示笔记。
- 使用原生 `<details>` 实现可折叠笔记本树，不额外写入本地状态。
- 当前打开的笔记所在笔记本会自动展开；没有当前笔记时默认展开第一个有内容的笔记本。
- 未归档笔记会归入“未归档”虚拟分组。
- 侧栏笔记条目改成缩进文本列表样式，减少每条笔记重复图标带来的视觉噪音，更接近桌面应用侧边栏。

涉及文件：

- `src/components/AppLayout.js`
- `src/styles.css`
- `agent-notes/FEATURE_LOG.md`

验证：

- 本地 JavaScript 语法检查通过。
- `npm run sync-dist` 通过。
- `git diff --check` 通过。
- 本地服务 `http://localhost:5173` 可返回首页 HTML。

### 2026-06-17 / Codex / GPT-5

完成内容（首页简化、笔记本操作、上下文与模型请求细节）：

- 首页封面区域去掉顶部 “QuizNest Workspace” 小标题和 “Markdown 笔记 / 本地数据 / AI 出题与判题” 三枚能力标签，保留主标题、介绍、操作按钮和今日概览。
- 设置页的模型配置、外观、数据管理区域间距加大，减少配置项挤在一起的问题。
- 侧栏“笔记本”树的展开/折叠状态写入本地 `localStorage`，切换首页、统计、题组库等页面时不会自动展开用户已折叠的笔记本；打开具体笔记时仍会展开其所在笔记本。
- 笔记本详情页中，笔记行从常驻“归入”下拉改为“归档”按钮；点击后弹出二级归档选择，并在同一行加入“删除”按钮。
- 模型配置默认开启视觉输入和思考模式：前端配置、浏览器调试代理、Tauri Rust 后端都会传递 `enable_thinking=true`。如果兼容服务不支持该字段，会按服务端错误反馈。
- “解惑”选择整套题组作为上下文时，会附带题组内各题的用户作答、图片答题标记、AI 判题结果、错题原因和整体进度统计，便于模型分析薄弱点。
- 同步清理了不再使用的首页能力标签样式，并补齐笔记本操作按钮的移动端布局。

涉及文件：

- `src/pages/HomePage.js`
- `src/components/AppLayout.js`
- `src/pages/NotebooksPage.js`
- `src/pages/SettingsPage.js`
- `src/components/ChatPanel.js`
- `src/prompts/chat.js`
- `src/services/ai/aiClient.js`
- `src/services/tauriBridge.js`
- `src/services/storage/db.js`
- `server/proxy.js`
- `src-tauri/src/lib.rs`
- `src/styles.css`
- `agent-notes/FEATURE_LOG.md`

验证：

- 相关 JS 文件 `node --check` 通过。
- `cargo check` 通过。
- `npm run sync-dist` 通过。
- `git diff --check` 通过。
- 本地服务 `http://127.0.0.1:5173` 可返回首页 HTML。

### 2026-06-17 / Codex / GPT-5

完成内容（设置页间距与 macOS 本地打包校验）：

- 调整设置页通用模型配置区域间距，拉开“请求超时”输入框、视觉/思考提示框和模型测试按钮之间的距离。
- 通过浏览器渲染验收设置页，实测输入框到提示框为 28px，提示框到测试按钮为 28px，并保存截图到 `output/playwright/settings-spacing.png`。
- 修正 `scripts/build-dmg.mjs`：不再直接复制 Tauri 自带 DMG，而是对生成的 `.app` 执行 ad-hoc codesign、校验签名后，再重新制作根目录 DMG。
- 该改动用于避免 `.app` 处于“DMG 有效但 app bundle 签名无效”的状态，减少 macOS 安装后提示“已损坏”的概率。

涉及文件：

- `src/styles.css`
- `scripts/build-dmg.mjs`
- `agent-notes/FEATURE_LOG.md`

验证：

- `node --check scripts/build-dmg.mjs` 通过。
- `node --check src/pages/SettingsPage.js` 通过。
- `git diff --check` 通过。
- `npm run build:dmg` 通过，生成 `QuizNest_0.1.3_aarch64.dmg`。
- `hdiutil verify QuizNest_0.1.3_aarch64.dmg` 通过。
- 挂载 DMG 后，`codesign --verify --deep --strict --verbose=2 /tmp/quiznest-dmg-check/QuizNest.app` 通过。

注意事项：

- 当前是本地 ad-hoc 签名，不等同于 Developer ID 签名或 Apple notarization。浏览器下载后的分发包仍可能被 Gatekeeper 按“未认证开发者”拦截；如需免提示分发，需要正式 Developer ID 证书和公证流程。

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

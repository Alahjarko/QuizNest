# QuizNest SwiftUI/macOS 设计草案

这个分支用于探索 QuizNest 如果改成 macOS 原生 SwiftUI 应用，界面和工程结构应该是什么样。目标不是立刻替换当前 Tauri 版本，而是先把原生版的边界、体验和迁移路线想清楚。

## 设计目标

- 保留 QuizNest 当前的核心能力：笔记管理、笔记本、题组生成、练习、错题本、解惑、统计、导入导出。
- 使用更贴近 macOS 的交互：侧边栏、工具栏、分栏详情页、sheet、inspector、系统文件选择器、菜单栏快捷键。
- 尽量复用现有数据结构和导入导出 JSON，避免用户在 Tauri 版和 SwiftUI 版之间迁移困难。
- AI 接口继续使用 OpenAI-compatible Chat Completions，保留出题、判题、解惑的模型分工。
- 第一阶段优先做本地个人软件，不做账号系统、同步系统、云端数据库。

## 推荐工程结构

```text
QuizNestMac/
  QuizNestApp.swift
  AppState/
    AppModel.swift
    NavigationModel.swift
    SettingsModel.swift
  Data/
    Database.swift
    Models/
      Note.swift
      Notebook.swift
      QuestionSet.swift
      Question.swift
      Answer.swift
      WrongRecord.swift
      ChatMessage.swift
      ModelUsage.swift
      StudyEvent.swift
      Profile.swift
    Repositories/
      NoteRepository.swift
      PracticeRepository.swift
      StatsRepository.swift
      SettingsRepository.swift
  Services/
    AIClient.swift
    PromptBuilder.swift
    BackupService.swift
    ImportExportService.swift
    TokenEstimator.swift
    MarkdownRenderer.swift
  Views/
    Shell/
      RootSplitView.swift
      SidebarView.swift
      ToolbarView.swift
    Home/
      HomeView.swift
      RecentNotesView.swift
    Notes/
      NotebookListView.swift
      NoteDetailView.swift
      NoteImportSheet.swift
    Library/
      QuestionSetListView.swift
      PracticeSessionView.swift
      SubjectiveReviewView.swift
    WrongBook/
      WrongBookView.swift
      WrongReviewSheet.swift
    Chat/
      ChatView.swift
      ChatComposerView.swift
      ContextPickerSheet.swift
    Stats/
      ProfileStatsView.swift
      HeatmapView.swift
      ModelUsageView.swift
    Settings/
      SettingsView.swift
      ModelConfigView.swift
      BackupView.swift
  Components/
    MetricStrip.swift
    TagPill.swift
    EmptyStateView.swift
    LoadingTimerView.swift
    ToastHost.swift
```

## macOS 界面骨架

SwiftUI 版本建议使用 `NavigationSplitView` 作为主壳：

```text
左侧 Sidebar
  QuizNest / 本地学习工作台
  首页
  笔记本
  题组库
  错题本
  解惑
  统计
  设置

中间 Content
  当前业务页面

右侧 Inspector，可选
  当前笔记信息
  当前题组信息
  AI 上下文摘要
```

和现在 Tauri 版相比，SwiftUI 版可以更像一个原生桌面工具：

- 顶部使用系统 toolbar，而不是网页式顶部导航。
- 设置页可以用 `Settings` scene，走 macOS 原生偏好设置窗口。
- 导入笔记、导入备份、选择头像走 `fileImporter`。
- 导出备份、导出题组走 `fileExporter`。
- 删除、重命名、移动到笔记本使用 sheet 或 confirmation dialog。
- 左侧底部保留头像、昵称、设置入口，但做成 macOS sidebar footer。

## 核心页面设计

### 首页

首页作为工作台，不做营销页。

- 今日学习概览：今日做题、正确率、连续天数、今日 token。
- 最近笔记：显示笔记标题、所属笔记本、更新时间。
- 最近题组：显示题组来源、难度、题量、完成状态。
- 快捷操作：导入笔记、生成题组、继续练习、打开解惑。

### 笔记本

SwiftUI 原生版可以把笔记本做得更像 Finder：

- 左侧或主区域显示笔记本列表。
- 笔记支持拖拽移动到笔记本。
- 未归档笔记作为一个固定智能分组。
- 笔记详情页支持 Markdown 预览和章节索引。

### 题组库与练习

题组库用列表 + 详情：

- 列表显示题组标题、笔记来源、难度、题量、完成进度。
- 详情页显示题目概览、开始/继续练习、导出题组。

练习页建议保留当前产品优点：

- 左侧题号网格。
- 右侧题目内容和作答区。
- 选择题点击后静默保存，不弹 toast。
- 大题提交后后台判题，用户可继续下一题。
- 最后一题等待所有大题判完后显示总结。

SwiftUI 中可以用 `Task` 管理后台判题队列，用 `@Observable` 或 `@StateObject` 驱动 UI 状态。

### 错题本

错题本建议做成三栏体验：

```text
错题列表 -> 错题详情 -> AI 复盘 / 再练一次
```

- 删除按钮必须有 confirmation dialog。
- 再次提交大题后不要自动关闭 sheet，而是在 sheet 内展示判题反馈。
- 错题可按笔记、题组、题型、掌握状态筛选。

### 解惑

解惑页在原生版里可以成为独立对话工作台：

- 顶部显示当前选择的上下文：笔记、题组、题目。
- 消息列表保持滚动位置，不因为模型输出结束跳回顶部。
- 输入框固定在底部。
- 输入框工具栏放置：
  - 学习与解惑：选择上下文。
  - 清空上下文。
  - 重试上一次回答。
  - 附加图片，可选。
- 支持删除消息、编辑已发消息、重试模型回答。

对带图题目的上下文仍应默认降噪：

- 文本上下文进入 prompt。
- 图片默认不直接塞进解惑 prompt。
- 如用户主动要求“参考这张图”，再以视觉消息发送。

### 统计与个人资料

统计页继续沿用现在的方向，但可以更原生：

- 顶部头像、昵称、本机学习摘要。
- 指标条：累计 token、峰值 token、累计学习时长、当前连续天数、最长连续天数。
- Token 热力图：每日、本月、累计。
- 做题热力图：每日、本月、累计。
- 模型用量榜：按模型统计 token、请求次数、最近使用。
- 活动洞察：今日做题、近 7 日做题、笔记数、题组数、错题数、AI 对话数。

热力图可以写成独立 `HeatmapView`：

```swift
struct HeatmapView: View {
    let days: [HeatmapDay]
    let mode: HeatmapMode
    let formatter: HeatmapFormatter
}
```

鼠标悬停用 `popover` 或自绘 overlay 显示详细信息。macOS 上 hover 是很自然的交互，比移动端更适合做细。

## 数据层选择

### 如果最低支持 macOS 14+

可以考虑 SwiftData：

- 写法轻。
- 和 SwiftUI 绑定自然。
- 适合本地个人应用。

风险是最低系统版本会抬高。

### 如果希望兼容 macOS 11/12/13

建议使用 SQLite：

- `GRDB` 或轻量自写 SQLite wrapper。
- 数据结构更可控。
- 更方便保持和当前 IndexedDB schema 的迁移兼容。

考虑到当前 Tauri 版最低 macOS 是 11.0，保守方案是 SQLite。

## 数据模型映射

原 IndexedDB store 可以基本一一映射：

| 当前 store | SwiftUI 原生模型 |
| --- | --- |
| `settings` | `SettingsProfile` |
| `profile` | `Profile` |
| `notebooks` | `Notebook` |
| `notes` | `Note` |
| `questionSets` | `QuestionSet` |
| `questions` | `Question` |
| `answers` | `Answer` |
| `wrongRecords` | `WrongRecord` |
| `chatMessages` | `ChatMessage` |
| `modelUsage` | `ModelUsageRecord` |
| `studyEvents` | `StudyEvent` |

第一版 SwiftUI 不必直接读取 IndexedDB。更稳的方式是：

1. Tauri 版继续导出学习数据 JSON。
2. SwiftUI 版导入同一份 JSON。
3. SwiftUI 版导出时保持同样 schema。

这样两个版本可以并行一段时间。

## AI 请求层

SwiftUI 版本建议用 `URLSession`：

- 非流式出题/判题：`URLSession.data(for:)`。
- 解惑流式输出：`URLSession.bytes(for:)` 解析 SSE。
- API Key 放 Keychain，不再放普通本地数据库。
- Base URL、模型名、超时时间放 settings 数据表。

请求层要保留这些保护：

- 图片上下文不会误塞进纯文本 prompt。
- 大图进入视觉模型前可以压缩。
- token 统计按请求估算 + 响应 usage 兼容。
- AI 返回空内容时显示可理解的错误，不让用户以为系统卡死。

## Markdown 与公式

这是 SwiftUI 原生版的难点之一。

可选路线：

1. `MarkdownUI` 渲染普通 Markdown，公式用自定义扩展处理。
2. 使用 `WKWebView` 渲染 Markdown + MathJax，包在 SwiftUI 中。
3. 题目和答案区域用 SwiftUI 文本布局，公式保留 LaTeX 原文。

实际建议：

- 第一阶段用 `WKWebView` 渲染 Markdown/MathJax，稳定优先。
- 列表和摘要使用 SwiftUI 原生 Text。
- 以后再逐步替换成原生 Markdown 组件。

## 分阶段路线

### Phase 1：原生壳与数据导入

- 建立 SwiftUI 工程。
- 实现 sidebar、首页、笔记列表、设置页。
- 支持导入当前 QuizNest JSON 备份。
- 只读展示笔记、题组、统计。

### Phase 2：练习与错题本

- 实现题组练习。
- 实现答案保存、错题记录。
- 实现错题复习。
- 保持与导入导出 JSON 兼容。

### Phase 3：AI 能力

- 接入出题模型。
- 接入判题模型。
- 接入解惑聊天。
- 增加 token 统计与等待计时器。

### Phase 4：体验打磨

- 原生快捷键。
- 菜单栏命令。
- 搜索。
- 拖拽整理笔记。
- 头像和个人资料。
- 更完整的热力图 hover 与筛选。

## 与当前 Tauri 版的关系

建议不要一开始就替换 Tauri 版。

更稳的路径是：

- `main` 继续维护 Tauri 版。
- `experiment/swiftui-macos-design` 用来做设计和原生版探索。
- 如果 SwiftUI 版进入可运行阶段，再新建 `native/macos-swiftui` 分支。
- 两个版本通过相同导入导出 JSON 保持数据互通。

这样不会影响现在能用、能打包的 QuizNest。

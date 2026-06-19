# 本地数据结构

QuizNest 使用 IndexedDB 保存核心数据。数据库名为 `ai-study-assistant-db`，这是早期版本留下的内部兼容名，暂不迁移以避免影响已有本地数据。

## settings

保存 AI 接入配置。当前固定使用 `id = "default"`。

- `baseUrl`
- `apiKey`
- `questionModel`
- `gradingModel`
- `chatModel`
- `timeoutMs`
- `updatedAt`

## profile

保存本机个人资料。当前固定使用 `id = "default"`。

- `displayName`
- `avatarDataUrl`
- `updatedAt`

## notes

上传的 Markdown 笔记。

- `id`
- `title`
- `fileName`
- `content`
- `sections`
- `createdAt`
- `updatedAt`

## questionSets

一次生成的题目集合。

- `id`
- `noteId`
- `title`
- `difficulty`
- `choiceCount`
- `subjectiveCount`
- `createdAt`

## questions

选择题和大题统一保存，使用 `type` 区分。

- `id`
- `setId`
- `noteId`
- `type`
- `question`
- `options`
- `correctAnswer`
- `explanation`
- `wrongOptionExplanations`
- `referenceAnswer`
- `gradingRubric`
- `relatedNoteSection`
- `difficulty`
- `order`

## answers

用户答题状态。选择题点击选项会立即写入，提交后锁定。

- `id`
- `noteId`
- `setId`
- `questionId`
- `type`
- `selectedOption`
- `textAnswer`
- `imageDataUrl`
- `submitted`
- `isCorrect`
- `score`
- `gradeResult`
- `aiTeaching`
- `submittedAt`
- `updatedAt`

## wrongItems

错题本记录。

- `id`
- `noteId`
- `section`
- `questionType`
- `questionId`
- `setId`
- `questionContent`
- `userAnswer`
- `correctAnswer`
- `errorReason`
- `aiExplanation`
- `createdAt`
- `reviewCount`
- `lastReviewedAt`
- `mastered`

## chatMessages

AI 对话记录，按笔记和场景上下文关联。

- `id`
- `noteId`
- `contextKey`
- `role`
- `content`
- `createdAt`

## studyDays

按日期聚合的学习追踪数据。

- `id`
- `date`
- `practicedQuestions`
- `submittedAnswers`
- `correctAnswers`
- `wrongReviews`
- `studyMs`
- `checkedIn`
- `updatedAt`

## modelUsage

按请求记录不同模型的 Token 消耗，用于统计页聚合。

- `id`
- `date`
- `role`
- `modelName`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `estimated`
- `createdAt`

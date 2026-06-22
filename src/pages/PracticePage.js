import { openModal } from "../components/Modal.js";
import { showToast } from "../components/Toast.js";
import { buildGradingMessages, buildTeachingMessages, normalizeGradeResult } from "../prompts/grading.js";
import { callJsonCompletion } from "../services/ai/aiClient.js";
import {
  applyManualGradingCorrection,
  getGradingAttempts,
  gradingErrorCategoryLabel,
  GRADING_ERROR_CATEGORIES,
  recordGradingAttempt,
  recordGradingFailure
} from "../services/gradingHistory.js";
import { ensureReviewCard, setReviewCardSuspended } from "../services/reviewScheduler.js";
import { get, getByIndex, put } from "../services/storage/db.js";
import { markCheckIn, recordPracticeAnswer } from "../services/studyTracker.js";
import { readImageFile } from "../utils/file.js";
import { formatDateTime, nowIso } from "../utils/ids.js";
import { escapeHtml } from "../utils/markdown.js";

const LABELS = ["A", "B", "C", "D"];
const subjectiveGradingTasks = new Map();

export async function renderPracticePage(container, app, setId) {
  const set = await get("questionSets", setId);
  if (!set) {
    container.innerHTML = `<div class="error-state"><h1>未找到练习</h1><p>这套题可能已被删除。</p></div>`;
    return;
  }

  const note = await get("notes", set.noteId);
  const questions = (await getByIndex("questions", "setId", set.id)).sort((a, b) => a.order - b.order);
  const answers = await getByIndex("answers", "setId", set.id);
  const answersByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));

  if (questions.length === 0) {
    container.innerHTML = `<div class="error-state"><h1>练习为空</h1><p>这套题没有保存任何题目。</p></div>`;
    return;
  }

  const currentIndex = resolveCurrentIndex(app, set.id, questions, answersByQuestion);
  const currentQuestion = questions[currentIndex];
  const currentAnswer = answersByQuestion.get(currentQuestion.id);
  const gradingAttempts = currentQuestion.type === "subjective" ? await getGradingAttempts(currentQuestion.id) : [];
  const stats = buildStats(questions, answersByQuestion);

  app.setContext({
    contextKey: `practice:${set.id}:${currentQuestion.id}`,
    note,
    question: summarizeQuestion(currentQuestion),
    answer: summarizeAnswer(currentAnswer),
    correctAnswer: currentQuestion.correctAnswer || currentQuestion.referenceAnswer,
    aiExplanation: currentQuestion.explanation
  });

  container.innerHTML = `
    <section class="page-header">
      <div>
        <p class="eyebrow">练习答题</p>
        <h1>${escapeHtml(set.title)}</h1>
        <p>${escapeHtml(note?.title || "未知笔记")} · ${escapeHtml(set.difficulty)} · ${formatDateTime(set.createdAt)}</p>
      </div>
      <div class="page-actions">
        <button class="secondary-button" type="button" data-back-note>返回笔记</button>
      </div>
    </section>

    <section class="practice-summary">
      <div><strong>${stats.submitted}</strong><span>已提交 / ${questions.length}</span></div>
      <div><strong>${stats.correct}</strong><span>正确</span></div>
      <div><strong>${stats.wrong}</strong><span>错误</span></div>
      <div><strong>${practiceStatusLabel(stats)}</strong><span>状态</span></div>
    </section>

    ${stats.complete ? renderFinalSummary(questions, answersByQuestion) : stats.allSubmitted ? renderPendingSummary(stats) : ""}

    <section class="practice-layout">
      <aside class="question-nav" aria-label="题目导航">
        ${questions
          .map((question, index) => renderQuestionNavItem(question, index, currentIndex, answersByQuestion, canOpenIndex(index, questions, answersByQuestion)))
          .join("")}
      </aside>
      <article class="question-panel">
        <div class="question-meta">
          <span>第 ${currentIndex + 1} / ${questions.length} 题</span>
          <span>${currentQuestion.type === "choice" ? "选择题" : "大题"}</span>
          ${currentQuestion.type === "subjective" ? `<span>${subjectiveTypeLabel(currentQuestion.questionType)}</span>` : ""}
          <span>${escapeHtml(currentQuestion.relatedNoteSection || "未标注章节")}</span>
          <span>${escapeHtml(currentQuestion.difficulty || set.difficulty)}</span>
        </div>
        <h2>${escapeHtml(currentQuestion.question)}</h2>
        ${
          currentQuestion.type === "choice"
            ? renderChoiceQuestion(currentQuestion, currentAnswer)
            : renderSubjectiveQuestion(currentQuestion, currentAnswer, gradingAttempts)
        }
        <div class="practice-actions">
          <button class="secondary-button" data-prev-question type="button" ${currentIndex === 0 ? "disabled" : ""}>上一题</button>
          <button class="primary-button" data-next-question type="button" ${
            !currentAnswer?.submitted || currentIndex === questions.length - 1 ? "disabled" : ""
          }>下一题</button>
        </div>
      </article>
    </section>
  `;

  container.querySelector("[data-back-note]").addEventListener("click", () => app.navigate(`/note/${set.noteId}`));

  container.querySelectorAll("[data-jump-question]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      setCurrentIndex(set.id, Number(button.dataset.jumpQuestion));
      app.refresh();
    });
  });

  container.querySelector("[data-prev-question]").addEventListener("click", () => {
    setCurrentIndex(set.id, Math.max(0, currentIndex - 1));
    app.refresh();
  });

  container.querySelector("[data-next-question]").addEventListener("click", () => {
    if (!currentAnswer?.submitted) return;
    setCurrentIndex(set.id, Math.min(questions.length - 1, currentIndex + 1));
    app.refresh();
  });

  if (currentQuestion.type === "choice") {
    bindChoiceEvents(container, app, note, set, currentQuestion, currentAnswer);
  } else {
    bindSubjectiveEvents(container, app, note, set, currentQuestion, currentAnswer, questions, currentIndex);
    bindManualGradingCorrection(container, app, note, set, currentQuestion, currentAnswer);
  }

  resumePendingSubjectiveGradings(note, set, questions, answersByQuestion, app);
}

function resolveCurrentIndex(app, setId, questions, answersByQuestion) {
  const questionId = app.route.query.get("questionId");
  if (questionId) {
    const target = questions.findIndex((question) => question.id === questionId);
    if (target >= 0 && canOpenIndex(target, questions, answersByQuestion)) {
      setCurrentIndex(setId, target);
      return target;
    }
  }

  const stored = Number(localStorage.getItem(currentIndexKey(setId)) || 0);
  const clamped = Math.max(0, Math.min(questions.length - 1, Number.isFinite(stored) ? stored : 0));
  if (canOpenIndex(clamped, questions, answersByQuestion)) return clamped;

  const firstBlocked = firstUnsubmittedIndex(questions, answersByQuestion);
  return firstBlocked === -1 ? questions.length - 1 : firstBlocked;
}

function currentIndexKey(setId) {
  return `practice:${setId}:currentIndex`;
}

function setCurrentIndex(setId, index) {
  localStorage.setItem(currentIndexKey(setId), String(index));
}

function firstUnsubmittedIndex(questions, answersByQuestion) {
  return questions.findIndex((question) => !answersByQuestion.get(question.id)?.submitted);
}

function canOpenIndex(index, questions, answersByQuestion) {
  const first = firstUnsubmittedIndex(questions, answersByQuestion);
  return first === -1 || index <= first;
}

function buildStats(questions, answersByQuestion) {
  const submittedAnswers = questions.map((question) => answersByQuestion.get(question.id)).filter((answer) => answer?.submitted);
  const pending = submittedAnswers.filter((answer) => answer.gradingPending).length;
  const failed = submittedAnswers.filter((answer) => answer.gradingError).length;
  const gradedAnswers = submittedAnswers.filter((answer) => !answer.gradingPending && !answer.gradingError);
  const correct = gradedAnswers.filter((answer) => answer.isCorrect).length;
  return {
    submitted: submittedAnswers.length,
    correct,
    wrong: gradedAnswers.length - correct,
    pending,
    failed,
    allSubmitted: submittedAnswers.length === questions.length,
    complete: submittedAnswers.length === questions.length && pending === 0 && failed === 0
  };
}

function practiceStatusLabel(stats) {
  if (stats.pending) return `${stats.pending} 题判题中`;
  if (stats.failed) return `${stats.failed} 题需重判`;
  return stats.complete ? "已完成" : "进行中";
}

function renderQuestionNavItem(question, index, currentIndex, answersByQuestion, canOpen) {
  const answer = answersByQuestion.get(question.id);
  const hasDraft = answer?.selectedOption || answer?.textAnswer || answer?.imageDataUrl;
  const state = answer?.gradingPending
    ? "pending"
    : answer?.gradingError
      ? "error"
      : answer?.submitted
        ? answer.isCorrect
          ? "correct"
          : "wrong"
        : hasDraft
          ? "draft"
          : "empty";
  return `
    <button class="question-nav-item ${index === currentIndex ? "active" : ""} ${state}" data-jump-question="${index}" type="button" ${
      canOpen ? "" : "disabled"
    }>
      <span>${index + 1}</span>
      <small>${question.type === "choice" ? "选" : "大"}</small>
    </button>`;
}

function renderChoiceQuestion(question, answer) {
  const submitted = Boolean(answer?.submitted);
  return `
    <div class="choice-list">
      ${question.options
        .map((option, index) => {
          const label = LABELS[index];
          const selected = answer?.selectedOption === label;
          const isCorrect = submitted && question.correctAnswer === label;
          const isWrong = submitted && selected && question.correctAnswer !== label;
          return `
            <button class="choice-option ${selected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${
              isWrong ? "wrong" : ""
            }" data-choice="${label}" type="button" ${submitted ? "disabled" : ""}>
              ${escapeHtml(option)}
            </button>`;
        })
        .join("")}
    </div>
    <div class="status-box" data-choice-status>
      ${
        submitted
          ? answer.isCorrect
            ? "已提交：回答正确，题目已锁定。"
            : "已提交：回答错误，题目已锁定，并已加入错题本。"
          : answer?.selectedOption
            ? `已保存当前选择：${answer.selectedOption}。提交前仍可修改。`
            : "请先选择一个选项。点击选项会立即保存，提交后才判定正误。"
      }
    </div>
    <div class="form-actions">
      <button class="primary-button" data-submit-choice type="button" ${submitted || !answer?.selectedOption ? "disabled" : ""}>提交答案</button>
    </div>
    ${submitted ? renderChoiceExplanation(question, answer) : ""}
  `;
}

function renderChoiceExplanation(question, answer) {
  const selectedWrongExplanation = answer.isCorrect ? "" : question.wrongOptionExplanations?.[answer.selectedOption] || "";
  return `
    <section class="answer-feedback ${answer.isCorrect ? "correct" : "wrong"}">
      <h3>${answer.isCorrect ? "回答正确" : "回答错误"}</h3>
      <p><strong>正确答案：</strong>${escapeHtml(question.correctAnswer)}</p>
      <p><strong>解析：</strong>${escapeHtml(question.explanation || "暂无解析")}</p>
      ${
        selectedWrongExplanation
          ? `<p><strong>你所选选项的问题：</strong>${escapeHtml(selectedWrongExplanation)}</p>`
          : ""
      }
    </section>
  `;
}

function renderSubjectiveQuestion(question, answer, gradingAttempts = []) {
  const submitted = Boolean(answer?.submitted);
  const pending = Boolean(answer?.gradingPending);
  const failed = Boolean(answer?.gradingError);
  const locked = submitted && !failed;
  return `
    <div class="subjective-answer">
      <label>
        <span>文字答案</span>
        <textarea data-subjective-text rows="8" placeholder="在这里输入你的解题过程或答案..." ${
          locked ? "disabled" : ""
        }>${escapeHtml(answer?.textAnswer || "")}</textarea>
      </label>
      <div class="image-answer-row">
        <label class="secondary-button file-button ${locked ? "disabled-label" : ""}">
          上传图片答案
          <input data-subjective-image type="file" accept="image/*" ${locked ? "disabled" : ""} hidden />
        </label>
        ${
          answer?.imageDataUrl
            ? `<button class="danger-button" data-remove-image type="button" ${locked ? "disabled" : ""}>移除图片</button>`
            : ""
        }
      </div>
      ${
        answer?.imageDataUrl
          ? `<figure class="answer-image-preview">
              <img src="${answer.imageDataUrl}" alt="已上传的答案图片" />
              <figcaption>${escapeHtml(answer.imageName || "图片答案已保存")}</figcaption>
            </figure>`
          : `<div class="status-box">可只提交文字，也可只提交图片，或同时提交文字和图片。</div>`
      }
      <div class="status-box" data-subjective-status>
        ${
          pending
            ? "已提交：正在后台判题中。你可以继续完成后面的题目。"
            : failed
              ? `判题失败：${escapeHtml(answer.gradingError)}。可以修改答案后重新提交。`
              : submitted
            ? "已提交：判题结果已锁定。"
            : answer?.textAnswer || answer?.imageDataUrl
              ? "草稿已保存在本地。提交后将调用判题模型。"
              : "尚未填写答案。"
        }
      </div>
      <div class="form-actions">
        <button class="primary-button" data-submit-subjective type="button" ${locked ? "disabled" : ""}>${
          pending ? "判题中..." : failed ? "重新提交大题" : "提交大题"
        }</button>
      </div>
      ${submitted && !pending && !failed ? renderSubjectiveFeedback(question, answer, gradingAttempts) : ""}
    </div>
  `;
}

function subjectiveTypeLabel(type) {
  return (
    {
      short_answer: "简答题",
      proof: "证明题",
      calculation: "计算题"
    }[type] || "大题"
  );
}

function renderSubjectiveFeedback(question, answer, gradingAttempts = []) {
  const result = answer.gradeResult || {};
  const teaching = answer.aiTeaching || {};
  return `
    <section class="answer-feedback ${answer.isCorrect ? "correct" : "wrong"}">
      <h3>${answer.isCorrect ? "整体正确" : "需要订正"}</h3>
      <p><strong>得分：</strong>${Number(answer.score || 0)} / 100</p>
      <p><strong>识别出的答案：</strong>${escapeHtml(result.recognizedAnswer || answer.textAnswer || "未识别")}</p>
      <p><strong>判定理由：</strong>${escapeHtml(result.reason || "无")}</p>
      ${renderGradingBreakdown(result)}
      ${renderList("做得好的地方", result.strengths)}
      ${renderList("薄弱点", result.weaknesses)}
      <p><strong>参考答案：</strong>${escapeHtml(question.referenceAnswer || "暂无参考答案")}</p>
      ${
        teaching.aiExplanation || teaching.targetedFeedback
          ? `<div class="teaching-feedback">
              <h4>AI 针对性讲解</h4>
              <p>${escapeHtml(teaching.aiExplanation || "")}</p>
              <p>${escapeHtml(teaching.targetedFeedback || "")}</p>
              ${renderList("复习重点", teaching.reviewFocus)}
              ${teaching.nextStep ? `<p><strong>下一步：</strong>${escapeHtml(teaching.nextStep)}</p>` : ""}
            </div>`
          : ""
      }
      <div class="grading-feedback-actions">
        <button class="secondary-button" data-correct-grading type="button">纠正本次判定</button>
      </div>
      ${renderGradingHistory(gradingAttempts)}
    </section>
  `;
}

function renderGradingBreakdown(result) {
  const stepScores = Array.isArray(result.stepScores) ? result.stepScores : [];
  return `
    <div class="grading-diagnosis">
      <div><span>错误类型</span><strong>${escapeHtml(gradingErrorCategoryLabel(result.errorCategory))}</strong></div>
      <div><span>最早出错步骤</span><strong>${escapeHtml(result.earliestErrorStep || (result.isCorrect ? "无" : "模型未明确指出"))}</strong></div>
      ${result.errorLocation ? `<div class="wide"><span>错误位置</span><strong>${escapeHtml(result.errorLocation)}</strong></div>` : ""}
    </div>
    ${result.manualScoreOverride ? `<div class="status-box">总分已由用户人工纠正；下方保留原 AI 分项，仅供追溯。</div>` : ""}
    ${result.rubricConsistent === false ? `<div class="status-box">模型返回的分项满分合计为 ${Number(result.rubricMaxScore || 0)}，与 100 分制不一致；已保留模型总分并标记供人工复核。</div>` : ""}
    ${
      stepScores.length
        ? `<div class="grading-step-list">
            ${stepScores
              .map(
                (step) => `<div class="grading-step-row">
                  <div><strong>${escapeHtml(step.criterion)}</strong><span>${escapeHtml(step.feedback || "")}</span></div>
                  <b>${Number(step.awardedScore || 0)} / ${Number(step.maxScore || 0)}</b>
                </div>`
              )
              .join("")}
          </div>`
        : `<div class="status-box">${result.manualCorrection ? "本次人工纠正未调整分步骤评分。" : "这条结果来自旧版判题，暂无分步骤评分。"}</div>`
    }
  `;
}

function renderGradingHistory(attempts) {
  if (!attempts.length) return "";
  return `
    <details class="grading-history">
      <summary>查看判题历史（${attempts.length}）</summary>
      <div>
        ${attempts
          .slice()
          .reverse()
          .map((attempt) => {
            const label =
              attempt.source === "manual" ? "人工纠正" : attempt.context === "review" ? "复习判题" : attempt.context === "legacy" ? "旧版判题" : "AI 判题";
            const result = attempt.result;
            return `<article>
              <span>${escapeHtml(label)} · ${formatDateTime(attempt.createdAt)}</span>
              <strong>${attempt.status === "error" ? "失败" : `${Number(result?.score || 0)} 分`}</strong>
              <small>${escapeHtml(attempt.status === "error" ? attempt.errorMessage || "未知错误" : result?.reason || "无判定理由")}</small>
            </article>`;
          })
          .join("")}
      </div>
    </details>`;
}

function renderList(title, values) {
  if (!Array.isArray(values) || values.length === 0) return "";
  return `<div><strong>${title}：</strong><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>`;
}

function renderFinalSummary(questions, answersByQuestion) {
  const choiceQuestions = questions.filter((question) => question.type === "choice");
  const choiceCorrect = choiceQuestions.filter((question) => answersByQuestion.get(question.id)?.isCorrect).length;
  return `
    <section class="final-summary">
      <h2>本套题已完成</h2>
      <p>选择题正确 ${choiceCorrect} / ${choiceQuestions.length}。错题已自动记录，可到错题本复习。</p>
    </section>
  `;
}

function renderPendingSummary(stats) {
  const parts = [];
  if (stats.pending) parts.push(`还有 ${stats.pending} 道大题正在后台判题`);
  if (stats.failed) parts.push(`${stats.failed} 道大题需要重新提交判题`);
  const suffix = stats.failed ? "处理完成后会展示整套练习结果。" : "全部大题判完后会展示整套练习结果。";
  return `
    <section class="final-summary pending">
      <h2>正在收尾</h2>
      <p>${escapeHtml(parts.join("，"))}。${suffix}</p>
    </section>
  `;
}

function bindChoiceEvents(container, app, note, set, question, answer) {
  if (!answer?.submitted) {
    container.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", async () => {
        const selectedOption = button.dataset.choice;
        await put("answers", {
          id: question.id,
          noteId: question.noteId,
          setId: question.setId,
          questionId: question.id,
          type: "choice",
          selectedOption,
          submitted: false,
          updatedAt: nowIso()
        });
        await touchQuestionSet(set.id);
        updateChoiceDraftUi(container, selectedOption);
      });
    });
  }

  container.querySelector("[data-submit-choice]")?.addEventListener("click", async () => {
    const latest = (await get("answers", question.id)) || answer;
    if (!latest?.selectedOption) {
      showToast("请先选择一个选项", "error");
      return;
    }

    const isCorrect = latest.selectedOption === question.correctAnswer;
    const submittedAnswer = {
      ...latest,
      submitted: true,
      isCorrect,
      score: isCorrect ? 100 : 0,
      submittedAt: nowIso(),
      updatedAt: nowIso()
    };

    await put("answers", submittedAnswer);
    if (!isCorrect) await upsertChoiceWrongItem(note, set, question, submittedAnswer);
    await touchQuestionSet(set.id);
    await recordPracticeAnswer(isCorrect);
    await markCheckInIfSetCompleted(set.id);

    showToast(isCorrect ? "回答正确" : "回答错误，已加入错题本", isCorrect ? "success" : "error");
    app.refresh();
  });
}

function updateChoiceDraftUi(container, selectedOption) {
  container.querySelectorAll("[data-choice]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.choice === selectedOption);
  });

  const submitButton = container.querySelector("[data-submit-choice]");
  if (submitButton) submitButton.disabled = false;

  const status = container.querySelector("[data-choice-status]");
  if (status) {
    status.textContent = `已保存当前选择：${selectedOption}。提交前仍可修改。`;
  }

  const activeNavItem = container.querySelector(".question-nav-item.active");
  activeNavItem?.classList.remove("empty");
  activeNavItem?.classList.add("draft");
}

function bindSubjectiveEvents(container, app, note, set, question, answer, questions = [], currentIndex = 0) {
  if (answer?.submitted && !answer?.gradingError) return;

  const textarea = container.querySelector("[data-subjective-text]");
  const imageInput = container.querySelector("[data-subjective-image]");
  const status = container.querySelector("[data-subjective-status]");
  let saveTimer;

  textarea?.addEventListener("input", () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const latest = (await get("answers", question.id)) || baseSubjectiveAnswer(question);
      await put("answers", {
        ...latest,
        textAnswer: textarea.value,
        updatedAt: nowIso()
      });
      await touchQuestionSet(set.id);
      if (status) status.textContent = "文字草稿已保存。";
    }, 350);
  });

  imageInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const image = await readImageFile(file);
      const latest = (await get("answers", question.id)) || baseSubjectiveAnswer(question);
      await put("answers", {
        ...latest,
        imageDataUrl: image.dataUrl,
        imageName: image.name,
        imageType: image.type,
        updatedAt: nowIso()
      });
      await touchQuestionSet(set.id);
      showToast("图片答案已保存", "success");
      app.refresh();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  container.querySelector("[data-remove-image]")?.addEventListener("click", async () => {
    const latest = (await get("answers", question.id)) || baseSubjectiveAnswer(question);
    await put("answers", {
      ...latest,
      imageDataUrl: "",
      imageName: "",
      imageType: "",
      updatedAt: nowIso()
    });
    await touchQuestionSet(set.id);
    showToast("图片已移除", "success");
    app.refresh();
  });

  container.querySelector("[data-submit-subjective]")?.addEventListener("click", async () => {
    const button = container.querySelector("[data-submit-subjective]");
    const latest = {
      ...((await get("answers", question.id)) || baseSubjectiveAnswer(question)),
      textAnswer: textarea?.value || ""
    };

    if (!latest.textAnswer.trim() && !latest.imageDataUrl) {
      showToast("请先输入文字答案或上传图片", "error");
      return;
    }

    button.disabled = true;
    const pendingAnswer = {
      ...latest,
      submitted: true,
      gradingPending: true,
      gradingError: "",
      gradeResult: null,
      aiTeaching: null,
      submittedAt: latest.submittedAt || nowIso(),
      gradingStartedAt: nowIso(),
      updatedAt: nowIso()
    };

    await put("answers", pendingAnswer);
    await touchQuestionSet(set.id);
    startSubjectiveGrading({ note, set, question, answer: pendingAnswer, app });

    if (status) status.textContent = "已提交，正在后台判题。你可以继续完成后面的题目。";
    const nextIndex = Math.min(questions.length - 1, currentIndex + 1);
    if (nextIndex !== currentIndex) {
      setCurrentIndex(set.id, nextIndex);
    }
    app.refresh();
  });
}

function bindManualGradingCorrection(container, app, note, set, question, answer) {
  container.querySelector("[data-correct-grading]")?.addEventListener("click", () => {
    const result = answer?.gradeResult || {};
    const content = document.createElement("form");
    content.className = "grading-correction-form";
    content.innerHTML = `
      <p>人工纠正会新增一条历史记录，不会覆盖或删除原 AI 判题。</p>
      <div class="form-grid two-columns">
        <label><span>纠正后得分</span><input name="score" type="number" min="0" max="100" step="1" value="${Number(answer?.score || 0)}" required /></label>
        <label><span>错误类型</span><select name="errorCategory">${GRADING_ERROR_CATEGORIES.map(
          (item) => `<option value="${item.value}" ${(result.errorCategory || (answer?.isCorrect ? "none" : "other")) === item.value ? "selected" : ""}>${item.label}</option>`
        ).join("")}</select></label>
      </div>
      <label class="checkbox-row"><input name="isCorrect" type="checkbox" ${answer?.isCorrect ? "checked" : ""} /><span>整体判定为正确</span></label>
      <label><span>纠正后的判定理由</span><textarea name="reason" rows="4" required>${escapeHtml(result.reason || "")}</textarea></label>
      <label><span>纠正备注（可选）</span><textarea name="correctionNote" rows="3" placeholder="例如：模型漏看了第二步的等价变形"></textarea></label>
      <div class="form-actions"><button class="primary-button" type="submit">保存人工纠正</button></div>
    `;
    const modal = openModal({ title: "纠正判题结果", content, width: "620px" });
    content.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = content.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const formData = new FormData(content);
        const corrected = await applyManualGradingCorrection({
          question,
          answer,
          score: formData.get("score"),
          isCorrect: formData.get("isCorrect") === "on",
          errorCategory: formData.get("errorCategory"),
          reason: formData.get("reason"),
          correctionNote: formData.get("correctionNote")
        });
        const wrongItem = await get("wrongItems", `wrong_${question.id}`);
        if (corrected.result.isCorrect && corrected.result.score >= 60 && wrongItem) {
          await put("wrongItems", {
            ...wrongItem,
            mastered: true,
            dismissedByCorrection: true,
            gradingCorrectionAttemptId: corrected.attempt.id,
            lastReviewedAt: nowIso()
          });
          await setReviewCardSuspended(wrongItem.id, true);
        } else if (!corrected.result.isCorrect || corrected.result.score < 60) {
          await upsertSubjectiveWrongItem(note, set, question, corrected.answer, corrected.result, corrected.answer.aiTeaching || {});
          await setReviewCardSuspended(`wrong_${question.id}`, false);
        }
        modal.close();
        showToast("人工纠正已保存，原判题记录仍保留", "success");
        app.refresh();
      } catch (error) {
        submit.disabled = false;
        showToast(`保存纠正失败：${error.message}`, "error");
      }
    });
  });
}

function resumePendingSubjectiveGradings(note, set, questions, answersByQuestion, app) {
  questions
    .filter((question) => question.type === "subjective")
    .forEach((question) => {
      const answer = answersByQuestion.get(question.id);
      if (answer?.gradingPending) {
        startSubjectiveGrading({ note, set, question, answer, app });
      }
    });
}

function startSubjectiveGrading({ note, set, question, answer, app }) {
  const key = question.id;
  if (subjectiveGradingTasks.has(key)) return subjectiveGradingTasks.get(key);

  const task = gradeSubjectiveAnswer({ note, set, question, answer, app })
    .catch((error) => {
      console.warn("后台判题任务失败", error);
    })
    .finally(() => {
      subjectiveGradingTasks.delete(key);
    });
  subjectiveGradingTasks.set(key, task);
  return task;
}

async function gradeSubjectiveAnswer({ note, set, question, answer, app }) {
  try {
    const rawGrade = await callJsonCompletion({
      role: "grading",
      messages: buildGradingMessages({
        note,
        question,
        textAnswer: answer.textAnswer,
        imageDataUrl: answer.imageDataUrl
      }),
      temperature: 0
    });
    const gradeResult = normalizeGradeResult(rawGrade);
    const gradingAttempt = await recordGradingAttempt({ question, answer, result: gradeResult, context: "practice" });
    const shouldEnterWrongBook = !gradeResult.isCorrect || gradeResult.score < 60;
    let aiTeaching = {};

    if (shouldEnterWrongBook || gradeResult.needsTeaching) {
      try {
        aiTeaching = await callJsonCompletion({
          role: "question",
          messages: buildTeachingMessages({
            note,
            question,
            answer,
            gradeResult
          }),
          temperature: 0.25
        });
      } catch (teachingError) {
        aiTeaching = {
          aiExplanation: `教学讲解生成失败：${teachingError.message}`,
          targetedFeedback: gradeResult.reason,
          reviewFocus: gradeResult.weaknesses || [],
          nextStep: "请先根据判题理由订正，再重新练习。"
        };
      }
    }

    const submittedAnswer = {
      ...answer,
      submitted: true,
      gradingPending: false,
      gradingError: "",
      isCorrect: gradeResult.isCorrect,
      score: gradeResult.score,
      gradeResult,
      currentGradingAttemptId: gradingAttempt.id,
      aiTeaching,
      gradedAt: nowIso(),
      updatedAt: nowIso()
    };
    await put("answers", submittedAnswer);
    await touchQuestionSet(set.id);
    await recordPracticeAnswer(gradeResult.isCorrect);
    await markCheckInIfSetCompleted(set.id);

    if (shouldEnterWrongBook) {
      await upsertSubjectiveWrongItem(note, set, question, submittedAnswer, gradeResult, aiTeaching);
    }
  } catch (error) {
    try {
      await recordGradingFailure({ question, answer, context: "practice", errorMessage: error.message });
    } catch (historyError) {
      console.warn("保存判题失败历史时出错", historyError);
    }
    await put("answers", {
      ...answer,
      submitted: true,
      gradingPending: false,
      gradingError: error.message,
      updatedAt: nowIso()
    });
  } finally {
    await refreshIfPracticeIsWaiting(app, set.id);
  }
}

async function refreshIfPracticeIsWaiting(app, setId) {
  if (!(window.location.hash || "").startsWith(`#/practice/${setId}`)) return;
  const [questions, answers] = await Promise.all([getByIndex("questions", "setId", setId), getByIndex("answers", "setId", setId)]);
  const answersByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const stats = buildStats(questions, answersByQuestion);
  const currentIndex = Number(localStorage.getItem(currentIndexKey(setId)) || 0);
  if (stats.allSubmitted && currentIndex >= questions.length - 1) {
    app.refresh();
  }
}

async function touchQuestionSet(setId) {
  const latest = await get("questionSets", setId);
  if (!latest) return;
  await put("questionSets", {
    ...latest,
    lastPracticeAt: nowIso(),
    updatedAt: nowIso()
  });
}

async function markCheckInIfSetCompleted(setId) {
  const [questions, answers] = await Promise.all([getByIndex("questions", "setId", setId), getByIndex("answers", "setId", setId)]);
  if (
    questions.length > 0 &&
    questions.every((question) => {
      const answer = answers.find((item) => item.questionId === question.id);
      return answer?.submitted && !answer.gradingPending && !answer.gradingError;
    })
  ) {
    await markCheckIn();
  }
}

function baseSubjectiveAnswer(question) {
  return {
    id: question.id,
    noteId: question.noteId,
    setId: question.setId,
    questionId: question.id,
    type: "subjective",
    textAnswer: "",
    imageDataUrl: "",
    imageName: "",
    submitted: false,
    gradingPending: false,
    gradingError: "",
    updatedAt: nowIso()
  };
}

async function upsertChoiceWrongItem(note, set, question, answer) {
  const selectedOption = answer.selectedOption;
  const selectedText = optionText(question, selectedOption);
  const correctText = optionText(question, question.correctAnswer);
  const existing = await get("wrongItems", `wrong_${question.id}`);
  const errorReason = question.wrongOptionExplanations?.[selectedOption] || "选择错误";

  const wrongItem = {
    id: `wrong_${question.id}`,
    noteId: note?.id || question.noteId,
    section: question.relatedNoteSection || "未标注章节",
    questionType: "choice",
    questionId: question.id,
    setId: set.id,
    questionContent: question.question,
    userAnswer: `${selectedOption}. ${selectedText}`,
    correctAnswer: `${question.correctAnswer}. ${correctText}`,
    errorReason,
    aiExplanation: question.explanation || "",
    createdAt: existing?.createdAt || nowIso(),
    reviewCount: existing?.reviewCount || 0,
    lastReviewedAt: existing?.lastReviewedAt || "",
    mastered: false
  };
  await put("wrongItems", wrongItem);
  await ensureReviewCard({ wrongItem, question });
  return wrongItem;
}

async function upsertSubjectiveWrongItem(note, set, question, answer, gradeResult, aiTeaching) {
  const existing = await get("wrongItems", `wrong_${question.id}`);
  const userAnswerParts = [];
  if (answer.textAnswer) userAnswerParts.push(answer.textAnswer);
  if (answer.imageName) userAnswerParts.push(`[图片答案：${answer.imageName}]`);
  if (gradeResult.recognizedAnswer) userAnswerParts.push(`识别结果：${gradeResult.recognizedAnswer}`);

  const wrongItem = {
    id: `wrong_${question.id}`,
    noteId: note?.id || question.noteId,
    section: question.relatedNoteSection || "未标注章节",
    questionType: "subjective",
    questionId: question.id,
    setId: set.id,
    questionContent: question.question,
    userAnswer: userAnswerParts.join("\n\n") || "未记录",
    correctAnswer: question.referenceAnswer || "未提供参考答案",
    errorReason: [gradeResult.reason, ...(gradeResult.weaknesses || [])].filter(Boolean).join("\n"),
    aiExplanation:
      [aiTeaching.aiExplanation, aiTeaching.targetedFeedback, aiTeaching.nextStep].filter(Boolean).join("\n\n") ||
      gradeResult.reason,
    createdAt: existing?.createdAt || nowIso(),
    reviewCount: existing?.reviewCount || 0,
    lastReviewedAt: existing?.lastReviewedAt || "",
    mastered: false
  };
  await put("wrongItems", wrongItem);
  await ensureReviewCard({ wrongItem, question });
  return wrongItem;
}

function optionText(question, label) {
  const index = LABELS.indexOf(label);
  return String(question.options?.[index] || "").replace(/^[A-D][.、]\s*/, "");
}

function summarizeQuestion(question) {
  if (!question) return "";
  if (question.type === "choice") {
    return {
      type: "choice",
      question: question.question,
      options: question.options,
      relatedNoteSection: question.relatedNoteSection
    };
  }
  return {
    type: "subjective",
    question: question.question,
    referenceAnswer: question.referenceAnswer,
    gradingRubric: question.gradingRubric,
    relatedNoteSection: question.relatedNoteSection
  };
}

function summarizeAnswer(answer) {
  if (!answer) return "";
  return {
    selectedOption: answer.selectedOption,
    textAnswer: answer.textAnswer,
    imageName: answer.imageName,
    submitted: answer.submitted,
    isCorrect: answer.isCorrect,
    score: answer.score,
    gradeResult: answer.gradeResult,
    aiTeaching: answer.aiTeaching
  };
}

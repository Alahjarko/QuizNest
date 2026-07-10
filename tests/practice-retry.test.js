import test from "node:test";
import assert from "node:assert/strict";

import { reviveAnswerForRetry } from "../src/utils/practice.js";

function freshSubjectiveAnswer() {
  return {
    id: "question-1",
    noteId: "note-1",
    setId: "set-1",
    questionId: "question-1",
    type: "subjective",
    textAnswer: "",
    submitted: false,
    gradingPending: false,
    gradingError: "",
    updatedAt: "2026-07-10T05:00:00.000Z"
  };
}

test("retrying a soft-deleted subjective answer starts from a live clean record", () => {
  const tombstone = {
    ...freshSubjectiveAnswer(),
    textAnswer: "旧答案",
    submitted: true,
    isCorrect: false,
    score: 20,
    gradeResult: { reason: "旧判题" },
    deletedAt: "2026-07-10T04:00:00.000Z",
    updatedAt: "2026-07-10T04:00:00.000Z"
  };
  const fresh = freshSubjectiveAnswer();

  const revived = reviveAnswerForRetry(tombstone, fresh);
  const resubmitted = {
    ...revived,
    textAnswer: "新的重做答案",
    submitted: true,
    gradingPending: true
  };

  assert.deepEqual(revived, fresh);
  assert.equal("deletedAt" in revived, false);
  assert.equal("gradeResult" in revived, false);
  assert.equal(resubmitted.textAnswer, "新的重做答案");
  assert.equal(resubmitted.submitted, true);
  assert.equal("deletedAt" in resubmitted, false);
});

test("an existing live draft is preserved while continuing the same attempt", () => {
  const liveDraft = {
    ...freshSubjectiveAnswer(),
    textAnswer: "尚未提交的草稿"
  };

  assert.equal(reviveAnswerForRetry(liveDraft, freshSubjectiveAnswer()), liveDraft);
});

test("a question without an existing answer receives an independent fresh record", () => {
  const fresh = freshSubjectiveAnswer();
  const created = reviveAnswerForRetry(undefined, fresh);

  assert.deepEqual(created, fresh);
  assert.notEqual(created, fresh);
});

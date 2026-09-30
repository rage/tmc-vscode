import { moocGrading as gradingOf, submissionFinished } from "../../../webview-ui/src/test/fixtures"
import {
  gradingUnavailableView,
  inProgressView,
  moocGradingView,
  submitFailedView,
  tmcResultView,
  withProgressStep,
} from "../../panels/submissionView"
import type {
  ExerciseTaskSubmissionStatus,
  GradingProgress,
  SubmissionFinished,
} from "../../shared/langsSchema"
import { SubmissionViewSchema } from "../../shared/shared"

function tmcResult(overrides: Partial<SubmissionFinished> = {}): SubmissionFinished {
  return submissionFinished({
    points: ["1.1", "1.2"],
    solution_url: "https://tmc.mooc.fi/solutions/1",
    ...overrides,
  })
}

function moocGrading(
  progress: GradingProgress,
  scoreGiven: number | null = null,
): ExerciseTaskSubmissionStatus {
  return gradingOf({
    grading_progress: progress,
    score_given: scoreGiven,
    feedback_text: "Feedback",
  })
}

suite("withProgressStep", () => {
  test("appends a changed message and drops a repeat", () => {
    expect(withProgressStep(["a"], "b")).toEqual(["a", "b"])
    expect(withProgressStep(["a", "b"], "b")).toEqual(["a", "b"])
    expect(withProgressStep(["a"], undefined)).toEqual(["a"])
  })

  test("keeps the newest twenty", () => {
    let steps: string[] = []
    for (let step = 0; step < 30; step++) {
      steps = withProgressStep(steps, `Step ${step}`)
    }
    expect(steps).toHaveLength(20)
    expect(steps[0]).toBe("Step 10")
    expect(steps.at(-1)).toBe("Step 29")
  })
})

suite("submission views", () => {
  test("every builder produces a view the protocol accepts", () => {
    const views = [
      inProgressView("uploading", { steps: [] }),
      inProgressView("grading", { fraction: 0.5, steps: ["x"], submissionUrl: "https://a.b/" }),
      submitFailedView({ message: "boom" }),
      gradingUnavailableView({ message: "boom" }),
      ...(["ok", "fail", "hidden", "error", "processing"] as const).map((status) =>
        tmcResultView(tmcResult({ status }), [], 2),
      ),
      moocGradingView({ status: "no-grading-yet" }, 3),
      ...(["FullyGraded", "Failed", "PendingManual", "Pending", "NotReady"] as const).map(
        (progress) => moocGradingView(moocGrading(progress, 1), 3),
      ),
    ]
    for (const view of views) {
      expect(SubmissionViewSchema.safeParse(JSON.parse(JSON.stringify(view))).success).toBe(true)
    }
  })

  test("only a submission still on its way is in progress", () => {
    expect(inProgressView("uploading", { steps: [] }).phase).toBe("uploading")
    expect(inProgressView("grading", { steps: [] }).headline).toBe("Processing submission…")
  })

  test("a submit that never arrived cannot be waited for; a lost status check can", () => {
    expect(submitFailedView({ message: "x" })).toMatchObject({
      phase: "failed",
      canKeepWaiting: false,
    })
    expect(gradingUnavailableView({ message: "x" })).toMatchObject({
      phase: "failed",
      canKeepWaiting: true,
    })
  })
})

suite("tmcResultView", () => {
  test("a passed run has its points, links and no paste help", () => {
    expect(tmcResultView(tmcResult(), [], 3)).toMatchObject({
      phase: "finished",
      headline: "All tests passed on the server",
      points: { given: 2, max: 3 },
      solutionUrl: "https://tmc.mooc.fi/solutions/1",
      submissionUrl: "https://tmc.mooc.fi/submissions/1",
      canPaste: false,
      canKeepWaiting: false,
    })
  })

  test("a failed run offers paste help", () => {
    const view = tmcResultView(tmcResult({ status: "fail", all_tests_passed: false }), [], 3)
    expect(view).toMatchObject({ headline: "Some tests failed on the server", canPaste: true })
  })

  test("a processing error carries the server's explanation", () => {
    const view = tmcResultView(
      tmcResult({ status: "error", all_tests_passed: null, error: "Out of memory" }),
      [],
      3,
    )
    expect(view).toMatchObject({ phase: "failed", error: { details: "Out of memory" } })
    expect(view.points).toBeUndefined()
  })

  test("a result still processing points to the browser, with no wait to resume", () => {
    expect(tmcResultView(tmcResult({ status: "processing" }), [], 3)).toMatchObject({
      phase: "timedOut",
      canKeepWaiting: false,
      submissionUrl: "https://tmc.mooc.fi/submissions/1",
    })
  })

  test("feedback is asked only when there are questions and somewhere to answer them", () => {
    const questions = [{ id: 1, kind: "text", question: "How was it?" }]
    const url = "https://tmc.mooc.fi/feedback"
    expect(tmcResultView(tmcResult({ feedback_answer_url: url }), questions, 3).feedback).toEqual({
      questions,
      isSent: false,
    })
    expect(tmcResultView(tmcResult({ feedback_answer_url: url }), [], 3).feedback).toBeUndefined()
    expect(tmcResultView(tmcResult(), questions, 3).feedback).toBeUndefined()
  })
})

suite("moocGradingView", () => {
  test("a full grade is finished, rounded, and asks for no help", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 2.999), 3)).toMatchObject({
      phase: "finished",
      headline: "Exercise graded",
      points: { given: 3, max: 3 },
      feedbackText: "Feedback",
      canPaste: false,
      canKeepWaiting: false,
    })
  })

  test("a partial grade offers paste help", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 1), 3).canPaste).toBe(true)
  })

  test("a failed grading is a failure the student can get help with", () => {
    expect(moocGradingView(moocGrading("Failed", 0), 3)).toMatchObject({
      phase: "failed",
      canPaste: true,
      canKeepWaiting: false,
    })
  })

  test("manual review is terminal: nothing to wait for", () => {
    expect(moocGradingView(moocGrading("PendingManual"), 3)).toMatchObject({
      phase: "manualReview",
      canKeepWaiting: false,
    })
  })

  test.each([
    ["Pending", moocGrading("Pending")],
    ["NotReady", moocGrading("NotReady")],
    ["no grading yet", { status: "no-grading-yet" } as const],
  ])("%s timed out and can be waited for again", (_name, status) => {
    expect(moocGradingView(status, 3)).toMatchObject({
      phase: "timedOut",
      canKeepWaiting: true,
      canPaste: false,
    })
  })
})

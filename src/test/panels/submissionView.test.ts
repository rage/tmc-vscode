import type {
  ExerciseStanding,
  ExerciseTaskSubmissionStatus,
  GradingProgress,
  SubmissionFinished,
} from "../../../shared/langsSchema"
import { SubmissionViewSchema } from "../../../shared/lib"
import { moocGrading as gradingOf, submissionFinished } from "../../../webview-ui/src/test/fixtures"
import {
  gradingUnavailableView,
  inProgressView,
  moocGradingView,
  submitFailedView,
  tmcResultView,
  withExerciseState,
  withProgressStep,
} from "../../panels/submissionView"

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
  standing?: ExerciseStanding,
): ExerciseTaskSubmissionStatus {
  return gradingOf({
    grading_progress: progress,
    score_given: scoreGiven,
    feedback_text: "Feedback",
    exercise_progress: standing
      ? {
          exercise_id: "exercise",
          score_given: scoreGiven ?? 0,
          score_maximum: 3,
          completed: true,
          attempted: true,
          standing,
          max_tries: null,
          tries_left: null,
          pending_teacher_review: null,
          exercise_locked: false,
        }
      : null,
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
      tone: "passed",
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

  test("a failed run reads as partial success while it earned points, as a failure without", () => {
    const failed = (points: string[]) =>
      tmcResultView(tmcResult({ status: "fail", all_tests_passed: false, points }), [], 3).tone
    expect(failed(["1.1"])).toBe("warning")
    expect(failed([])).toBe("failed")
  })

  test("a processing error carries the server's explanation", () => {
    const view = tmcResultView(
      tmcResult({ status: "error", all_tests_passed: null, error: "Out of memory" }),
      [],
      3,
    )
    expect(view).toMatchObject({
      phase: "failed",
      tone: "failed",
      error: { details: "Out of memory" },
    })
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
  /** A grading of `scoreGiven` whose points the progress holds back for a teacher's review. */
  function underReview(
    scoreGiven: number,
    review: "awaits_chapter_lock" | "awaits_teacher",
  ): ExerciseTaskSubmissionStatus {
    const status = moocGrading("FullyGraded", scoreGiven, "Attempted")
    if (status.status === "grading" && status.grading.exercise_progress) {
      Object.assign(status.grading.exercise_progress, {
        score_given: 0,
        pending_teacher_review: review,
      })
    }
    return status
  }

  test("a passing grading held for review says the tests passed and the points wait", () => {
    const view = moocGradingView(underReview(3, "awaits_chapter_lock"), 3)
    expect(view).toMatchObject({
      headline: "All tests passed",
      tone: "passed",
      pendingReview:
        "The points wait for a teacher's review, which starts once you complete and lock the chapter.",
    })
    expect(view.points).toBeUndefined()
  })

  test("a grading held for review is judged by its own score, never the held-back 0", () => {
    expect(moocGradingView(underReview(1, "awaits_teacher"), 3)).toMatchObject({
      headline: "Some tests failed on the server",
      pendingReview: "The points wait for a teacher's review.",
    })
  })

  test("a grading whose points were given while a review is pending shows them", () => {
    const status = moocGrading("FullyGraded", 3, "Passed")
    if (status.status === "grading" && status.grading.exercise_progress) {
      Object.assign(status.grading.exercise_progress, {
        score_given: 3,
        pending_teacher_review: "awaits_teacher",
      })
    }

    expect(moocGradingView(status, 3)).toMatchObject({
      headline: "Exercise passed",
      points: { given: 3, max: 3 },
      pendingReview: "A teacher reviews this answer, which can change the points.",
    })
  })

  test("a grading the backend counts passed is finished, rounded, and asks for no help", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 2.999, "Passed"), 3)).toMatchObject({
      phase: "finished",
      headline: "Exercise passed",
      tone: "passed",
      points: { given: 3, max: 3 },
      feedbackText: "Feedback",
      canPaste: false,
      canKeepWaiting: false,
    })
  })

  test("a partial grade says tests failed and offers paste help", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 1, "Attempted"), 3)).toMatchObject({
      headline: "Some tests failed on the server",
      tone: "warning",
      canPaste: true,
    })
  })

  test("a submission below full points to an exercise passed earlier keeps its points in view", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 0, "Passed"), 1)
    expect(view).toMatchObject({
      phase: "finished",
      headline: "This submission failed some tests",
      tone: "info",
      explanation:
        "You have already passed this exercise with an earlier submission, so you keep its points.",
    })
    expect(view.points).toBeUndefined()
  })

  test("the last try below full points says the score is final, and help is still offered", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 2, "OutOfTries"), 3)
    expect(view).toMatchObject({
      phase: "finished",
      headline: "Some tests failed on the server",
      explanation: "That was your last try, so this score is final.",
      points: { given: 2, max: 3 },
      canPaste: true,
    })
  })

  test("without a standing from the backend, no score is called passed", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 3), 3)).toMatchObject({
      headline: "Exercise graded",
      tone: "info",
      canPaste: true,
    })
  })

  test("a failed grading is a failure the student can get help with", () => {
    expect(moocGradingView(moocGrading("Failed", 0), 3)).toMatchObject({
      phase: "failed",
      canPaste: true,
      canKeepWaiting: false,
    })
  })

  test("lists the server's per-test results as the TMC result's test cases", () => {
    const view = moocGradingView(
      gradingOf({
        score_given: 0,
        test_results: {
          status: "TESTS_FAILED",
          test_results: [
            { name: "passes", successful: true, points: ["1"], message: "", exception: [] },
            {
              name: "fails",
              successful: false,
              points: [],
              message: "expected 2",
              exception: ["at Test.fails"],
            },
          ],
          logs: {},
        },
      }),
      1,
    )

    expect(view.testCases).toEqual([
      { name: "passes", successful: true, message: "", exception: [], detailed_message: null },
      {
        name: "fails",
        successful: false,
        message: "expected 2",
        exception: ["at Test.fails"],
        detailed_message: null,
      },
    ])
    expect(view.error).toBeUndefined()
  })

  test("a run that did not compile says so, with the compiler's output", () => {
    const view = moocGradingView(
      gradingOf({
        score_given: 0,
        test_results: {
          status: "COMPILE_FAILED",
          test_results: [],
          logs: { stdout: "Main.java:3: error", stderr: "" },
        },
      }),
      1,
    )

    expect(view.testCases).toEqual([])
    expect(view.error).toEqual({
      message: "Your code did not compile on the server.",
      details: "Main.java:3: error",
    })
  })

  test("a grading without a test run has no test cases", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 1, "Passed"), 1)).toMatchObject({
      testCases: [],
      error: undefined,
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

suite("withExerciseState", () => {
  const heldForLock =
    "The points wait for a teacher's review, which starts once you complete and lock the chapter."
  const onDisk = { isOnDisk: true, isInCourse: true }

  test("a finished grading says what the review waits for now, not at grading time", () => {
    const view = {
      ...moocGradingView(moocGrading("FullyGraded", 3, "Attempted"), 3),
      pendingReview: heldForLock,
    }

    const shown = withExerciseState(view, {
      ...onDisk,
      pendingReview: "The points wait for a teacher's review.",
    })

    expect(shown.pendingReview).toBe("The points wait for a teacher's review.")
  })

  test("a finished grading drops a review no longer pending", () => {
    const view = {
      ...moocGradingView(moocGrading("FullyGraded", 3, "Attempted"), 3),
      pendingReview: heldForLock,
    }

    expect(withExerciseState(view, onDisk).pendingReview).toBeUndefined()
  })

  test("a grading still in progress gets no review sentence", () => {
    const view = inProgressView("grading", { steps: [] })

    expect(
      withExerciseState(view, { ...onDisk, pendingReview: heldForLock }).pendingReview,
    ).toBeUndefined()
  })
})

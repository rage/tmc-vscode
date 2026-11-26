import type {
  ExerciseStanding,
  ExerciseTaskSubmissionStatus,
  GradingProgress,
  SubmissionFinished,
} from "../../../shared/langsSchema"
import { makeMoocKind, makeTmcKind, SubmissionViewSchema } from "../../../shared/lib"
import { moocGrading as gradingOf, submissionFinished } from "../../../webview-ui/src/test/fixtures"
import {
  gradingUnavailableView,
  inProgressView,
  moocGradingView,
  standingView,
  submitFailedView,
  testedLocallyView,
  tmcResultView,
  withExerciseState,
  withProgressStep,
} from "../../panels/submissionView"
import { moocCourseExercise, tmcCourseExercise } from "../fixtures/courses"

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
          reviewing_stage: null,
          teacher_review: null,
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
      headline: "Passed",
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
    expect(view).toMatchObject({ headline: "Not passed", canPaste: true })
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
      serverOutput: "Out of memory",
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
    expect(view.heldPointsMax).toBe(3)
  })

  test("a grading held for review is judged by its own score, never the held-back 0", () => {
    expect(moocGradingView(underReview(1, "awaits_teacher"), 3)).toMatchObject({
      headline: "Some tests failed",
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
      headline: "Passed",
      points: { given: 3, max: 3 },
      pendingReview: "A teacher reviews this answer, which can change the points.",
    })
  })

  test("a grading the backend counts passed is finished, rounded, and asks for no help", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 2.999, "Passed"), 3)).toMatchObject({
      phase: "finished",
      headline: "Passed",
      tone: "passed",
      points: { given: 3, max: 3 },
      feedbackText: "Feedback",
      canPaste: false,
      canKeepWaiting: false,
    })
  })

  test("a partial grade says tests failed and offers paste help", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 1, "Attempted"), 3)).toMatchObject({
      headline: "Not passed",
      tone: "warning",
      canPaste: true,
    })
  })

  test("a submission below full points to an exercise passed earlier keeps its points in view", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 0, "Passed"), 1)
    expect(view).toMatchObject({
      phase: "finished",
      headline: "Passed",
      tone: "info",
      explanation:
        "This submission failed some tests. You keep the points of your earlier passing submission.",
    })
    expect(view.points).toBeUndefined()
  })

  test("the last try below full points says the score is final, and help is still offered", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 2, "OutOfTries"), 3)
    expect(view).toMatchObject({
      phase: "finished",
      headline: "Not passed",
      explanation: "That was your last try, so this score is final.",
      points: { given: 2, max: 3 },
      canPaste: true,
    })
  })

  test("without a standing from the backend, no score is called passed", () => {
    expect(moocGradingView(moocGrading("FullyGraded", 3), 3)).toMatchObject({
      headline: "Graded",
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
    expect(view.error).toEqual({ message: "Your code did not compile on the server." })
    expect(view.serverOutput).toBe("Main.java:3: error")
  })

  test("a grading without a test run has no test cases", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 1, "Passed"), 1)
    expect(view.testCases).toEqual([])
    expect(view.error).toBeUndefined()
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

  test("a passing grading whose points a review has held back since loses its score", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 1, "Passed"), 1)

    const shown = withExerciseState(view, {
      ...onDisk,
      pendingReview: "The points wait for a teacher's review.",
      arePointsHeld: true,
    })

    expect(shown).toMatchObject({
      headline: "All tests passed",
      pendingReview: "The points wait for a teacher's review.",
    })
    expect(shown.points).toBeUndefined()
    expect(shown.heldPointsMax).toBe(1)
    expect(withExerciseState(view, onDisk).points).toStrictEqual({ given: 1, max: 1 })
    expect(withExerciseState(view, onDisk).heldPointsMax).toBeUndefined()
  })

  test("a standing short of a pass is headed by why it can no longer be submitted", () => {
    const standing = { ...testedLocallyView(0), phase: "standing" as const, headline: "Not passed" }
    const refused = {
      ...onDisk,
      submitRefusal: "The deadline of loops has passed, so it can no longer be submitted.",
      submitRefusalLabel: "Deadline passed",
    }

    expect(withExerciseState(standing, refused).headline).toBe("Deadline passed")
    expect(withExerciseState({ ...standing, isExercisePassed: true }, refused).headline).toBe(
      "Not passed",
    )
    expect(withExerciseState(standing, onDisk).headline).toBe("Not passed")
  })

  test("a local pass of an exercise that can no longer be submitted invites no submit", () => {
    const shown = withExerciseState(testedLocallyView(0), {
      ...onDisk,
      submitRefusal: "The deadline of loops has passed, so it can no longer be submitted.",
      submitRefusalLabel: "Deadline passed",
    })

    expect(shown.headline).toBe("Tests pass on your computer")
    expect(shown.explanation).toBeUndefined()
    expect(withExerciseState(testedLocallyView(0), onDisk).explanation).toBe(
      "Submit the exercise to have it graded.",
    )
  })

  test("says a logged-out student must log in to submit, and forgets it once logged in", () => {
    const loggedOut = withExerciseState(testedLocallyView(0), { ...onDisk, isLoggedOut: true })

    expect(loggedOut.isLoggedOut).toBe(true)
    expect(withExerciseState(loggedOut, onDisk).isLoggedOut).toBeUndefined()
  })

  test("a finished grading drops a review no longer pending", () => {
    const view = {
      ...moocGradingView(moocGrading("FullyGraded", 3, "Attempted"), 3),
      pendingReview: heldForLock,
    }

    expect(withExerciseState(view, onDisk).pendingReview).toBeUndefined()
  })

  test("a finished grading takes the model solution a later course refresh revealed", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 3, "Passed"), 3)

    expect(
      withExerciseState(view, { ...onDisk, solutionUrl: "https://material/loops" }),
    ).toMatchObject({ solutionUrl: "https://material/loops" })
  })

  test("a grading keeps the model solution it was shown with", () => {
    const view = {
      ...moocGradingView(moocGrading("FullyGraded", 3, "Passed"), 3),
      solutionUrl: "https://material/loops",
    }

    expect(withExerciseState(view, onDisk).solutionUrl).toBe("https://material/loops")
  })

  test("carries the course material page, offered while there is no model solution", () => {
    const view = moocGradingView(moocGrading("FullyGraded", 3, "Passed"), 3)

    expect(
      withExerciseState(view, { ...onDisk, materialUrl: "https://material/loops" }),
    ).toMatchObject({ materialUrl: "https://material/loops" })
  })

  test("a grading still in progress gets no model solution", () => {
    const view = inProgressView("grading", { steps: [] })

    expect(
      withExerciseState(view, { ...onDisk, solutionUrl: "https://material/loops" }).solutionUrl,
    ).toBeUndefined()
  })

  test("a grading still in progress gets no review sentence", () => {
    const view = inProgressView("grading", { steps: [] })

    expect(
      withExerciseState(view, { ...onDisk, pendingReview: heldForLock }).pendingReview,
    ).toBeUndefined()
  })
})

suite("standingView", function () {
  test("a passed exercise is passed, with its points and model solution, and no paste help", function () {
    const view = standingView(
      makeTmcKind(tmcCourseExercise({ passed: true, awardedPoints: 1 })),
      "https://tmc.example/exercises/1/solution",
    )

    expect(SubmissionViewSchema.parse(view)).toEqual(view)
    expect(view).toMatchObject({
      phase: "standing",
      headline: "Passed",
      tone: "passed",
      points: { given: 1, max: 1 },
      solutionUrl: "https://tmc.example/exercises/1/solution",
      canPaste: false,
      isExercisePassed: true,
    })
  })

  test("an exercise not passed yet offers paste help", function () {
    const view = standingView(makeMoocKind(moocCourseExercise({ availablePoints: 3 })), undefined)

    expect(view).toMatchObject({
      headline: "Not passed",
      tone: "info",
      points: { given: 0, max: 3 },
      canPaste: true,
      isExercisePassed: false,
    })
    expect(view.wasSubmitted).toBeUndefined()
  })

  test("a submitted exercise not passed reads as its grading did, with Submit Again", function () {
    const failed = standingView(
      makeMoocKind(moocCourseExercise({ availablePoints: 3, attempted: true })),
      undefined,
    )
    const graded = moocGradingView(moocGrading("FullyGraded", 0, "Attempted"), 3)

    expect(failed).toMatchObject({ headline: graded.headline, tone: graded.tone })
    expect(failed.wasSubmitted).toBe(true)
    expect(
      standingView(
        makeTmcKind(tmcCourseExercise({ availablePoints: 3, awardedPoints: 1 })),
        undefined,
      ),
    ).toMatchObject({ headline: "Not passed", tone: "warning", wasSubmitted: true })
  })

  test("an exercise out of tries reads as not passed, for good", function () {
    const view = standingView(makeMoocKind(moocCourseExercise({ outOfTries: true })), undefined)

    expect(view).toMatchObject({ headline: "Not passed", tone: "failed" })
  })

  test("points held for a teacher's review are not shown as a score, and the wait heads it", function () {
    const view = standingView(
      makeMoocKind(moocCourseExercise({ pendingReview: "awaits_teacher" })),
      undefined,
    )

    expect(view.points).toBeUndefined()
    expect(view.heldPointsMax).toBe(1)
    expect(view.headline).toBe("Waiting for review")
  })

  test("takes the pending review the exercise stands with now", function () {
    const view = withExerciseState(standingView(makeMoocKind(moocCourseExercise()), undefined), {
      isOnDisk: true,
      isInCourse: true,
      pendingReview: "Waiting for a teacher's review.",
    })

    expect(view.pendingReview).toBe("Waiting for a teacher's review.")
  })
})

suite("testedLocallyView", function () {
  test("says the tests passed here, and leaves grading to a submit", function () {
    const view = testedLocallyView(0)

    expect(SubmissionViewSchema.parse(view)).toEqual(view)
    expect(view).toMatchObject({
      phase: "testedLocally",
      headline: "Tests pass on your computer",
      tone: "passed",
      canPaste: false,
      canKeepWaiting: false,
    })
  })
})

suite("moocGradingView edge cases", () => {
  test("a zero-point exercise is headed by its tests, not a pass", () => {
    const failing = gradingOf({
      grading_progress: "FullyGraded",
      score_given: 0,
      feedback_text: null,
      test_results: {
        status: "TESTS_FAILED",
        test_results: [{ name: "t", successful: false, points: [], message: "no", exception: [] }],
        logs: {},
      },
    })

    expect(moocGradingView(failing, 0)).toMatchObject({
      headline: "Some tests failed",
      tone: "failed",
    })
  })

  test("a failed grading on the last try says the score is final", () => {
    expect(moocGradingView(moocGrading("Failed", 0, "OutOfTries"), 3)).toMatchObject({
      headline: "Grading failed",
      explanation: "That was your last try, so this score is final.",
    })
  })

  test("a hidden exam grading and an unknown status read as received", () => {
    expect(moocGradingView({ status: "grading-hidden" }, 3)).toMatchObject({
      headline: "Submission received",
      explanation: "Its result is shown once the exam ends.",
    })
    expect(moocGradingView({ status: "unrecognized" }, 3).headline).toBe("Submission received")
  })
})

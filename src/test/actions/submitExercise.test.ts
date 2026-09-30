import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import {
  keepWaitingForGrading,
  sendSubmissionFeedback,
  submitExercise,
} from "../../actions/submitExercise"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { failure } from "../../api/withOperation"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { runForExercise } from "../../commands/runForExercise"
import { BottleneckError, InsufficientScopeError } from "../../errors"
import type { ExtensionToWebview, LocalCourseData, SubmissionView } from "../../shared/shared"
import { CourseIdentifier, makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"

// TmcPanel talks to the vscode webview API, so the whole module is mocked; the
// action only needs renderSide (a no-op), postToSidePanel (asserted), and a defined
// sidePanel so the re-render branch is skipped.
vi.mock("../../panels/TmcPanel", () => ({
  TmcPanel: {
    renderSide: vi.fn(),
    postToSidePanel: vi.fn(),
    sidePanel: {},
  },
}))

import { TmcPanel } from "../../panels/TmcPanel"

const COURSE_SLUG = "mooc-python-course"
const EXERCISE_SLUG = "loops"
const MOOC_EXERCISE_ID = "mooc-ex-1"

const TMC_COURSE_SLUG = "test-python-course"
const TMC_EXERCISE_ID = 4321

const moocCourse: MoocLocalCourseData = {
  id: "instance-uuid-1",
  name: COURSE_SLUG,
  title: "Mooc Python",
  description: null,
  organization: "mooc",
  exercises: [
    {
      id: MOOC_EXERCISE_ID,
      name: EXERCISE_SLUG,
      availablePoints: 3,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    },
  ],
  availablePoints: 3,
  awardedPoints: 0,
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: false,
  materialUrl: null,
}

const tmcCourse: TmcLocalCourseData = {
  id: 7,
  name: TMC_COURSE_SLUG,
  title: "Test Python",
  description: "A tmc course",
  organization: "test",
  exercises: [
    {
      id: TMC_EXERCISE_ID,
      name: EXERCISE_SLUG,
      availablePoints: 2,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    },
  ],
  availablePoints: 2,
  awardedPoints: 0,
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: false,
  materialUrl: null,
}

const moocExercise: WorkspaceExercise = {
  backend: "mooc",
  courseSlug: COURSE_SLUG,
  exerciseSlug: EXERCISE_SLUG,
  status: ExerciseStatus.Open,
  uri: { fsPath: "/path/to/exercise" } as unknown as vscode.Uri,
}

const tmcExercise: WorkspaceExercise = {
  ...moocExercise,
  backend: "tmc",
  courseSlug: TMC_COURSE_SLUG,
}

const extensionContext = { extensionUri: {} } as unknown as vscode.ExtensionContext

// `langsMethods` holds only the backend's own submit call, so a submission routed
// through the other backend's method fails instead of quietly passing.
function contextFor(
  course: LocalCourseData,
  langsMethods: Record<string, unknown>,
): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
} {
  const setPassed = vi.fn().mockResolvedValue(Ok.EMPTY)
  const actionContext = createMockActionContext({
    startup: {
      langs: langsMethods as unknown as ReadyStartup["langs"],
      userData: {
        getCourseBySlug: () => Ok(course),
        getCourse: () => Ok(course),
        setExerciseAsPassed: setPassed,
      } as unknown as ReadyStartup["userData"],
      exerciseDecorationProvider: {
        updateDecorationsForExercises: vi.fn(),
      } as unknown as ReadyStartup["exerciseDecorationProvider"],
    },
  })
  return { actionContext, setPassed }
}

const TASK_SUBMISSION_ID = "task-submission-1"

function moocContextWith(gradingResult: unknown): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
  wait: ReturnType<typeof vi.fn>
} {
  const submit = vi
    .fn()
    .mockResolvedValue(
      Ok({ task_submission_id: TASK_SUBMISSION_ID, slide_submission_id: "slide-submission-1" }),
    )
  const wait = vi.fn().mockResolvedValue(Ok(gradingResult))
  const { actionContext, setPassed } = contextFor(makeMoocKind(moocCourse), {
    submitMoocExercise: submit,
    waitForMoocGrading: wait,
  })
  return { actionContext, setPassed, submit, wait }
}

// Like `moocContextWith`, but the submit itself resolves to an `Err` (e.g. the
// submission-throttle BottleneckError or a submit failure).
function moocContextWithErr(error: Error): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
} {
  return contextFor(makeMoocKind(moocCourse), {
    submitMoocExercise: vi.fn().mockResolvedValue(Err(error)),
  })
}

/** Every view the action showed, oldest first. */
function shownViews(): SubmissionView[] {
  return vi
    .mocked(TmcPanel.postToSidePanel)
    .mock.calls.flat()
    .flatMap((message: ExtensionToWebview) =>
      message.type === "submissionView" ? [message.view] : [],
    )
}

function lastView(): SubmissionView | undefined {
  return shownViews().at(-1)
}

function shownPanelId(): number {
  const route = vi.mocked(TmcPanel.renderSide).mock.calls.at(-1)?.[2]
  if (route === undefined) {
    throw new Error("no submission panel was rendered")
  }
  return route.id
}

function grading(overrides: Record<string, unknown>): unknown {
  return {
    status: "grading",
    grading: {
      grading_progress: "FullyGraded",
      score_given: null,
      grading_started_at: null,
      grading_completed_at: null,
      feedback_text: null,
      ...overrides,
    },
  }
}

function tmcContextWith(submitResult: unknown): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Ok(submitResult))
  const { actionContext, setPassed } = contextFor(makeTmcKind(tmcCourse), {
    submitTmcExerciseAndWaitForResults: submit,
  })
  return { actionContext, setPassed, submit }
}

suite("submitExercise action, tmc", () => {
  const passingSubmission = {
    status: "ok",
    all_tests_passed: true,
    points: ["01-01"],
    test_cases: [],
    feedback_questions: [{ id: 3, question: "How was it?", kind: "Text" }],
  }

  test("submits through the tmc call and posts the full result", async () => {
    const { actionContext, setPassed, submit } = tmcContextWith(passingSubmission)

    const result = await submitExercise(extensionContext, actionContext, tmcExercise)
    expect(result.ok).toBe(true)

    expect(submit).toHaveBeenCalledWith(
      TMC_EXERCISE_ID,
      "/path/to/exercise",
      expect.any(Function),
      expect.any(Function),
    )
    expect(lastView()).toMatchObject({
      phase: "finished",
      headline: "All tests passed on the server",
      points: { given: 1, max: 2 },
    })
    expect(setPassed).toHaveBeenCalledWith("tmc", TMC_COURSE_SLUG, EXERCISE_SLUG)
    // The command layer refreshes this course's totals after a successful submit.
    expect(result.val).toEqual(CourseIdentifier.from(tmcCourse.id))
  })

  test("the submission's page on the server reaches the panel", async () => {
    // Only the tmc backend has one, and it arrives through its own callback
    // before the grading does, so the panel can offer it while it waits.
    const { actionContext, submit } = tmcContextWith(passingSubmission)

    await submitExercise(extensionContext, actionContext, tmcExercise)

    const onSubmissionUrl = submit.mock.calls[0]?.[3] as (url: string) => void
    onSubmissionUrl("https://tmc.mooc.fi/submissions/1")
    expect(lastView()).toMatchObject({
      phase: "grading",
      submissionUrl: "https://tmc.mooc.fi/submissions/1",
    })
  })

  test("progress arrives as the uploading view until the server has the submission", async () => {
    const { actionContext, submit } = tmcContextWith(passingSubmission)

    await submitExercise(extensionContext, actionContext, tmcExercise)

    const onProgress = submit.mock.calls[0]?.[2] as (fraction: number, message?: string) => void
    onProgress(0.25, "Compressing")
    expect(lastView()).toMatchObject({
      phase: "uploading",
      progressFraction: 0.25,
      progressSteps: ["Compressing"],
    })
  })

  test("a failing submission posts the result but does not mark passed", async () => {
    const { actionContext, setPassed } = tmcContextWith({
      status: "ok",
      all_tests_passed: false,
      points: [],
      test_cases: [],
    })

    await submitExercise(extensionContext, actionContext, tmcExercise)

    expect(setPassed).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "finished", canPaste: true, feedback: undefined })
  })

  test("a stored exercise id from the other backend is refused", async () => {
    // The course says tmc but its exercise carries a mooc id, so there is nothing to
    // submit; submitting it anyway would send the work to the wrong server.
    const mismatched = makeTmcKind({
      ...tmcCourse,
      exercises: moocCourse.exercises,
    }) as unknown as LocalCourseData
    const submit = vi.fn()
    const { actionContext } = contextFor(mismatched, {
      submitTmcExerciseAndWaitForResults: submit,
    })

    const result = await submitExercise(extensionContext, actionContext, tmcExercise)

    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain("is not a TMC Server exercise")
    expect(submit).not.toHaveBeenCalled()
  })
})

suite("submitExercise action, mooc", () => {
  test("submits without blocking, then waits for that submission's grading", async () => {
    const graded = grading({ score_given: 3, feedback_text: "All tests passed" })
    const { actionContext, setPassed, submit, wait } = moocContextWith(graded)

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.ok).toBe(true)

    expect(submit).toHaveBeenCalledWith(MOOC_EXERCISE_ID, "/path/to/exercise")
    expect(wait).toHaveBeenCalledWith(TASK_SUBMISSION_ID, expect.any(Function))
    expect(shownViews().map((view) => view.phase)).toEqual(["uploading", "grading", "finished"])
    expect(lastView()).toMatchObject({
      headline: "Exercise graded",
      points: { given: 3, max: 3 },
      feedbackText: "All tests passed",
      canKeepWaiting: false,
    })
    expect(setPassed).toHaveBeenCalledWith("mooc", COURSE_SLUG, EXERCISE_SLUG)
    // The command layer refreshes this course's totals after a successful submit.
    expect(result.val).toEqual(CourseIdentifier.from(moocCourse.id))
  })

  test("grading progress keeps changed messages only, on an indeterminate bar", async () => {
    const { actionContext, wait } = moocContextWith(grading({ score_given: 3 }))

    await submitExercise(extensionContext, actionContext, moocExercise)

    const onProgress = wait.mock.calls[0]?.[1] as (fraction: number, message?: string) => void
    onProgress(1, "Grading in progress")
    onProgress(1, "Grading in progress")
    expect(lastView()).toMatchObject({ phase: "grading", progressSteps: ["Grading in progress"] })
    expect(lastView()?.progressFraction).toBeUndefined()
  })

  test("a failed grading does not mark the exercise passed", async () => {
    const { actionContext, setPassed } = moocContextWith(
      grading({ grading_progress: "Failed", score_given: 0 }),
    )

    await submitExercise(extensionContext, actionContext, moocExercise)
    expect(setPassed).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "failed", headline: "Grading failed" })
  })

  test("a pending-manual grading is shown but does not mark passed", async () => {
    const { actionContext, setPassed } = moocContextWith(
      grading({ grading_progress: "PendingManual", score_given: 0.5 }),
    )

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.ok).toBe(true)
    expect(setPassed).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "manualReview", canKeepWaiting: false })
  })

  test("a grading still pending when the CLI stops waiting can be waited for again", async () => {
    const { actionContext, setPassed, wait } = moocContextWith(
      grading({ grading_progress: "Pending" }),
    )

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.ok).toBe(true)
    expect(setPassed).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "timedOut", canKeepWaiting: true })

    wait.mockResolvedValueOnce(Ok(grading({ score_given: 2 })))
    const panelId = shownPanelId()
    const waited = await keepWaitingForGrading(extensionContext, actionContext, panelId)

    expect(waited.val).toEqual(CourseIdentifier.from(moocCourse.id))
    expect(wait).toHaveBeenLastCalledWith(TASK_SUBMISSION_ID, expect.any(Function))
    expect(lastView()).toMatchObject({ phase: "finished", points: { given: 2, max: 3 } })
    expect(setPassed).toHaveBeenCalledWith("mooc", COURSE_SLUG, EXERCISE_SLUG)

    const again = await keepWaitingForGrading(extensionContext, actionContext, panelId)
    expect(again.err).toBe(true)
  })

  test("a newer submission's panel leaves nothing to wait for in the one it replaced", async () => {
    const { actionContext } = moocContextWith(grading({ grading_progress: "Pending" }))
    await submitExercise(extensionContext, actionContext, moocExercise)
    const replacedPanelId = shownPanelId()

    await submitExercise(extensionContext, actionContext, moocExercise)

    const waited = await keepWaitingForGrading(extensionContext, actionContext, replacedPanelId)
    expect(waited.err).toBe(true)
    const current = await keepWaitingForGrading(extensionContext, actionContext, shownPanelId())
    expect(current.ok).toBe(true)
  })

  test("a failed status check after the submit still offers to keep waiting", async () => {
    const { actionContext, wait } = moocContextWith(undefined)
    wait.mockResolvedValue(Err(new Error("Connection reset by peer")))

    const result = await submitExercise(extensionContext, actionContext, moocExercise)

    expect(result.ok).toBe(true)
    expect(lastView()).toMatchObject({
      phase: "failed",
      canKeepWaiting: true,
      error: { message: "Connection reset by peer." },
    })
  })

  test("keeping waiting for a panel with no unfinished grading errs", async () => {
    const { actionContext, wait } = moocContextWith(grading({}))

    const waited = await keepWaitingForGrading(extensionContext, actionContext, -1)

    expect(waited.err).toBe(true)
    expect(wait).not.toHaveBeenCalled()
  })

  test("a second submit of the same exercise is rejected while one is in flight", async () => {
    // The guard lives in the action rather than `commands/submitExercise`, because
    // `TmcPanel` calls the paste actions -- which share this key -- directly. The
    // notification for the rejection is `withOperation`'s job now, not this action's:
    // showing it here too would double it once the command layer also reports it.
    let finishFirst!: () => void
    const submit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finishFirst = () => resolve(Err(new Error("offline")))
      }),
    )
    const { actionContext } = contextFor(makeMoocKind(moocCourse), {
      submitMoocExercise: submit,
    })
    const notification = vi.mocked(actionContext.dialog.notification)

    const first = submitExercise(extensionContext, actionContext, moocExercise)
    const second = await submitExercise(extensionContext, actionContext, moocExercise)

    expect(second.err).toBe(true)
    expect(second.val).toBeInstanceOf(BottleneckError)
    expect(notification).not.toHaveBeenCalled()
    // the rejected call must not have reached the CLI
    expect(submit).toHaveBeenCalledTimes(1)

    finishFirst()
    await first

    // and the key is free again once the first submit finishes
    await submitExercise(extensionContext, actionContext, moocExercise)
    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("a BottleneckError from the submission throttle is shown in the panel", async () => {
    const error = new BottleneckError("You are submitting too fast, try again later.")
    const { actionContext, setPassed } = moocContextWithErr(error)

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result).toEqual(Ok(undefined))
    expect(setPassed).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({
      phase: "failed",
      canKeepWaiting: false,
      error: { message: "You are submitting too fast, try again later." },
    })
  })

  test("the failure survives the webview boundary with its message intact", async () => {
    // The panel reads `error.message`, and the webview bridge serializes the
    // message as JSON -- which drops a live Error's non-enumerable `message`.
    const { actionContext } = moocContextWithErr(new Error("Connection reset by peer"))

    await submitExercise(extensionContext, actionContext, moocExercise)

    const delivered = JSON.parse(JSON.stringify(lastView())) as SubmissionView
    expect(delivered.error?.message).toBe("Connection reset by peer.")
  })
})

// These drive the action through the real `runForExercise`/`withOperation` boundary
// (bypassing only `commands/submitExercise`'s post-submit refresh) to prove the
// cross-layer contract: the busy notice is shown exactly once, and a failure the panel
// shows, remedies included, is not also notified.
suite("submitExercise action, through the real runForExercise boundary", () => {
  function contextWithWorkspace(
    course: LocalCourseData,
    langsMethods: Record<string, unknown>,
    exercise: WorkspaceExercise,
  ): ReadyActionContext {
    const { actionContext } = contextFor(course, langsMethods)
    const workspaceManager = {
      get activeExercise() {
        return exercise
      },
      getExerciseContaining: () => exercise,
    } as unknown as ReadyStartup["workspaceManager"]
    return { ...actionContext, startup: { ...actionContext.startup, workspaceManager } }
  }

  function submitBody(actionContext: ReadyActionContext) {
    return (exercise: WorkspaceExercise) =>
      submitExercise(extensionContext, actionContext, exercise).then((result) =>
        result.err ? failure("Exercise submission failed.", result.val) : result,
      )
  }

  test("a busy rejection notifies exactly once and reports no error", async () => {
    let finishFirst!: () => void
    const submit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finishFirst = () => resolve(Err(new Error("offline")))
      }),
    )
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: submit },
      moocExercise,
    )
    const notification = vi.mocked(actionContext.dialog.notification)
    const reportError = vi.mocked(actionContext.dialog.reportError)

    const first = runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )
    const second = await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(second.err).toBe(true)
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )
    expect(reportError).not.toHaveBeenCalled()

    finishFirst()
    await first
  })

  test("a plain submission failure shows in the panel only", async () => {
    const cause = new Error("Connection reset by peer")
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: vi.fn().mockResolvedValue(Err(cause)) },
      moocExercise,
    )
    const notification = vi.mocked(actionContext.dialog.notification)
    const reportError = vi.mocked(actionContext.dialog.reportError)
    const errorNotification = vi.mocked(actionContext.dialog.errorNotification)

    const result = await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(result.ok).toBe(true)
    expect(notification).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    expect(errorNotification).not.toHaveBeenCalled()
  })

  test("an insufficient-scope failure offers its remedy in the panel, not a toast", async () => {
    const cause = new InsufficientScopeError("exercise-services")
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: vi.fn().mockResolvedValue(Err(cause)) },
      moocExercise,
    )
    const reportError = vi.mocked(actionContext.dialog.reportError)

    await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(reportError).not.toHaveBeenCalled()
    expect(lastView()?.error?.actions).toEqual([{ label: "Log in", command: "tmc.showMoocLogin" }])
  })
})

suite("sendSubmissionFeedback action", () => {
  const FEEDBACK_URL = "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback"

  async function submitAskingFeedback(feedbackUrl: string): Promise<ReadyActionContext> {
    vi.mocked(TmcPanel.postToSidePanel).mockClear()
    const submitFeedback = vi.fn().mockResolvedValue(Ok({ api_version: 8, status: "ok" }))
    const { actionContext } = contextFor(makeTmcKind(tmcCourse), {
      submitTmcExerciseAndWaitForResults: vi.fn().mockResolvedValue(
        Ok({
          status: "ok",
          all_tests_passed: true,
          points: [],
          test_cases: [],
          feedback_answer_url: feedbackUrl,
          feedback_questions: [{ id: 3, question: "How was it?", kind: "Text" }],
        }),
      ),
      submitSubmissionFeedback: submitFeedback,
    })
    await submitExercise(extensionContext, actionContext, tmcExercise)
    return actionContext
  }

  test("sends the answers to the URL the submission result asked them at", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)

    const sent = await sendSubmissionFeedback(actionContext, shownPanelId(), [
      { questionId: 3, answer: "Fun" },
    ])

    expect(sent.ok).toBe(true)
    expect(actionContext.startup.langs.submitSubmissionFeedback).toHaveBeenCalledWith(
      FEEDBACK_URL,
      { status: [{ question_id: 3, answer: "Fun" }] },
    )
  })

  test("shows the panel its feedback as sent", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)

    await sendSubmissionFeedback(actionContext, shownPanelId(), [{ questionId: 3, answer: "Fun" }])

    expect(lastView()).toMatchObject({ phase: "finished", feedback: { isSent: true } })
  })

  test("refuses a panel whose submission asked nothing", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)

    const sent = await sendSubmissionFeedback(actionContext, -1, [{ questionId: 3, answer: "Fun" }])

    expect(sent.err).toBe(true)
    expect(actionContext.startup.langs.submitSubmissionFeedback).not.toHaveBeenCalled()
  })

  test("answers each submission's questions once", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)
    const panelId = shownPanelId()

    await sendSubmissionFeedback(actionContext, panelId, [{ questionId: 3, answer: "Fun" }])
    const second = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "Again" },
    ])

    expect(second.err).toBe(true)
    expect(actionContext.startup.langs.submitSubmissionFeedback).toHaveBeenCalledOnce()
  })

  test("a failed send can be retried", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)
    const panelId = shownPanelId()
    vi.mocked(actionContext.startup.langs.submitSubmissionFeedback).mockResolvedValueOnce(
      Err(new Error("connection reset")),
    )

    const first = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "a" },
    ])
    const second = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "a" },
    ])

    expect(first.err).toBe(true)
    expect(second.ok).toBe(true)
  })
})

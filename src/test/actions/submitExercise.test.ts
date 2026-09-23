import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { submitExercise } from "../../actions/submitExercise"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { failure } from "../../api/withOperation"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { runForExercise } from "../../commands/runForExercise"
import { BottleneckError, InsufficientScopeError } from "../../errors"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"

// TmcPanel talks to the vscode webview API, so the whole module is mocked; the
// action only needs renderSide (a no-op), postMessage (asserted), and a defined
// sidePanel so the re-render branch is skipped.
vi.mock("../../panels/TmcPanel", () => ({
  nextPanelId: () => 1,
  TmcPanel: {
    renderSide: vi.fn(),
    postMessage: vi.fn(),
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

function moocContextWith(submitResult: unknown): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Ok(submitResult))
  const { actionContext, setPassed } = contextFor(makeMoocKind(moocCourse), {
    submitMoocExerciseAndWaitForResults: submit,
  })
  return { actionContext, setPassed, submit }
}

// Like `moocContextWith`, but the blocking submit resolves to an `Err` (e.g. the
// submission-throttle BottleneckError or a submit failure).
function moocContextWithErr(error: Error): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
} {
  return contextFor(makeMoocKind(moocCourse), {
    submitMoocExerciseAndWaitForResults: vi.fn().mockResolvedValue(Err(error)),
  })
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
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "submissionResult",
        result: passingSubmission,
        questions: [{ id: 3, kind: "text", question: "How was it?" }],
      }),
    )
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
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "submissionStatusUrl",
        url: "https://tmc.mooc.fi/submissions/1",
      }),
    )
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
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "submissionResult", questions: [] }),
    )
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
  test("submits with the resolved exercise id and posts the reduced result", async () => {
    const grading = {
      status: "grading",
      grading: {
        grading_progress: "FullyGraded",
        score_given: 3,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: "2026-07-21T00:00:01Z",
        feedback_text: "All tests passed",
      },
    }
    const { actionContext, setPassed, submit } = moocContextWith(grading)

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.ok).toBe(true)

    // submit is called with the exercise id + path (the CLI resolves slide/task)
    expect(submit).toHaveBeenCalledWith(MOOC_EXERCISE_ID, "/path/to/exercise", expect.any(Function))
    // the reduced mooc result is posted to the panel
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult", result: grading }),
    )
    // a fully-graded, non-zero score marks the exercise passed
    expect(setPassed).toHaveBeenCalledWith("mooc", COURSE_SLUG, EXERCISE_SLUG)
    // The command layer refreshes this course's totals after a successful submit.
    expect(result.val).toEqual(CourseIdentifier.from(moocCourse.id))
  })

  test("a failed grading does not mark the exercise passed", async () => {
    const grading = {
      status: "grading",
      grading: {
        grading_progress: "Failed",
        score_given: 0,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_text: "Some tests failed",
      },
    }
    const { actionContext, setPassed } = moocContextWith(grading)

    await submitExercise(extensionContext, actionContext, moocExercise)
    expect(setPassed).not.toHaveBeenCalled()
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult", result: grading }),
    )
  })

  test("a pending-manual grading posts the result but does not mark passed", async () => {
    // PendingManual is terminal-for-student (awaiting a human): the reduced panel
    // renders it, but it is not a pass, so the exercise must NOT be marked passed
    // even though it carries a partial score.
    const grading = {
      status: "grading",
      grading: {
        grading_progress: "PendingManual",
        score_given: 0.5,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: null,
        feedback_text: "Awaiting manual grading",
      },
    }
    const { actionContext, setPassed } = moocContextWith(grading)

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.ok).toBe(true)
    expect(setPassed).not.toHaveBeenCalled()
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult", result: grading }),
    )
  })

  test("a timed-out (non-terminal) status posts the result without marking passed", async () => {
    // On timeout the blocking submit returns the latest non-terminal status as
    // data (not an error); the action must still post it to the panel (which
    // renders "grading still in progress") and must NOT mark the exercise passed.
    const grading = {
      status: "grading",
      grading: {
        grading_progress: "Pending",
        score_given: null,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_text: null,
      },
    }
    const { actionContext, setPassed } = moocContextWith(grading)

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.ok).toBe(true)
    expect(setPassed).not.toHaveBeenCalled()
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult", result: grading }),
    )
  })

  test("a second submit of the same exercise is rejected while one is in flight", async () => {
    // The guard lives in the action rather than `commands/submitExercise`, because
    // `TmcPanel` calls the paste actions -- which share this key -- directly. The
    // notification for the rejection is `withOperation`'s job now, not this action's:
    // showing it here too would double it once the command layer also reports it.
    let finishFirst!: () => void
    const submit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finishFirst = () => resolve(Ok({ status: "no-grading-yet" }))
      }),
    )
    const { actionContext } = contextFor(makeMoocKind(moocCourse), {
      submitMoocExerciseAndWaitForResults: submit,
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
    expect((await first).ok).toBe(true)

    // and the key is free again once the first submit finishes
    const third = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(third.ok).toBe(true)
  })

  test("a BottleneckError from the submission throttle reaches the panel", async () => {
    // The throttle surfaces as a BottleneckError. It is posted to the panel like any
    // other submission failure so the panel stops waiting; `withOperation`'s busy
    // handling is what shows it as information rather than an error dialog.
    const error = new BottleneckError("You are submitting too fast, try again later.")
    const { actionContext, setPassed } = moocContextWithErr(error)

    const result = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(setPassed).not.toHaveBeenCalled()
    expect(TmcPanel.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult" }),
    )
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "submissionStatusError",
        error: { message: "You are submitting too fast, try again later." },
      }),
    )
  })

  test("the failure survives the webview boundary with its message intact", async () => {
    // The panel reads `error.message`, and the webview bridge serializes the
    // message as JSON -- which drops a live Error's non-enumerable `message`.
    const { actionContext } = moocContextWithErr(new Error("Connection reset by peer"))

    await submitExercise(extensionContext, actionContext, moocExercise)

    const posted = vi
      .mocked(TmcPanel.postMessage)
      .mock.calls.flat()
      .find((message) => message.type === "submissionStatusError")
    expect(posted).toBeDefined()
    const delivered = JSON.parse(JSON.stringify(posted)) as { error: { message: string } }
    expect(delivered.error.message).toBe("Connection reset by peer")
  })
})

// These drive the action through the real `runForExercise`/`withOperation` boundary
// (bypassing only `commands/submitExercise`'s post-submit refresh) to prove the
// cross-layer contract: the busy notice is shown exactly once, and O2's rule -- a
// panel-shown failure toasts only when its presentation offers a remedy -- holds.
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
        finishFirst = () => resolve(Ok({ status: "no-grading-yet" }))
      }),
    )
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExerciseAndWaitForResults: submit },
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

  test("a plain submission failure shows in the panel only (O2)", async () => {
    const cause = new Error("Connection reset by peer")
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExerciseAndWaitForResults: vi.fn().mockResolvedValue(Err(cause)) },
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

    expect(result.err).toBe(true)
    expect(notification).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    expect(errorNotification).not.toHaveBeenCalled()
  })

  test("an insufficient-scope failure also shows a toast with its remedy (O2)", async () => {
    const cause = new InsufficientScopeError("exercise-services")
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExerciseAndWaitForResults: vi.fn().mockResolvedValue(Err(cause)) },
      moocExercise,
    )
    const reportError = vi.mocked(actionContext.dialog.reportError)

    await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      "Exercise submission failed.",
      cause,
      "mooc",
    )
  })
})

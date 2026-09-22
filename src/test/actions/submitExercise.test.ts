import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { submitExercise } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { BottleneckError } from "../../errors"
import type { LocalCourseData } from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"

// TmcPanel talks to the vscode webview API, so the whole module is mocked; the
// action only needs renderSide (a no-op), postMessage (asserted), and a defined
// sidePanel so the re-render branch is skipped.
vi.mock("../../panels/TmcPanel", () => ({
  nextPanelId: () => 1,
  TmcPanel: {
    renderSide: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn(),
    sidePanel: {},
  },
}))

// `submitExercise` ends by refreshing course points through
// `checkForCourseUpdates` -> `updateCourse`, which would otherwise drive real CLI
// calls. Stub the module so the refresh is observable without that machinery.
vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn().mockResolvedValue(Ok(true)),
}))

// The course-update pass ends by rescanning the exercises on disk, which would otherwise
// drive real CLI calls.
vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))

import { updateCourse } from "../../actions/updateCourse"
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
  actionContext: ActionContext
  setPassed: ReturnType<typeof vi.fn>
} {
  const setPassed = vi.fn().mockResolvedValue(Ok.EMPTY)
  const actionContext: ActionContext = {
    ...createMockActionContext(),
    langs: Ok(langsMethods) as unknown as ActionContext["langs"],
    userData: Ok({
      getCourseBySlug: () => Ok(course),
      getCourse: () => Ok(course),
      setExerciseAsPassed: setPassed,
    }) as unknown as ActionContext["userData"],
    exerciseDecorationProvider: Ok({
      updateDecorationsForExercises: vi.fn(),
    }) as unknown as ActionContext["exerciseDecorationProvider"],
  }
  return { actionContext, setPassed }
}

function moocContextWith(submitResult: unknown): {
  actionContext: ActionContext
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
  actionContext: ActionContext
  setPassed: ReturnType<typeof vi.fn>
} {
  return contextFor(makeMoocKind(moocCourse), {
    submitMoocExerciseAndWaitForResults: vi.fn().mockResolvedValue(Err(error)),
  })
}

function tmcContextWith(submitResult: unknown): {
  actionContext: ActionContext
  setPassed: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Ok(submitResult))
  const { actionContext, setPassed } = contextFor(makeTmcKind(tmcCourse), {
    submitTmcExerciseAndWaitForResults: submit,
  })
  return { actionContext, setPassed, submit }
}

afterEach(() => {
  vi.mocked(TmcPanel.postMessage).mockClear()
  vi.mocked(updateCourse).mockClear()
})

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
    expect(updateCourse).toHaveBeenCalledWith(
      actionContext,
      expect.objectContaining({ kind: "tmc" }),
    )
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
    // ...and the course is refreshed so the point totals shown in
    // CourseDetails/MyCourses reflect the submission, as the tmc path does.
    expect(updateCourse).toHaveBeenCalledWith(
      actionContext,
      expect.objectContaining({ kind: "mooc" }),
    )
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
    // `TmcPanel` calls the paste actions -- which share this key -- directly.
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
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )
    // the rejected call must not have reached the CLI
    expect(submit).toHaveBeenCalledTimes(1)

    finishFirst()
    expect((await first).ok).toBe(true)

    // and the key is free again once the first submit finishes
    const third = await submitExercise(extensionContext, actionContext, moocExercise)
    expect(third.ok).toBe(true)
  })

  test("a BottleneckError from the submission throttle reaches the panel", async () => {
    // The throttle surfaces as a BottleneckError. It is reported like any other
    // submission failure so the panel stops waiting; `commands/submitExercise`
    // is the one place that decides it warrants no error dialog.
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

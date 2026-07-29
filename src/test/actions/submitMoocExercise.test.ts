import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { submitMoocExercise } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { BottleneckError } from "../../errors"
import { makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"

// TmcPanel talks to the vscode webview API, so the whole module is mocked; the
// action only needs renderSide (a no-op), postMessage (asserted), and a defined
// sidePanel so the re-render branch is skipped.
vi.mock("../../panels/TmcPanel", () => ({
  randomPanelId: () => 1,
  TmcPanel: {
    renderSide: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn(),
    sidePanel: {},
  },
}))

// `submitMoocExercise` ends by refreshing course points through
// `checkForCourseUpdates` -> `updateCourse`, which would otherwise drive real CLI
// calls. Stub the module so the refresh is observable without that machinery.
vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn().mockResolvedValue(Ok(true)),
}))

import { updateCourse } from "../../actions/updateCourse"
import { TmcPanel } from "../../panels/TmcPanel"

const COURSE_SLUG = "mooc-python-course"
const EXERCISE_SLUG = "loops"
const EXERCISE_ID = "mooc-ex-1"

const moocCourse: MoocLocalCourseData = {
  id: "instance-uuid-1",
  name: COURSE_SLUG,
  title: "Mooc Python",
  description: null,
  organization: "mooc",
  exercises: [
    {
      id: EXERCISE_ID,
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

const workspaceExercise: WorkspaceExercise = {
  backend: "mooc",
  courseSlug: COURSE_SLUG,
  exerciseSlug: EXERCISE_SLUG,
  status: ExerciseStatus.Open,
  uri: { fsPath: "/path/to/exercise" } as unknown as vscode.Uri,
}

const extensionContext = { extensionUri: {} } as unknown as vscode.ExtensionContext

function contextWith(submitResult: unknown): {
  actionContext: ActionContext
  setPassed: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Ok(submitResult))
  const setPassed = vi.fn().mockResolvedValue(undefined)
  const actionContext: ActionContext = {
    ...createMockActionContext(),
    langs: Ok({
      submitMoocExerciseAndWaitForResults: submit,
    }) as unknown as ActionContext["langs"],
    userData: Ok({
      getCourseBySlug: () => makeMoocKind(moocCourse),
      getCourse: () => makeMoocKind(moocCourse),
      getMoocExerciseByName: () => moocCourse.exercises[0],
      setMoocExerciseAsPassed: setPassed,
    }) as unknown as ActionContext["userData"],
    exerciseDecorationProvider: Ok({
      updateDecorationsForExercises: vi.fn(),
    }) as unknown as ActionContext["exerciseDecorationProvider"],
  }
  return { actionContext, setPassed, submit }
}

// Like `contextWith`, but the blocking submit resolves to an `Err` (e.g. the
// submission-throttle BottleneckError or a submit failure).
function contextWithErr(error: Error): {
  actionContext: ActionContext
  setPassed: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Err(error))
  const setPassed = vi.fn().mockResolvedValue(undefined)
  const actionContext: ActionContext = {
    ...createMockActionContext(),
    langs: Ok({
      submitMoocExerciseAndWaitForResults: submit,
    }) as unknown as ActionContext["langs"],
    userData: Ok({
      getCourseBySlug: () => makeMoocKind(moocCourse),
      getCourse: () => makeMoocKind(moocCourse),
      getMoocExerciseByName: () => moocCourse.exercises[0],
      setMoocExerciseAsPassed: setPassed,
    }) as unknown as ActionContext["userData"],
    exerciseDecorationProvider: Ok({
      updateDecorationsForExercises: vi.fn(),
    }) as unknown as ActionContext["exerciseDecorationProvider"],
  }
  return { actionContext, setPassed }
}

afterEach(() => {
  vi.mocked(TmcPanel.postMessage).mockClear()
  vi.mocked(updateCourse).mockClear()
})

suite("submitMoocExercise action", () => {
  test("submits with the resolved exercise id and posts the reduced result", async () => {
    const grading = {
      Grading: {
        grading_progress: "FullyGraded",
        score_given: 3,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: "2026-07-21T00:00:01Z",
        feedback_json: null,
        feedback_text: "All tests passed",
      },
    }
    const { actionContext, setPassed, submit } = contextWith(grading)

    const result = await submitMoocExercise(extensionContext, actionContext, workspaceExercise)
    expect(result.ok).toBe(true)

    // submit is called with the exercise id + path (the CLI resolves slide/task)
    expect(submit).toHaveBeenCalledWith(EXERCISE_ID, "/path/to/exercise", expect.any(Function))
    // the reduced mooc result is posted to the panel
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult", result: grading }),
    )
    // a fully-graded, non-zero score marks the exercise passed
    expect(setPassed).toHaveBeenCalledWith(COURSE_SLUG, EXERCISE_SLUG)
    // ...and the course is refreshed so the point totals shown in
    // CourseDetails/MyCourses reflect the submission, as the tmc path does.
    expect(updateCourse).toHaveBeenCalledWith(
      actionContext,
      expect.objectContaining({ kind: "mooc" }),
    )
  })

  test("a failed grading does not mark the exercise passed", async () => {
    const grading = {
      Grading: {
        grading_progress: "Failed",
        score_given: 0,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: "Some tests failed",
      },
    }
    const { actionContext, setPassed } = contextWith(grading)

    await submitMoocExercise(extensionContext, actionContext, workspaceExercise)
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
      Grading: {
        grading_progress: "PendingManual",
        score_given: 0.5,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: "Awaiting manual grading",
      },
    }
    const { actionContext, setPassed } = contextWith(grading)

    const result = await submitMoocExercise(extensionContext, actionContext, workspaceExercise)
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
      Grading: {
        grading_progress: "Pending",
        score_given: null,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: null,
      },
    }
    const { actionContext, setPassed } = contextWith(grading)

    const result = await submitMoocExercise(extensionContext, actionContext, workspaceExercise)
    expect(result.ok).toBe(true)
    expect(setPassed).not.toHaveBeenCalled()
    expect(TmcPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult", result: grading }),
    )
  })

  test("a BottleneckError from the submission throttle returns Ok and posts no result", async () => {
    // The submission throttle surfaces as a BottleneckError; the action treats it
    // as a cancellation: it returns Ok and posts NEITHER a moocSubmissionResult
    // nor a submissionStatusError.
    const { actionContext, setPassed } = contextWithErr(
      new BottleneckError("You are submitting too fast, try again later."),
    )

    const result = await submitMoocExercise(extensionContext, actionContext, workspaceExercise)
    expect(result.ok).toBe(true)
    expect(setPassed).not.toHaveBeenCalled()
    expect(TmcPanel.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocSubmissionResult" }),
    )
    expect(TmcPanel.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "submissionStatusError" }),
    )
  })
})

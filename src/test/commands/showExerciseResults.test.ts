import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { makeTmcKind } from "../../../shared/lib"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { showExerciseResults } from "../../commands/showExerciseResults"
import type { UserData } from "../../config/userdata"
import { submissionViews } from "../../ui/submissionViews"
import { tmcCourseExercise, tmcLocalCourse } from "../fixtures/courses"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const exercise: WorkspaceExercise = {
  id: idOfTmcExercise(1),
  courseId: idOfTmcCourse(1),
  backend: "tmc",
  courseSlug: "python-course",
  exerciseSlug: "part01-01_hello",
  status: ExerciseStatus.Open,
  uri: vscode.Uri.file("/workspace/tmc/python-course/part01-01_hello"),
}

function contextWith(options: { isListed?: boolean; isPassed?: boolean } = {}) {
  const [dialog] = createDialogMock()
  const exerciseData = tmcCourseExercise({ id: 1, passed: options.isPassed ?? false })
  const course = tmcLocalCourse({
    exercises: options.isListed === false ? [] : [exerciseData],
  })
  const workspaceManager = {
    activeExercise: exercise,
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager
  const userData = {
    getExercise: () =>
      options.isListed === false
        ? Err(new Error("No stored exercise"))
        : Ok({ exercise: makeTmcKind(exerciseData), course }),
    getCourse: () => Ok(course),
  } as unknown as UserData
  return { ...createMockActionContext({ startup: { workspaceManager, userData } }), dialog }
}

suite("Show results command", function () {
  beforeEach(function () {
    submissionViews.clear()
    const reveal = vi.spyOn(submissionViews, "reveal")
    onTestFinished(() => reveal.mockRestore())
  })

  test("without a submission, opens a panel on where the exercise stands", async function () {
    await showExerciseResults(contextWith(), undefined)

    const [panel, section] = vi.mocked(submissionViews.reveal).mock.calls[0] ?? []
    expect(panel).toMatchObject({
      type: "ExerciseSubmission",
      exerciseId: exercise.id,
      backend: "tmc",
      exerciseName: "part01-01_hello",
      courseTitle: "Python Course",
    })
    expect(section).toBeUndefined()
    expect(submissionViews.latestView(panel!.id)).toMatchObject({
      phase: "standing",
      headline: "Not passed",
    })
  })

  test("reopens the latest submission of the exercise rather than a new panel", async function () {
    const submitted = {
      id: 77,
      type: "ExerciseSubmission",
      exerciseId: exercise.id,
      backend: "tmc",
      exerciseName: "part01-01_hello",
      courseTitle: "Python Course",
    } as const
    submissionViews.update({
      panel: submitted,
      view: {
        phase: "finished",
        headline: "Passed",
        tone: "passed",
        progressSteps: [],
        testCases: [],
        canKeepWaiting: false,
        canPaste: false,
      },
      shouldReopen: false,
    })

    await showExerciseResults(contextWith(), undefined, { name: "history", shouldPaste: false })

    expect(submissionViews.reveal).toHaveBeenCalledExactlyOnceWith(submitted, {
      name: "history",
      shouldPaste: false,
    })
  })

  test("says why when the course no longer lists the exercise", async function () {
    const context = contextWith({ isListed: false })

    await showExerciseResults(context, undefined)

    expect(context.dialog.errorNotification).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("was removed from the course"),
    )
    expect(submissionViews.reveal).not.toHaveBeenCalled()
  })

  test("without an exercise at hand says so", async function () {
    const context = contextWith()
    context.startup.workspaceManager = {
      activeExercise: undefined,
      getExerciseContaining: () => undefined,
    } as unknown as WorkspaceManager

    await showExerciseResults(context, undefined)

    expect(context.dialog.errorNotification).toHaveBeenCalledExactlyOnceWith(
      "Open a file of an exercise first.",
    )
  })
})

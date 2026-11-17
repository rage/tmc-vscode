import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { makeMoocKind, makeTmcKind } from "../../../shared/lib"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { showModelSolution } from "../../commands/showModelSolution"
import type { UserData } from "../../config/userdata"
import { openWebLink } from "../../utilities/webLink"
import {
  moocCourseExercise,
  moocLocalCourse,
  tmcCourseExercise,
  tmcLocalCourse,
} from "../fixtures/courses"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../utilities/webLink", () => ({
  openWebLink: vi.fn(async () => true),
}))

const exercise: WorkspaceExercise = {
  id: idOfMoocExercise("mooc-ex-uuid"),
  courseId: idOfMoocCourse("mooc-course-uuid"),
  backend: "mooc",
  courseSlug: "mooc-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri: vscode.Uri.file("/workspace/mooc/mooc-course/ex-1"),
}

function contextWith(hasModelSolution: boolean) {
  const [dialog] = createDialogMock()
  const workspaceManager = {
    activeExercise: exercise,
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager
  const stored = makeMoocKind(
    moocCourseExercise({
      id: "mooc-ex-uuid",
      passed: hasModelSolution,
      hasModelSolution,
      pageUrl: "https://courses.example/page",
    }),
  )
  const userData = {
    getExercise: () => Ok({ exercise: stored, course: moocLocalCourse() }),
  } as unknown as UserData
  return { ...createMockActionContext({ startup: { workspaceManager, userData } }), dialog }
}

suite("Show model solution command", function () {
  beforeEach(function () {
    vi.mocked(openWebLink).mockClear()
  })

  test("opens the material page of an exercise whose model solution was sent", async function () {
    await showModelSolution(contextWith(true), undefined)

    expect(openWebLink).toHaveBeenCalledExactlyOnceWith("https://courses.example/page")
  })

  test("says when there is no model solution to show yet", async function () {
    const context = contextWith(false)

    await showModelSolution(context, undefined)

    expect(openWebLink).not.toHaveBeenCalled()
    expect(context.dialog.notification).toHaveBeenCalledWith(
      "ex-1 has no model solution to show yet. If it has one, it shows once you pass the exercise " +
        "or run out of tries.",
    )
  })

  test("opens a passed tmc exercise's solution page", async function () {
    const context = contextWith(true)
    context.startup.userData = {
      getExercise: () =>
        Ok({
          exercise: makeTmcKind(tmcCourseExercise({ id: 41, passed: true })),
          course: tmcLocalCourse(),
        }),
    } as unknown as UserData

    await showModelSolution(context, undefined)

    expect(openWebLink).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/exercises\/41\/solution$/),
    )
  })
})

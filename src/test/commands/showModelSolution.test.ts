import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { makeMoocKind } from "../../../shared/lib"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { showModelSolution } from "../../commands/showModelSolution"
import type { UserData } from "../../config/userdata"
import { openWebLink } from "../../utilities/webLink"
import { moocCourseExercise } from "../fixtures/courses"
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

function contextWith(passed: boolean) {
  const [dialog] = createDialogMock()
  const workspaceManager = {
    activeExercise: exercise,
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager
  const stored = makeMoocKind(
    moocCourseExercise({ id: "mooc-ex-uuid", passed, pageUrl: "https://courses.example/page" }),
  )
  const userData = { getExercise: () => Ok({ exercise: stored }) } as unknown as UserData
  return { ...createMockActionContext({ startup: { workspaceManager, userData } }), dialog }
}

suite("Show model solution command", function () {
  beforeEach(function () {
    vi.mocked(openWebLink).mockClear()
  })

  test("opens the material page of a passed exercise", async function () {
    await showModelSolution(contextWith(true), undefined)

    expect(openWebLink).toHaveBeenCalledExactlyOnceWith("https://courses.example/page")
  })

  test("says when the model solution is not revealed yet", async function () {
    const context = contextWith(false)

    await showModelSolution(context, undefined)

    expect(openWebLink).not.toHaveBeenCalled()
    expect(context.dialog.notification).toHaveBeenCalledWith(
      "The model solution of ex-1 is shown once you pass it or run out of tries.",
    )
  })
})

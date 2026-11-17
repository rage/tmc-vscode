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

function moocContext() {
  const [dialog] = createDialogMock()
  const workspaceManager = {
    activeExercise: exercise,
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager
  const stored = makeMoocKind(
    moocCourseExercise({
      id: "mooc-ex-uuid",
      passed: true,
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

  test("points a mooc exercise to its course material", async function () {
    const context = moocContext()

    await showModelSolution(context, undefined)

    expect(openWebLink).not.toHaveBeenCalled()
    expect(context.dialog.notification).toHaveBeenCalledWith(
      "The model solution of ex-1 is in its course material once you may see it. " +
        "Use Open Course Material.",
    )
  })

  test("opens a passed tmc exercise's solution page", async function () {
    const context = moocContext()
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

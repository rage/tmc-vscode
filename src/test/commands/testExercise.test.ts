import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { testExercise } from "../../commands/testExercise"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  testExercise: vi.fn(async () => Ok.EMPTY),
}))

const uri = vscode.Uri.file("/workspace/tmc/python-course/ex-1")
const activeExercise: WorkspaceExercise = {
  backend: "tmc",
  courseSlug: "python-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri,
}
const pointedAtExercise: WorkspaceExercise = { ...activeExercise, exerciseSlug: "ex-2" }

// `testExercise` reads nothing off the extension context; it only hands it on.
const extensionContext = {} as vscode.ExtensionContext

function contextWith(
  resolved: { active?: WorkspaceExercise; containing?: WorkspaceExercise } = {},
): ReadyActionContext {
  const [dialog] = createDialogMock()
  const workspaceManager = {
    get activeExercise() {
      return resolved.active
    },
    getExerciseContaining: () => resolved.containing,
  } as unknown as WorkspaceManager
  return { ...createMockActionContext({ startup: { workspaceManager } }), dialog }
}

suite("Test exercise command", function () {
  beforeEach(function () {
    vi.mocked(actions.testExercise).mockClear()
    vi.mocked(actions.testExercise).mockResolvedValue(Ok.EMPTY)
  })

  test("runs the tests of the active exercise when no resource is given", async function () {
    const context = contextWith({ active: activeExercise, containing: pointedAtExercise })

    await testExercise(extensionContext, context, undefined)

    expect(actions.testExercise).toHaveBeenCalledExactlyOnceWith(
      extensionContext,
      context,
      activeExercise,
    )
  })

  test("runs the tests of the exercise the resource points at", async function () {
    const context = contextWith({ active: activeExercise, containing: pointedAtExercise })

    await testExercise(extensionContext, context, uri)

    expect(actions.testExercise).toHaveBeenCalledExactlyOnceWith(
      extensionContext,
      context,
      pointedAtExercise,
    )
  })

  test("reports a failed test run under its own headline", async function () {
    const cause = new Error("langs exited with 1")
    vi.mocked(actions.testExercise).mockResolvedValue(Err(cause))
    const context = contextWith({ active: activeExercise })

    await testExercise(extensionContext, context, undefined)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Exercise test run failed.",
      cause,
      "tmc",
    )
  })

  test("runs nothing when the resource is not part of an exercise", async function () {
    const context = contextWith()

    await testExercise(extensionContext, context, uri)

    expect(actions.testExercise).not.toHaveBeenCalled()
    expect(context.dialog.errorNotification).toHaveBeenCalledOnce()
  })
})

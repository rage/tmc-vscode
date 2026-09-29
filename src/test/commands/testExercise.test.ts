import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { testExercise } from "../../commands/testExercise"
import type { ExerciseTestController } from "../../testing/exerciseTestController"
import { setActiveTestController } from "../../testing/localTesting"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const uri = vscode.Uri.file("/workspace/tmc/python-course/ex-1")
const activeExercise: WorkspaceExercise = {
  backend: "tmc",
  courseSlug: "python-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri,
}
const pointedAtExercise: WorkspaceExercise = { ...activeExercise, exerciseSlug: "ex-2" }

// `testExercise` reads nothing off the extension context.
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
  const runExercise = vi.fn(async (): Promise<Result<void, Error>> => Ok.EMPTY)
  let registration: vscode.Disposable

  beforeEach(function () {
    runExercise.mockResolvedValue(Ok.EMPTY)
    registration = setActiveTestController({ runExercise } as unknown as ExerciseTestController)
  })

  afterEach(function () {
    registration.dispose()
  })

  test("runs the tests of the active exercise through the controller", async function () {
    const context = contextWith({ active: activeExercise, containing: pointedAtExercise })

    await testExercise(extensionContext, context, undefined)

    expect(runExercise).toHaveBeenCalledExactlyOnceWith(activeExercise)
  })

  test("runs the tests of the exercise the resource points at", async function () {
    const context = contextWith({ active: activeExercise, containing: pointedAtExercise })

    await testExercise(extensionContext, context, uri)

    expect(runExercise).toHaveBeenCalledExactlyOnceWith(pointedAtExercise)
  })

  test("reports a run the controller refused under its own headline", async function () {
    const cause = new Error("controller refused")
    runExercise.mockResolvedValue(Err(cause))
    const context = contextWith({ active: activeExercise })

    await testExercise(extensionContext, context, undefined)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Testing the exercise failed.",
      cause,
      "tmc",
    )
  })

  test("runs nothing when the resource is not part of an exercise", async function () {
    const context = contextWith()

    await testExercise(extensionContext, context, uri)

    expect(runExercise).not.toHaveBeenCalled()
    expect(context.dialog.errorNotification).toHaveBeenCalledOnce()
  })
})

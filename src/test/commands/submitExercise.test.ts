import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { submitExercise } from "../../commands/submitExercise"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  submitExercise: vi.fn(async () => Ok.EMPTY),
}))

const uri = vscode.Uri.file("/workspace/mooc/mooc-course/ex-1")
const exercise: WorkspaceExercise = {
  backend: "mooc",
  courseSlug: "mooc-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri,
}

// `submitExercise` reads nothing off the extension context; it only hands it on.
const extensionContext = {} as vscode.ExtensionContext

function contextWith(resolved: WorkspaceExercise | undefined): ReadyActionContext {
  const [dialog] = createDialogMock()
  const workspaceManager = {
    get activeExercise() {
      return resolved
    },
    getExerciseContaining: () => resolved,
  } as unknown as WorkspaceManager
  return { ...createMockActionContext({ startup: { workspaceManager } }), dialog }
}

suite("Submit exercise command", function () {
  beforeEach(function () {
    vi.mocked(actions.submitExercise).mockClear()
    vi.mocked(actions.submitExercise).mockResolvedValue(Ok.EMPTY)
  })

  test("submits the exercise the resource resolves to, and says it succeeded", async function () {
    const context = contextWith(exercise)

    const result = await submitExercise(extensionContext, context, uri)

    expect(actions.submitExercise).toHaveBeenCalledExactlyOnceWith(
      extensionContext,
      context,
      exercise,
    )
    expect(result.ok).toBe(true)
  })

  test("reports a failed submission under its own headline", async function () {
    const cause = new Error("langs exited with 1")
    vi.mocked(actions.submitExercise).mockResolvedValue(Err(cause))
    const context = contextWith(exercise)

    const result = await submitExercise(extensionContext, context, uri)

    expect(result.err).toBe(true)
    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Exercise submission failed.",
      cause,
      "mooc",
    )
  })

  test("submits nothing when the resource is not part of an exercise", async function () {
    const context = contextWith(undefined)

    const result = await submitExercise(extensionContext, context, uri)

    expect(actions.submitExercise).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(context.dialog.errorNotification).toHaveBeenCalledOnce()
  })
})

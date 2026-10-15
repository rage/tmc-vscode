import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { submitExercise } from "../../commands/submitExercise"
import { OutOfTriesError, WorkspaceUntrustedError } from "../../errors"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import { restrictedTrustGate } from "../support/trustGate"

vi.mock("../../actions", () => ({
  submitExercise: vi.fn(async () => Ok.EMPTY),
}))

const uri = vscode.Uri.file("/workspace/mooc/mooc-course/ex-1")
const exercise: WorkspaceExercise = {
  id: idOfMoocExercise("mooc-ex-uuid"),
  courseId: idOfMoocCourse("mooc-course-uuid"),
  backend: "mooc",
  courseSlug: "mooc-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri,
}

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
    vi.mocked(actions.submitExercise).mockResolvedValue(Ok({ warnings: [] }))
  })

  test("submits the exercise the resource resolves to, and says it succeeded", async function () {
    const context = contextWith(exercise)

    const result = await submitExercise(context, uri)

    expect(actions.submitExercise).toHaveBeenCalledExactlyOnceWith(context, exercise)
    expect(result.ok).toBe(true)
  })

  test("tells of no tries left as the final score it is, not as a failure", async function () {
    vi.mocked(actions.submitExercise).mockResolvedValue(
      Err(new OutOfTriesError("You have no tries left on ex-1, so its 2/3 points are final.")),
    )
    const context = contextWith(exercise)

    await submitExercise(context, uri)

    expect(context.dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "You have no tries left on ex-1, so its 2/3 points are final.",
    )
    expect(context.dialog.reportError).not.toHaveBeenCalled()
    expect(context.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("in Restricted Mode submits nothing, and submits once the workspace is trusted", async function () {
    const context = contextWith(exercise)
    const { trustGate, retries } = restrictedTrustGate()
    context.startup.trustGate = trustGate
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    const result = await submitExercise(context, uri)

    expect(result.val).toBeInstanceOf(WorkspaceUntrustedError)
    expect(actions.submitExercise).not.toHaveBeenCalled()
    retries.at(-1)?.()
    expect(executeCommand).toHaveBeenCalledWith("tmc.submitExercise", uri)
  })

  test("reports a failed submission under its own headline", async function () {
    const cause = new Error("langs exited with 1")
    vi.mocked(actions.submitExercise).mockResolvedValue(Err(cause))
    const context = contextWith(exercise)

    const result = await submitExercise(context, uri)

    expect(result.err).toBe(true)
    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Exercise submission failed.",
      cause,
    )
  })

  test("submits nothing when the resource is not part of an exercise", async function () {
    const context = contextWith(undefined)

    const result = await submitExercise(context, uri)

    expect(actions.submitExercise).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(context.dialog.errorNotification).toHaveBeenCalledOnce()
  })
})

import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { closeExercise } from "../../commands/closeExercise"
import type { UserData } from "../../config/userdata"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  closeExercises: vi.fn(async () => Ok([])),
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

interface Harness {
  context: ReadyActionContext
  confirmation: ReturnType<typeof vi.fn>
}

function harness(options: { passed?: boolean; confirmed?: boolean } = {}): Harness {
  const [dialog] = createDialogMock()
  const confirmation = vi.fn(async () => options.confirmed ?? true)
  dialog.confirm = confirmation

  const userData = { getPassed: () => options.passed ?? false } as unknown as UserData

  const workspaceManager = {
    get activeExercise() {
      return exercise
    },
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager

  return {
    context: {
      ...createMockActionContext({ startup: { userData, workspaceManager } }),
      dialog,
    },
    confirmation,
  }
}

suite("Close exercise command", function () {
  beforeEach(function () {
    vi.mocked(actions.closeExercises).mockClear()
    vi.mocked(actions.closeExercises).mockResolvedValue(Ok([]))
  })

  test("closes the exercise on disk by its id, in its course", async function () {
    const { context } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(actions.closeExercises).toHaveBeenCalledExactlyOnceWith(
      context,
      [exercise.id],
      exercise.courseId,
    )
  })

  test("closes a passed exercise without asking", async function () {
    const { context, confirmation } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(confirmation).not.toHaveBeenCalled()
    expect(actions.closeExercises).toHaveBeenCalledOnce()
  })

  test("asks before closing an unfinished exercise, and closes nothing when refused", async function () {
    const { context, confirmation } = harness({ passed: false, confirmed: false })

    await closeExercise(context, uri)

    expect(confirmation).toHaveBeenCalledOnce()
    expect(String(confirmation.mock.calls[0]?.[0])).toContain("ex-1")
    expect(actions.closeExercises).not.toHaveBeenCalled()
  })

  test("closes the editor once the exercise is closed", async function () {
    const { context } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.closeActiveEditor",
    )
  })

  test("reports a failed close and leaves the editor alone", async function () {
    vi.mocked(actions.closeExercises).mockResolvedValue(Err(new Error("exercise is running")))
    const { context } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Error when closing exercise.",
      expect.objectContaining({ message: "exercise is running" }),
    )
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  })
})

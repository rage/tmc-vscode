import { vi } from "vitest"
import * as vscode from "vscode"

import type { BackendKind } from "../../../shared/lib"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { pasteExercise } from "../../commands/pasteExercise"
import { showExerciseResults } from "../../commands/showExerciseResults"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import { restrictedTrustGate } from "../support/trustGate"

vi.mock("../../commands/showExerciseResults", () => ({ showExerciseResults: vi.fn() }))

function harness(backend: BackendKind, exercise?: WorkspaceExercise | null): ReadyActionContext {
  const shown =
    exercise === undefined
      ? {
          id: backend === "tmc" ? idOfTmcExercise(1) : idOfMoocExercise("mooc-ex-uuid"),
          courseId: backend === "tmc" ? idOfTmcCourse(1) : idOfMoocCourse("mooc-course-uuid"),
          backend,
          courseSlug: `${backend}-course`,
          exerciseSlug: "ex-1",
          status: ExerciseStatus.Open,
          uri: vscode.Uri.file(`/workspace/${backend}/course/ex-1`),
        }
      : (exercise ?? undefined)
  const workspaceManager = {
    get activeExercise() {
      return shown
    },
    getExerciseContaining: () => shown,
  } as unknown as WorkspaceManager
  return {
    ...createMockActionContext({ startup: { workspaceManager } }),
    dialog: createDialogMock()[0],
  }
}

suite("Paste exercise command", function () {
  test.each<BackendKind>(["tmc", "mooc"])(
    "opens Get help in the %s exercise's results, which pastes it there",
    async function (backend) {
      const context = harness(backend)

      await pasteExercise(context, undefined)

      expect(showExerciseResults).toHaveBeenCalledExactlyOnceWith(
        context,
        vscode.Uri.file(`/workspace/${backend}/course/ex-1`),
        { name: "getHelp", shouldPaste: true },
      )
      expect(context.dialog.notification).not.toHaveBeenCalled()
    },
  )

  test("without an exercise at hand says so and opens nothing", async function () {
    const context = harness("mooc", null)

    await pasteExercise(context, undefined)

    expect(context.dialog.errorNotification).toHaveBeenCalledExactlyOnceWith(
      "Open a file of an exercise first.",
    )
    expect(showExerciseResults).not.toHaveBeenCalled()
  })

  test("in Restricted Mode opens nothing, and once trusted asks before sharing", async function () {
    const context = harness("mooc")
    const { trustGate } = restrictedTrustGate()
    context.startup.trustGate = trustGate

    await pasteExercise(context, undefined)

    expect(showExerciseResults).not.toHaveBeenCalled()
    expect(vi.mocked(trustGate.refusal).mock.lastCall?.[1]).toMatchObject({ action: "Share" })
  })
})

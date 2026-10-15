import { vi } from "vitest"
import * as vscode from "vscode"

import { isUnchangedSinceSubmission } from "../../actions/submittedState"
import { confirmSubmitBeforeDestructiveAction } from "../../commands/confirmSubmitBeforeDestructiveAction"
import { idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/submittedState", () => ({
  isUnchangedSinceSubmission: vi.fn(async () => false),
}))

const exercise = { id: idOfTmcExercise(1), uri: vscode.Uri.file("/exercises/hello") }
const prompt = {
  message: "Reset hello?",
  replacement: "the exercise template",
  verb: "Reset",
  serverName: "courses.mooc.fi",
}

function context(): ReturnType<typeof createMockActionContext> {
  return { ...createMockActionContext(), dialog: createDialogMock()[0] }
}

suite("confirmSubmitBeforeDestructiveAction", function () {
  test("offers to submit first code that may not have been submitted", async function () {
    const actionContext = context()

    expect(await confirmSubmitBeforeDestructiveAction(actionContext, exercise, prompt)).toBe(true)
    expect(actionContext.dialog.choose).toHaveBeenCalledOnce()
  })

  test("asks only to go ahead when the code is what was last submitted", async function () {
    vi.mocked(isUnchangedSinceSubmission).mockResolvedValue(true)
    const actionContext = context()

    expect(await confirmSubmitBeforeDestructiveAction(actionContext, exercise, prompt)).toBe(false)
    expect(actionContext.dialog.choose).not.toHaveBeenCalled()
    expect(actionContext.dialog.confirm).toHaveBeenCalledExactlyOnceWith("Reset hello?", {
      confirmLabel: "Reset",
      detail:
        "Your current code, already submitted to courses.mooc.fi, will be replaced by the exercise template.",
    })

    vi.mocked(actionContext.dialog.confirm).mockResolvedValue(false)
    expect(
      await confirmSubmitBeforeDestructiveAction(actionContext, exercise, prompt),
    ).toBeUndefined()
  })
})

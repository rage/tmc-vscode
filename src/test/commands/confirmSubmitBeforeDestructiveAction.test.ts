import { vi } from "vitest"
import * as vscode from "vscode"

import { findKeptCopy } from "../../actions/keptCopies"
import { confirmSubmitBeforeDestructiveAction } from "../../commands/confirmSubmitBeforeDestructiveAction"
import { idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/keptCopies", () => ({
  findKeptCopy: vi.fn(async () => undefined),
}))

const exercise = { id: idOfTmcExercise(1), uri: vscode.Uri.file("/exercises/hello") }
const prompt = {
  message: "Reset hello?",
  replacement: "the exercise template",
  verb: "Reset",
  backend: "tmc" as const,
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

  test("offers a tmc exercise to submit first, and a mooc one to back up first", async function () {
    const actionContext = context()

    await confirmSubmitBeforeDestructiveAction(actionContext, exercise, prompt)
    await confirmSubmitBeforeDestructiveAction(actionContext, exercise, {
      ...prompt,
      backend: "mooc",
    })

    const choices = vi
      .mocked(actionContext.dialog.choose)
      .mock.calls.map(([, options, ...offered]) => [
        (options as { detail: string }).detail,
        offered.map(([label]) => label),
      ])
    expect(choices).toEqual([
      [
        "Your current code will be replaced by the exercise template. Submit it to tmc.mooc.fi first to keep a copy you can download later.",
        ["Submit and Reset", "Reset Without Submitting"],
      ],
      [
        "Your current code will be replaced by the exercise template. Back it up to courses.mooc.fi first to keep a copy you can download later. A backup is not graded, and courses.mooc.fi keeps your newest 20 backups of each exercise.",
        ["Back Up and Reset", "Reset Without Backup"],
      ],
    ])
  })

  test("asks only to go ahead when the code is what was last submitted", async function () {
    vi.mocked(findKeptCopy).mockResolvedValue("submission")
    const actionContext = context()

    expect(await confirmSubmitBeforeDestructiveAction(actionContext, exercise, prompt)).toBe(false)
    expect(actionContext.dialog.choose).not.toHaveBeenCalled()
    expect(actionContext.dialog.confirm).toHaveBeenCalledExactlyOnceWith("Reset hello?", {
      confirmLabel: "Reset",
      detail:
        "Your current code, already submitted to tmc.mooc.fi, will be replaced by the exercise template.",
    })

    vi.mocked(actionContext.dialog.confirm).mockResolvedValue(false)
    expect(
      await confirmSubmitBeforeDestructiveAction(actionContext, exercise, prompt),
    ).toBeUndefined()
  })

  test.each([
    [
      "backup",
      "Your current code, already backed up to courses.mooc.fi, will be replaced by the exercise template.",
    ],
    [
      "reset",
      "Your current code, unchanged since the exercise was reset, will be replaced by the exercise template.",
    ],
    [
      "download",
      "Your current code, unchanged since the exercise was downloaded, will be replaced by the exercise template.",
    ],
  ] as const)("offers no backup of code with a %s copy", async function (kept, detail) {
    vi.mocked(findKeptCopy).mockResolvedValue(kept)
    const actionContext = context()

    expect(
      await confirmSubmitBeforeDestructiveAction(actionContext, exercise, {
        ...prompt,
        backend: "mooc",
      }),
    ).toBe(false)
    expect(actionContext.dialog.choose).not.toHaveBeenCalled()
    expect(actionContext.dialog.confirm).toHaveBeenCalledExactlyOnceWith("Reset hello?", {
      confirmLabel: "Reset",
      detail,
    })
  })
})

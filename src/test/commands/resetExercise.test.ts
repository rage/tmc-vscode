import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext, ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { resetExercise } from "../../commands/resetExercise"
import type { UserData } from "../../config/userdata"
import { acquireSingleFlight, releaseSingleFlight } from "../../utilities"
import { createMockActionContext } from "../mocks/actionContext"

suite("Reset exercise command", function () {
  const uri = vscode.Uri.file("/workspace/mooc/course/ex-1")
  const exercise: WorkspaceExercise = {
    backend: "mooc",
    courseSlug: "mooc-course",
    exerciseSlug: "ex-1",
    status: ExerciseStatus.Open,
    uri,
  }

  let reset: ReturnType<typeof vi.fn>
  let notification: ReturnType<typeof vi.fn>
  let prompts: string[]

  /** @param answers labels to pick at each prompt; `undefined` dismisses it. */
  function actionContext(answers: (string | undefined)[]): ReadyActionContext {
    const base = createMockActionContext()
    reset = vi.fn(async () => Ok.EMPTY)
    notification = vi.fn()
    prompts = []
    let call = 0
    const dialog = {
      ...base.dialog,
      selectItem: vi.fn(async (prompt: { placeHolder: string }, ...items: [string, unknown][]) => {
        prompts.push(prompt.placeHolder)
        const wanted = answers[call++]
        return wanted === undefined ? undefined : items.find(([label]) => label === wanted)?.[1]
      }),
      notification,
    } as unknown as ActionContext["dialog"]

    return {
      ...base,
      dialog,
      startup: {
        ...base.startup,
        langs: { resetExercise: reset } as unknown as Langs,
        userData: {
          getMoocExerciseByName: () => ({ id: "mooc-ex-uuid" }),
        } as unknown as UserData,
        workspaceManager: {
          get activeExercise() {
            return exercise
          },
          getExerciseContaining: () => exercise,
        } as unknown as WorkspaceManager,
      },
    }
  }

  test("asks twice before discarding the current state", async function () {
    await resetExercise(actionContext(["Discard current state", "Yes, discard current state"]), uri)

    expect(prompts).toHaveLength(2)
    expect(reset).toHaveBeenCalledExactlyOnceWith(
      { kind: "mooc", data: { moocExerciseId: "mooc-ex-uuid" } },
      uri.fsPath,
      false,
    )
  })

  test("asks once when the current state is submitted first", async function () {
    await resetExercise(actionContext(["Submit to server"]), uri)

    expect(prompts).toHaveLength(1)
    expect(reset).toHaveBeenCalledExactlyOnceWith(expect.anything(), uri.fsPath, true)
  })

  test("resets nothing when the second question is dismissed", async function () {
    await resetExercise(actionContext(["Discard current state", undefined]), uri)

    expect(reset).not.toHaveBeenCalled()
  })

  test("refuses to reset while a submission of the same exercise is in flight", async function () {
    // The key the submit and paste actions hold; claiming it here stands in for one of them.
    const submitKey = `submit:${uri.fsPath}`
    expect(acquireSingleFlight(submitKey, 60_000)).toBe(true)
    try {
      await resetExercise(actionContext(["Submit to server"]), uri)
    } finally {
      releaseSingleFlight(submitKey)
    }

    expect(reset).not.toHaveBeenCalled()
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )
  })
})

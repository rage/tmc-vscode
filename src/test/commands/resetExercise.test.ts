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
  let prompts: { message: string; labels: string[] }[]

  /** @param answer The button to press in the confirmation; `undefined` cancels it. */
  function actionContext(answer: string | undefined): ReadyActionContext {
    const base = createMockActionContext()
    reset = vi.fn(async () => Ok.EMPTY)
    notification = vi.fn()
    prompts = []
    const dialog = {
      ...base.dialog,
      choose: vi.fn(async (message: string, _options: unknown, ...choices: [string, unknown][]) => {
        prompts.push({ message, labels: choices.map(([label]) => label) })
        return choices.find(([label]) => label === answer)?.[1]
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

  test("asks once, naming the exercise, whether to submit before resetting", async function () {
    await resetExercise(actionContext("Reset Without Submitting"), uri)

    expect(prompts).toEqual([
      { message: "Reset ex-1?", labels: ["Submit and Reset", "Reset Without Submitting"] },
    ])
    expect(reset).toHaveBeenCalledExactlyOnceWith(
      { kind: "mooc", data: { moocExerciseId: "mooc-ex-uuid" } },
      uri.fsPath,
      false,
    )
  })

  test("submits first when asked to", async function () {
    await resetExercise(actionContext("Submit and Reset"), uri)

    expect(reset).toHaveBeenCalledExactlyOnceWith(expect.anything(), uri.fsPath, true)
  })

  test("resets nothing when the confirmation is cancelled", async function () {
    await resetExercise(actionContext(undefined), uri)

    expect(reset).not.toHaveBeenCalled()
  })

  test("refuses to reset while a submission of the same exercise is in flight", async function () {
    // The key the submit and paste actions hold; claiming it here stands in for one of them.
    const submitKey = `submit:${uri.fsPath}`
    expect(acquireSingleFlight(submitKey, 60_000)).toBe(true)
    try {
      await resetExercise(actionContext("Submit and Reset"), uri)
    } finally {
      releaseSingleFlight(submitKey)
    }

    expect(reset).not.toHaveBeenCalled()
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )
  })
})

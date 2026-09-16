import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { resetExercise } from "../../commands/resetExercise"
import type { UserData } from "../../config/userdata"
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
  let prompts: string[]

  /** @param answers labels to pick at each prompt; `undefined` dismisses it. */
  function actionContext(answers: (string | undefined)[]): ActionContext {
    const base = createMockActionContext()
    reset = vi.fn(async () => Ok.EMPTY)
    prompts = []
    let call = 0
    const dialog = {
      ...base.dialog,
      selectItem: vi.fn(async (prompt: { placeHolder: string }, ...items: [string, unknown][]) => {
        prompts.push(prompt.placeHolder)
        const wanted = answers[call++]
        return wanted === undefined ? undefined : items.find(([label]) => label === wanted)?.[1]
      }),
    } as unknown as ActionContext["dialog"]

    return {
      ...base,
      dialog,
      langs: new Ok({ resetExercise: reset } as unknown as Langs),
      userData: new Ok({
        getMoocExerciseByName: () => ({ id: "mooc-ex-uuid" }),
      } as unknown as UserData),
      workspaceManager: new Ok({
        get activeExercise() {
          return exercise
        },
        getExerciseByPath: () => exercise,
      } as unknown as WorkspaceManager),
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
})

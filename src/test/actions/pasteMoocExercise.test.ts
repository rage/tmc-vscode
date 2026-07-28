import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { pasteMoocExercise } from "../../actions"
import type { ActionContext } from "../../actions/types"
import { createMockActionContext } from "../mocks/actionContext"

const COURSE_SLUG = "mooc-python-course"
const EXERCISE_SLUG = "loops"
const EXERCISE_ID = "mooc-ex-1"
const EXERCISE_PATH = "/path/to/exercise"

function contextWith(submitResult: unknown): {
  actionContext: ActionContext
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Ok(submitResult))
  const actionContext: ActionContext = {
    ...createMockActionContext(),
    langs: Ok({
      submitMoocExerciseToPaste: submit,
    }) as unknown as ActionContext["langs"],
    userData: Ok({
      getMoocExerciseByName: () => ({ id: EXERCISE_ID }),
    }) as unknown as ActionContext["userData"],
    workspaceManager: Ok({
      getExerciseBySlug: () => ({ uri: { fsPath: EXERCISE_PATH } as unknown as vscode.Uri }),
    }) as unknown as ActionContext["workspaceManager"],
  }
  return { actionContext, submit }
}

// Like `contextWith`, but the paste submission resolves to an `Err`.
function contextWithErr(error: Error): {
  actionContext: ActionContext
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Err(error))
  const actionContext: ActionContext = {
    ...createMockActionContext(),
    langs: Ok({
      submitMoocExerciseToPaste: submit,
    }) as unknown as ActionContext["langs"],
    userData: Ok({
      getMoocExerciseByName: () => ({ id: EXERCISE_ID }),
    }) as unknown as ActionContext["userData"],
    workspaceManager: Ok({
      getExerciseBySlug: () => ({ uri: { fsPath: EXERCISE_PATH } as unknown as vscode.Uri }),
    }) as unknown as ActionContext["workspaceManager"],
  }
  return { actionContext, submit }
}

suite("pasteMoocExercise action", () => {
  test("resolves the exercise id and path, and returns the paste link", async () => {
    const { actionContext, submit } = contextWith("https://paste.example/abc123")

    const result = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(submit).toHaveBeenCalledWith(EXERCISE_ID, EXERCISE_PATH)
    expect(result.ok).toBe(true)
    expect(result.val).toBe("https://paste.example/abc123")
  })

  test("on a CLI/backend error, shows an error notification and returns the error", async () => {
    const error = new Error("backend unreachable")
    const { actionContext } = contextWithErr(error)

    const result = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(actionContext.dialog.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send exercise to the courses.mooc.fi paste service"),
      error,
    )
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
  })

  test("an empty paste link from the server is its own error case", async () => {
    const { actionContext } = contextWith("")

    const result = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(Error)
    expect((result.val as Error).message).toContain("Didn't receive paste link from server.")
    // this failure path never has a "backend error" to show as a notification
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  })
})

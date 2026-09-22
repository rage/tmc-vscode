import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { failure, runForExercise } from "../../commands/runForExercise"
import { BottleneckError } from "../../errors"
import { createMockActionContext } from "../mocks/actionContext"

suite("Exercise command runner", function () {
  const uri = vscode.Uri.file("/workspace/mooc/course/ex-1")
  const exercise: WorkspaceExercise = {
    backend: "mooc",
    courseSlug: "mooc-course",
    exerciseSlug: "ex-1",
    status: ExerciseStatus.Open,
    uri,
  }

  let stubContext: ActionContext

  function actionContext(): ActionContext {
    return {
      ...stubContext,
      workspaceManager: new Ok({
        get activeExercise() {
          return exercise
        },
        getExerciseContaining: () => exercise,
      } as unknown as WorkspaceManager),
    }
  }

  beforeEach(function () {
    stubContext = createMockActionContext()
  })

  test("runs the body against the active exercise when no resource is given", async function () {
    const body = vi.fn(async () => Ok("done"))

    const result = await runForExercise(actionContext(), undefined, "Testing the exercise", body)

    expect(body).toHaveBeenCalledExactlyOnceWith(exercise)
    expect(result.val).toBe("done")
  })

  test("reports the missing target and skips the body when nothing resolves", async function () {
    const body = vi.fn(async () => Ok.EMPTY)
    const context = {
      ...stubContext,
      workspaceManager: new Ok({
        get activeExercise() {
          return undefined
        },
        getExerciseContaining: () => undefined,
      } as unknown as WorkspaceManager),
    }

    const result = await runForExercise(context, undefined, "Testing the exercise", body)

    expect(body).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(String(result.val)).toContain("not part of a course exercise")
    expect(stubContext.dialog.errorNotification).toHaveBeenCalledOnce()
  })

  test("leads with the sentence the body chose, keeping the cause as the detail", async function () {
    const cause = new Error("langs exited with 1")

    await runForExercise(actionContext(), uri, "Resetting the exercise", async () =>
      failure("Failed to reset exercise.", cause),
    )

    expect(stubContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to reset exercise.",
      cause,
      "mooc",
    )
  })

  test("names the operation when the failure carries no sentence of its own", async function () {
    const speechless = new Error("")

    await runForExercise(actionContext(), uri, "Resetting the exercise", async () =>
      Err(speechless),
    )

    expect(stubContext.dialog.errorNotification).toHaveBeenCalledExactlyOnceWith(
      "Resetting the exercise failed.",
      speechless,
    )
  })

  test("keeps a cancellation out of the user's way", async function () {
    await runForExercise(actionContext(), uri, "Submitting the exercise", async () =>
      Err(new BottleneckError("too soon")),
    )

    expect(stubContext.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("keeps a cancellation quiet even when the body gave it a headline", async function () {
    await runForExercise(actionContext(), uri, "Submitting the exercise", async () =>
      failure("Exercise submission failed.", new BottleneckError("too soon")),
    )

    expect(stubContext.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("does not resolve an exercise when the extension failed to initialize", async function () {
    const body = vi.fn(async () => Ok.EMPTY)
    const context = { ...stubContext, workspaceManager: Err(new Error("no workspace")) }

    const result = await runForExercise(context, uri, "Cleaning the exercise", body)

    expect(body).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(stubContext.dialog.errorNotification).not.toHaveBeenCalled()
  })
})

import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { runForExercise } from "../../commands/runForExercise"
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
        getExerciseByPath: () => exercise,
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
        getExerciseByPath: () => undefined,
      } as unknown as WorkspaceManager),
    }

    const result = await runForExercise(context, undefined, "Testing the exercise", body)

    expect(body).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(String(result.val)).toContain("not part of a course exercise")
    expect(stubContext.dialog.errorNotification).toHaveBeenCalledOnce()
  })

  test("names the operation when the body fails", async function () {
    const failure = new Error("boom")

    await runForExercise(actionContext(), uri, "Resetting the exercise", async () => Err(failure))

    expect(stubContext.dialog.errorNotification).toHaveBeenCalledExactlyOnceWith(
      "Resetting the exercise failed.",
      failure,
    )
  })

  test("keeps a cancellation out of the user's way", async function () {
    await runForExercise(actionContext(), uri, "Submitting the exercise", async () =>
      Err(new BottleneckError("too soon")),
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

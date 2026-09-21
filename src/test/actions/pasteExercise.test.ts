import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { pasteMoocExercise, pasteTmcExercise } from "../../actions"
import type { ActionContext } from "../../actions/types"
import { BottleneckError } from "../../errors"
import { createMockActionContext } from "../mocks/actionContext"

const COURSE_SLUG = "mooc-python-course"
const EXERCISE_SLUG = "loops"
const MOOC_EXERCISE_ID = "mooc-ex-1"
const TMC_EXERCISE_ID = 4321
const EXERCISE_PATH = "/path/to/exercise"

// `langsMethods` holds only the backend's own paste call, so an exercise routed through
// the other backend's method fails instead of quietly passing.
function contextFor(
  langsMethods: Record<string, unknown>,
  userDataMethods: Record<string, unknown>,
): ActionContext {
  return {
    ...createMockActionContext(),
    langs: Ok(langsMethods) as unknown as ActionContext["langs"],
    userData: Ok(userDataMethods) as unknown as ActionContext["userData"],
    workspaceManager: Ok({
      getExerciseBySlug: () => ({ uri: { fsPath: EXERCISE_PATH } as unknown as vscode.Uri }),
    }) as unknown as ActionContext["workspaceManager"],
  }
}

function moocContextWith(pasteResult: unknown): {
  actionContext: ActionContext
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(pasteResult)
  const actionContext = contextFor(
    { submitMoocExerciseToPaste: submit },
    { getMoocExerciseByName: () => ({ id: MOOC_EXERCISE_ID }) },
  )
  return { actionContext, submit }
}

function tmcContextWith(pasteResult: unknown): {
  actionContext: ActionContext
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(pasteResult)
  const actionContext = contextFor(
    { submitTmcExerciseToPaste: submit },
    { getTmcExerciseByName: () => ({ id: TMC_EXERCISE_ID }) },
  )
  return { actionContext, submit }
}

suite("paste actions", () => {
  test("a tmc exercise goes to the tmc paste service with its numeric id", async () => {
    const { actionContext, submit } = tmcContextWith(Ok("https://tmc.mooc.fi/paste/abc123"))

    const result = await pasteTmcExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(submit).toHaveBeenCalledWith(TMC_EXERCISE_ID, EXERCISE_PATH)
    expect(result.val).toBe("https://tmc.mooc.fi/paste/abc123")
  })

  test("a mooc exercise goes to the mooc paste service with its uuid", async () => {
    const { actionContext, submit } = moocContextWith(Ok("https://paste.example/abc123"))

    const result = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(submit).toHaveBeenCalledWith(MOOC_EXERCISE_ID, EXERCISE_PATH)
    expect(result.ok).toBe(true)
    expect(result.val).toBe("https://paste.example/abc123")
  })

  test("a paste is rejected while a submit of the same exercise is in flight", async () => {
    // Paste and submit deliberately share one key: both drive the CLI against the
    // same exercise directory, so they must not overlap.
    let finish!: () => void
    const { actionContext } = moocContextWith(undefined)
    ;(actionContext.langs.val as unknown as Record<string, unknown>).submitMoocExerciseToPaste = vi
      .fn()
      .mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve(Ok("link"))
        }),
      )
    const notification = vi.mocked(actionContext.dialog.notification)

    const first = pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)
    const second = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(second.err).toBe(true)
    expect(second.val).toBeInstanceOf(BottleneckError)
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )

    finish()
    expect((await first).val).toBe("link")
  })

  test("a CLI or backend failure is returned unreported", async () => {
    // Both callers report it themselves, in the place the user asked from; a
    // notification here would make every failed paste two of them.
    const error = new Error("backend unreachable")
    const { actionContext } = moocContextWith(Err(error))

    const result = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("an empty paste link from the server is its own error case", async () => {
    const { actionContext } = moocContextWith(Ok(""))

    const result = await pasteMoocExercise(actionContext, COURSE_SLUG, EXERCISE_SLUG)

    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain("did not answer with a paste link")
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  })
})

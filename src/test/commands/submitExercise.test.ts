import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { makeMoocKind } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { submitExercise } from "../../commands/submitExercise"
import type { UserData } from "../../config/userdata"
import {
  AiUseRefusedError,
  DeadlinePassedError,
  OutOfTriesError,
  WorkspaceUntrustedError,
} from "../../errors"
import { moocCourseExercise } from "../fixtures/courses"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import { restrictedTrustGate } from "../support/trustGate"

vi.mock("../../actions", () => ({
  checkCanSubmit: vi.fn(async () => Ok.EMPTY),
  submitExercise: vi.fn(async () => Ok.EMPTY),
}))

const uri = vscode.Uri.file("/workspace/mooc/mooc-course/ex-1")
const exercise: WorkspaceExercise = {
  id: idOfMoocExercise("mooc-ex-uuid"),
  courseId: idOfMoocCourse("mooc-course-uuid"),
  backend: "mooc",
  courseSlug: "mooc-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri,
}

function contextWith(
  resolved: WorkspaceExercise | undefined,
  triesLeft?: number,
): ReadyActionContext {
  const [dialog] = createDialogMock()
  const workspaceManager = {
    get activeExercise() {
      return resolved
    },
    getExerciseContaining: () => resolved,
  } as unknown as WorkspaceManager
  const stored = makeMoocKind(
    moocCourseExercise({ id: "mooc-ex-uuid", name: "ex-1", maxTries: 3, triesLeft }),
  )
  const userData = {
    getExercise: () =>
      triesLeft === undefined ? Err(new Error("none")) : Ok({ exercise: stored }),
  } as unknown as UserData
  return { ...createMockActionContext({ startup: { workspaceManager, userData } }), dialog }
}

suite("Submit exercise command", function () {
  beforeEach(function () {
    vi.mocked(actions.checkCanSubmit).mockResolvedValue(Ok.EMPTY)
    vi.mocked(actions.submitExercise).mockResolvedValue(Ok({ warnings: [] }))
  })

  test("submits the exercise the resource resolves to, and says it succeeded", async function () {
    const context = contextWith(exercise)

    const result = await submitExercise(context, uri)

    expect(actions.submitExercise).toHaveBeenCalledExactlyOnceWith(context, exercise)
    expect(result.ok).toBe(true)
  })

  test("asks before the last try, and submits nothing when declined", async function () {
    const context = contextWith(exercise, 1)
    vi.mocked(context.dialog.confirm).mockResolvedValue(false)

    const result = await submitExercise(context, uri)

    expect(result.ok).toBe(true)
    expect(context.dialog.confirm).toHaveBeenCalledWith(
      "This is your last try on ex-1. Submit?",
      expect.objectContaining({ confirmLabel: "Submit" }),
    )
    expect(actions.submitExercise).not.toHaveBeenCalled()
  })

  test("submits on the last try once the student agrees, and does not ask with more left", async function () {
    const lastTry = contextWith(exercise, 1)
    await submitExercise(lastTry, uri)
    expect(actions.submitExercise).toHaveBeenCalledExactlyOnceWith(lastTry, exercise)

    const moreLeft = contextWith(exercise, 2)
    await submitExercise(moreLeft, uri)
    expect(moreLeft.dialog.confirm).not.toHaveBeenCalled()
  })

  test("refuses for AI assistance before asking about the last try", async function () {
    const refused = new AiUseRefusedError("Turn off AI assistance before you submit.")
    vi.mocked(actions.checkCanSubmit).mockResolvedValue(Err(refused))
    const context = contextWith(exercise, 1)

    const result = await submitExercise(context, uri)

    expect(context.dialog.confirm).not.toHaveBeenCalled()
    expect(actions.submitExercise).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(context.dialog.warningNotification).toHaveBeenCalledWith(refused.message)
  })

  test("tells of a passed deadline before asking about the last try", async function () {
    vi.mocked(actions.checkCanSubmit).mockResolvedValue(
      Err(new DeadlinePassedError("The deadline of ex-1 has passed.")),
    )
    const context = contextWith(exercise, 1)

    const result = await submitExercise(context, uri)

    expect(result.ok).toBe(true)
    expect(context.dialog.confirm).not.toHaveBeenCalled()
    expect(actions.submitExercise).not.toHaveBeenCalled()
    expect(context.dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "The deadline of ex-1 has passed.",
    )
  })

  test("tells of no tries left as the final score it is, not as a failure", async function () {
    vi.mocked(actions.submitExercise).mockResolvedValue(
      Err(new OutOfTriesError("You have no tries left on ex-1, so its 2/3 points are final.")),
    )
    const context = contextWith(exercise)

    await submitExercise(context, uri)

    expect(context.dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "You have no tries left on ex-1, so its 2/3 points are final.",
    )
    expect(context.dialog.reportError).not.toHaveBeenCalled()
    expect(context.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("in Restricted Mode submits nothing, and once trusted asks before submitting", async function () {
    const context = contextWith(exercise)
    const { trustGate, retries } = restrictedTrustGate()
    context.startup.trustGate = trustGate
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    const result = await submitExercise(context, uri)

    expect(result.val).toBeInstanceOf(WorkspaceUntrustedError)
    expect(actions.submitExercise).not.toHaveBeenCalled()
    expect(vi.mocked(trustGate.refusal).mock.lastCall?.[1]).toEqual({
      message: "The course workspace is trusted now. Submit ex-1?",
      action: "Submit",
    })
    retries.at(-1)?.()
    expect(executeCommand).toHaveBeenCalledWith("tmc.submitExercise", uri)
  })

  test("reports a failed submission under its own headline", async function () {
    const cause = new Error("langs exited with 1")
    vi.mocked(actions.submitExercise).mockResolvedValue(Err(cause))
    const context = contextWith(exercise)

    const result = await submitExercise(context, uri)

    expect(result.err).toBe(true)
    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Exercise submission failed.",
      cause,
    )
  })

  test("submits nothing when the resource is not part of an exercise", async function () {
    const context = contextWith(undefined)

    const result = await submitExercise(context, uri)

    expect(actions.submitExercise).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
    expect(context.dialog.errorNotification).toHaveBeenCalledOnce()
  })
})

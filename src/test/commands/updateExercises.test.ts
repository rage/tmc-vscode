import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { ExerciseUpdateCheck } from "../../actions/checkForExerciseUpdates"
import type { ReadyActionContext } from "../../actions/types"
import { updateExercises } from "../../commands/updateExercises"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier as ExerciseIdentifierNs,
} from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const checkForExerciseUpdates = vi.hoisted(() => vi.fn())
const downloadExerciseUpdates = vi.hoisted(() => vi.fn())

vi.mock("../../actions/checkForExerciseUpdates", () => ({ checkForExerciseUpdates }))
vi.mock("../../actions/downloadExerciseUpdates", () => ({ downloadExerciseUpdates }))

/** An outdated exercise as `checkForExerciseUpdates` reports it: a fresh id object per exercise. */
function outdated(
  courseId: number,
  exerciseId: number,
): {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
  exerciseName: string
} {
  return {
    courseId: CourseIdentifierNs.from(courseId),
    exerciseId: ExerciseIdentifierNs.from(exerciseId),
    exerciseName: `exercise-${exerciseId}`,
  }
}

/** A check that reached every backend. */
function checked(exercises: ExerciseUpdateCheck["outdated"]): ExerciseUpdateCheck {
  return { outdated: exercises, failures: [] }
}

function contextWith(
  automaticallyUpdate: boolean,
): [ReadyActionContext, ReturnType<typeof createDialogMock>[0], ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const setNewExerciseNotifyAfter = vi.fn(async () => Ok.EMPTY)
  return [
    {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourse: () => Ok({ data: { notifyAfter: 0, disabled: false } }),
            setNewExerciseNotifyAfter,
          } as unknown as UserData,
        },
      }),
      dialog,
      settings: {
        getAutomaticallyUpdateExercises: () => automaticallyUpdate,
      } as unknown as Settings,
    },
    dialog,
    setNewExerciseNotifyAfter,
  ]
}

suite("updateExercises command", function () {
  beforeEach(function () {
    checkForExerciseUpdates.mockReset()
    downloadExerciseUpdates.mockReset()
  })

  test("postpones the reminder once per course, not once per exercise", async function () {
    checkForExerciseUpdates.mockResolvedValue(
      checked([outdated(1, 10), outdated(1, 11), outdated(2, 20)]),
    )
    const [actionContext, dialog, setNewExerciseNotifyAfter] = contextWith(false)

    await updateExercises(actionContext, "loud")

    const remindMeLater = vi.mocked(dialog.notification).mock.calls[0]?.[2]
    remindMeLater?.[1]()

    await vi.waitFor(() => expect(setNewExerciseNotifyAfter).toHaveBeenCalledTimes(2))
    expect(
      setNewExerciseNotifyAfter.mock.calls.map(([id]) =>
        CourseIdentifierNs.toString(id as CourseIdentifier),
      ),
    ).toEqual(["1", "2"])
  })

  test("downloads the updates without asking when automatic updates are on", async function () {
    const updates = [outdated(1, 10), outdated(2, 20)]
    checkForExerciseUpdates.mockResolvedValue(checked(updates))
    const [actionContext, dialog] = contextWith(true)

    await updateExercises(actionContext, "loud")

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("downloads the updates the user accepts", async function () {
    const updates = [outdated(1, 10)]
    checkForExerciseUpdates.mockResolvedValue(checked(updates))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "loud")
    expect(downloadExerciseUpdates).not.toHaveBeenCalled()
    const download = vi.mocked(dialog.notification).mock.calls[0]?.[1]
    download?.[1]()

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates)
  })

  test("reports a failed check once when loud, and only logs it when silent", async function () {
    checkForExerciseUpdates.mockRejectedValue(new Error("offline"))
    const [loudContext, loudDialog] = contextWith(false)
    const [silentContext, silentDialog] = contextWith(false)

    await updateExercises(loudContext, "loud")
    await updateExercises(silentContext, "silent")

    expect(loudDialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to check for exercise updates.",
      expect.objectContaining({ message: "offline" }),
      undefined,
    )
    expect(silentDialog.reportError).not.toHaveBeenCalled()
    expect(silentDialog.notification).not.toHaveBeenCalled()
  })

  test("reports a backend it could not check when loud, instead of the all-clear", async function () {
    const error = new Error("offline")
    checkForExerciseUpdates.mockResolvedValue({
      outdated: [],
      failures: [{ backend: "mooc", error }],
    })
    const [loudContext, loudDialog] = contextWith(false)
    const [silentContext, silentDialog] = contextWith(false)

    await updateExercises(loudContext, "loud")
    await updateExercises(silentContext, "silent")

    expect(loudDialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to check for exercise updates.",
      error,
      "mooc",
    )
    expect(loudDialog.notification).not.toHaveBeenCalled()
    expect(silentDialog.reportError).not.toHaveBeenCalled()
  })

  test("still offers the updates in a silent run, but not the all-clear", async function () {
    checkForExerciseUpdates.mockResolvedValueOnce(checked([outdated(1, 10)]))
    checkForExerciseUpdates.mockResolvedValueOnce(checked([]))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "silent")
    await updateExercises(actionContext, "silent")

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "Found updates for 1 exercises. Do you wish to download them?",
      expect.anything(),
      expect.anything(),
    )
  })

  test("reports a reminder that could not be postponed once", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10), outdated(2, 20)]))
    const [actionContext, dialog, setNewExerciseNotifyAfter] = contextWith(false)
    setNewExerciseNotifyAfter.mockResolvedValue(Err(new Error("storage full")))

    await updateExercises(actionContext, "silent")
    vi.mocked(dialog.notification).mock.calls[0]?.[2]?.[1]()

    await vi.waitFor(() =>
      expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
        "Failed to postpone the reminder.",
        expect.objectContaining({ message: "storage full" }),
        undefined,
      ),
    )
    expect(setNewExerciseNotifyAfter).toHaveBeenCalledTimes(1)
  })
})

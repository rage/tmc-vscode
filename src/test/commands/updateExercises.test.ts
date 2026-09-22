import { Ok } from "ts-results"
import { vi } from "vitest"

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

vi.mock("../../actions", () => ({
  checkForExerciseUpdates,
  downloadExerciseUpdates,
}))

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
      Ok([outdated(1, 10), outdated(1, 11), outdated(2, 20)]),
    )
    const [actionContext, dialog, setNewExerciseNotifyAfter] = contextWith(false)

    await updateExercises(actionContext, "loud")

    const remindMeLater = vi.mocked(dialog.notification).mock.calls[0]?.[2]
    await remindMeLater?.[1]()

    expect(setNewExerciseNotifyAfter).toHaveBeenCalledTimes(2)
    expect(
      setNewExerciseNotifyAfter.mock.calls.map(([id]) =>
        CourseIdentifierNs.toString(id as CourseIdentifier),
      ),
    ).toEqual(["1", "2"])
  })

  test("downloads the updates without asking when automatic updates are on", async function () {
    const updates = [outdated(1, 10), outdated(2, 20)]
    checkForExerciseUpdates.mockResolvedValue(Ok(updates))
    const [actionContext, dialog] = contextWith(true)

    await updateExercises(actionContext, "loud")

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("downloads the updates the user accepts", async function () {
    const updates = [outdated(1, 10)]
    checkForExerciseUpdates.mockResolvedValue(Ok(updates))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "loud")
    expect(downloadExerciseUpdates).not.toHaveBeenCalled()
    const download = vi.mocked(dialog.notification).mock.calls[0]?.[1]
    await download?.[1]()

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates)
  })
})

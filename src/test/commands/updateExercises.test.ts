import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ActionContext } from "../../actions/types"
import { updateExercises } from "../../commands/updateExercises"
import type Settings from "../../config/settings"
import { postUpdateables } from "../../panels/updateablesRegistry"
import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier as ExerciseIdentifierNs,
} from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const checkForExerciseUpdates = vi.hoisted(() => vi.fn())

vi.mock("../../actions", () => ({
  checkForExerciseUpdates,
  downloadOrUpdateExercises: vi.fn(),
}))

vi.mock("../../panels/updateablesRegistry", () => ({
  postUpdateables: vi.fn(),
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
): [ActionContext, ReturnType<typeof createDialogMock>[0], ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const setNewExerciseNotifyAfter = vi.fn(async () => Ok.EMPTY)
  return [
    {
      ...createMockActionContext(),
      dialog,
      settings: {
        getAutomaticallyUpdateExercises: () => automaticallyUpdate,
      } as unknown as Settings,
      userData: Ok({
        getCourse: () => Ok({ data: { notifyAfter: 0, disabled: false } }),
        setNewExerciseNotifyAfter,
      }) as unknown as ActionContext["userData"],
    },
    dialog,
    setNewExerciseNotifyAfter,
  ]
}

suite("updateExercises command", function () {
  beforeEach(function () {
    vi.mocked(postUpdateables).mockClear()
    checkForExerciseUpdates.mockReset()
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
})

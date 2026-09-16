import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { ActionContext } from "../../actions/types"
import { updateExercises } from "../../commands/updateExercises"
import type Settings from "../../config/settings"
import { postUpdateables } from "../../panels/exerciseLists"
import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier as ExerciseIdentifierNs,
} from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const checkForExerciseUpdates = vi.hoisted(() => vi.fn())
const downloadOrUpdateExercises = vi.hoisted(() => vi.fn())

vi.mock("../../actions", () => ({
  checkForExerciseUpdates,
  downloadOrUpdateExercises,
}))

// Only the post is stubbed; `withOptimisticList` is the behaviour under test.
vi.mock("../../panels/exerciseLists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../panels/exerciseLists")>()),
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
    downloadOrUpdateExercises.mockReset()
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

  test("puts the updateable exercises back when the download fails", async function () {
    checkForExerciseUpdates.mockResolvedValue(Ok([outdated(1, 10), outdated(1, 11)]))
    downloadOrUpdateExercises.mockResolvedValue(Err(new Error("download failed")))
    const [actionContext, dialog] = contextWith(true)

    await updateExercises(actionContext, "loud")

    const postedLists = vi
      .mocked(postUpdateables)
      .mock.calls.map(([, exerciseIds]) => exerciseIds.map((x) => ExerciseIdentifierNs.unwrap(x)))
    expect(postedLists).toEqual([[], [10, 11]])
    expect(dialog.errorNotification).toHaveBeenCalled()
  })

  test("puts the updateable exercises back when the download throws", async function () {
    checkForExerciseUpdates.mockResolvedValue(Ok([outdated(1, 10), outdated(1, 11)]))
    downloadOrUpdateExercises.mockRejectedValue(new Error("spawn failed"))
    const [actionContext] = contextWith(true)

    await expect(updateExercises(actionContext, "loud")).rejects.toThrow("spawn failed")

    const postedLists = vi
      .mocked(postUpdateables)
      .mock.calls.map(([, exerciseIds]) => exerciseIds.map((x) => ExerciseIdentifierNs.unwrap(x)))
    expect(postedLists).toEqual([[], [10, 11]])
  })

  test("reports only the exercises that failed when the download succeeds", async function () {
    checkForExerciseUpdates.mockResolvedValue(Ok([outdated(1, 10), outdated(1, 11)]))
    downloadOrUpdateExercises.mockResolvedValue(
      Ok({ successful: [], failed: [ExerciseIdentifierNs.from(11)] }),
    )
    const [actionContext] = contextWith(true)

    await updateExercises(actionContext, "loud")

    const postedLists = vi
      .mocked(postUpdateables)
      .mock.calls.map(([, exerciseIds]) => exerciseIds.map((x) => ExerciseIdentifierNs.unwrap(x)))
    expect(postedLists).toEqual([[], [11]])
  })
})

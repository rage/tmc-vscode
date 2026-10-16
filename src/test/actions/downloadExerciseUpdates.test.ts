import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { CourseIdentifier, ExerciseIdentifier } from "../../../shared/lib"
import { downloadExerciseUpdates } from "../../actions/downloadExerciseUpdates"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import { ConnectionError, InvalidTokenError } from "../../errors"
import { failedUpdates } from "../../ui/failedUpdates"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createUserDataMock } from "../mocks/userdata"

/** A context whose stored courses hold no exercise, so each is named by its id. */
function contextNamingById(): ReturnType<typeof createMockActionContext> {
  return createMockActionContext({ startup: { userData: createUserDataMock()[0] } })
}

const downloadOrUpdateExercises = vi.hoisted(() => vi.fn())

vi.mock("../../actions/downloadOrUpdateExercises", () => ({ downloadOrUpdateExercises }))
vi.mock("../../actions/refreshLocalExercises", () => ({ refreshLocalExercises: vi.fn() }))

vi.mock("../../ui/updateablesRegistry", () => ({ updateablesRegistry: { setMany: vi.fn() } }))
vi.mock("../../ui/failedUpdates", () => ({ failedUpdates: { record: vi.fn() } }))

/** A fresh id object per exercise, as `checkForExerciseUpdates` reports them. */
function update(
  courseId: number,
  exerciseId: number,
): { courseId: CourseIdentifier; exerciseId: ExerciseIdentifier } {
  return {
    courseId: idOfTmcCourse(courseId),
    exerciseId: idOfTmcExercise(exerciseId),
  }
}

function postedLists(): [string, number[]][] {
  return vi
    .mocked(updateablesRegistry.setMany)
    .mock.calls.flatMap(([lists]) =>
      Array.from(lists, ([courseId, exerciseIds]): [string, number[]] => [
        CourseIdentifier.toString(courseId),
        exerciseIds.map((x) => Number(ExerciseIdentifier.toString(x))),
      ]),
    )
}

suite("downloadExerciseUpdates action", function () {
  beforeEach(function () {
    downloadOrUpdateExercises.mockReset()
    vi.mocked(updateablesRegistry.setMany).mockClear()
    vi.mocked(refreshLocalExercises).mockReset().mockResolvedValue(Ok.EMPTY)
    vi.mocked(failedUpdates.record).mockClear()
  })

  test("puts the updateable exercises back when the download throws", async function () {
    downloadOrUpdateExercises.mockRejectedValue(new Error("spawn failed"))

    await expect(
      downloadExerciseUpdates(createMockActionContext(), [update(1, 10), update(1, 11)]),
    ).rejects.toThrow("spawn failed")

    expect(postedLists()).toEqual([
      ["1", []],
      ["1", [10, 11]],
    ])
  })

  test("leaves each course only its own failed exercises", async function () {
    downloadOrUpdateExercises.mockResolvedValue(
      Ok({ successful: [idOfTmcExercise(10)], failed: [idOfTmcExercise(20)], warnings: [] }),
    )

    await downloadExerciseUpdates(contextNamingById(), [update(1, 10), update(2, 20)])

    expect(postedLists()).toEqual([
      ["1", []],
      ["2", []],
      ["1", []],
      ["2", [20]],
    ])
  })

  test("keeps the whole list when another download of the exercises is running", async function () {
    downloadOrUpdateExercises.mockResolvedValue(Err(new Error("busy")))

    const result = await downloadExerciseUpdates(createMockActionContext(), [update(1, 10)])

    expect(result.err).toBe(true)
    expect(postedLists()).toEqual([
      ["1", []],
      ["1", [10]],
    ])
    expect(refreshLocalExercises).not.toHaveBeenCalled()
  })

  test("rescans the exercises it replaced, reporting a rescan that fails", async function () {
    downloadOrUpdateExercises.mockResolvedValue(Ok({ successful: [], failed: [], warnings: [] }))
    vi.mocked(refreshLocalExercises).mockResolvedValue(Err(new Error("refresh failed")))
    const actionContext = createMockActionContext()

    const result = await downloadExerciseUpdates(actionContext, [update(1, 10)])

    expect(refreshLocalExercises).toHaveBeenCalledOnce()
    expect(result.unwrap().warnings).toEqual([
      { headline: "Failed to refresh local exercises.", error: expect.any(Error) },
    ])
  })

  test("remembers the failed exercises with their cause, and forgets the updated ones", async function () {
    const connection = new ConnectionError("connect ECONNREFUSED")
    connection.backend = "mooc"
    downloadOrUpdateExercises.mockResolvedValue(
      Ok({
        successful: [idOfTmcExercise(10)],
        failed: [idOfTmcExercise(20)],
        failureCause: connection,
        warnings: [],
      }),
    )

    await downloadExerciseUpdates(contextNamingById(), [update(1, 10), update(2, 20)], true)

    expect(failedUpdates.record).toHaveBeenCalledExactlyOnceWith(
      [
        {
          courseId: idOfTmcCourse(2),
          exerciseId: idOfTmcExercise(20),
          exerciseName: "20",
          reason: "courses.mooc.fi could not be reached. Check your network connection.",
        },
      ],
      [idOfTmcExercise(10)],
    )
  })

  test("hands a lost session met by an automatic update to the warning about it", async function () {
    const lost = new InvalidTokenError("401")
    downloadOrUpdateExercises.mockResolvedValue(
      Ok({ successful: [], failed: [idOfTmcExercise(10)], failureCause: lost, warnings: [] }),
    )

    const result = await downloadExerciseUpdates(contextNamingById(), [update(1, 10)], true)

    expect(result.unwrap().warnings).toEqual([
      { headline: "Failed to update exercises.", error: lost },
    ])
  })
})

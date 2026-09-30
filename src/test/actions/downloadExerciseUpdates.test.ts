import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadExerciseUpdates } from "../../actions/downloadExerciseUpdates"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { createMockActionContext } from "../mocks/actionContext"

const downloadOrUpdateExercises = vi.hoisted(() => vi.fn())

vi.mock("../../actions/downloadOrUpdateExercises", () => ({ downloadOrUpdateExercises }))
vi.mock("../../actions/refreshLocalExercises", () => ({ refreshLocalExercises: vi.fn() }))

vi.mock("../../ui/updateablesRegistry", () => ({ updateablesRegistry: { setMany: vi.fn() } }))

/** A fresh id object per exercise, as `checkForExerciseUpdates` reports them. */
function update(
  courseId: number,
  exerciseId: number,
): { courseId: CourseIdentifier; exerciseId: ExerciseIdentifier } {
  return {
    courseId: CourseIdentifier.from(courseId),
    exerciseId: ExerciseIdentifier.from(exerciseId),
  }
}

function postedLists(): [string, number[]][] {
  return vi
    .mocked(updateablesRegistry.setMany)
    .mock.calls.flatMap(([lists]) =>
      Array.from(lists, ([courseId, exerciseIds]): [string, number[]] => [
        CourseIdentifier.toString(courseId),
        exerciseIds.map((x) => ExerciseIdentifier.unwrap(x) as number),
      ]),
    )
}

suite("downloadExerciseUpdates action", function () {
  beforeEach(function () {
    downloadOrUpdateExercises.mockReset()
    vi.mocked(updateablesRegistry.setMany).mockClear()
    vi.mocked(refreshLocalExercises).mockReset().mockResolvedValue(Ok.EMPTY)
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
      Ok({ successful: [ExerciseIdentifier.from(10)], failed: [ExerciseIdentifier.from(20)] }),
    )

    await downloadExerciseUpdates(createMockActionContext(), [update(1, 10), update(2, 20)])

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
    downloadOrUpdateExercises.mockResolvedValue(Ok({ successful: [], failed: [] }))
    vi.mocked(refreshLocalExercises).mockResolvedValue(Err(new Error("refresh failed")))
    const actionContext = createMockActionContext()

    await downloadExerciseUpdates(actionContext, [update(1, 10)])

    expect(refreshLocalExercises).toHaveBeenCalledOnce()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      "Failed to refresh local exercises.",
      expect.any(Error),
      "tmc",
    )
  })
})

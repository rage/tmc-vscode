import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadExerciseUpdates } from "../../actions/downloadExerciseUpdates"
import { postUpdateables } from "../../panels/exerciseLists"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const downloadOrUpdateExercises = vi.hoisted(() => vi.fn())

vi.mock("../../actions/downloadOrUpdateExercises", () => ({ downloadOrUpdateExercises }))

// Only the post is stubbed; `withOptimisticList` is part of the behaviour under test.
vi.mock("../../panels/exerciseLists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../panels/exerciseLists")>()),
  postUpdateables: vi.fn(),
}))

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
    .mocked(postUpdateables)
    .mock.calls.map(([courseId, exerciseIds]) => [
      CourseIdentifier.toString(courseId),
      exerciseIds.map((x) => ExerciseIdentifier.unwrap(x) as number),
    ])
}

suite("downloadExerciseUpdates action", function () {
  beforeEach(function () {
    vi.mocked(postUpdateables).mockClear()
    downloadOrUpdateExercises.mockReset()
  })

  test("puts the updateable exercises back when the download fails", async function () {
    downloadOrUpdateExercises.mockResolvedValue(Err(new Error("download failed")))
    const [dialog] = createDialogMock()
    const context = { ...createMockActionContext(), dialog }

    await downloadExerciseUpdates(context, [update(1, 10), update(1, 11)])

    expect(postedLists()).toEqual([
      ["1", []],
      ["1", [10, 11]],
    ])
    expect(dialog.reportError).toHaveBeenCalledWith(
      "Failed to update exercises.",
      expect.any(Error),
    )
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
})

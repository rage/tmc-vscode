import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import { refreshCourses, refreshEverything } from "../../commands/refreshEverything"
import { updateExercises } from "../../commands/updateExercises"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn(async () => Ok(true)),
}))

// The course-update pass ends by rescanning the exercises on disk, which would otherwise
// drive real CLI calls.
vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))

vi.mock("../../commands/updateExercises", () => ({
  updateExercises: vi.fn(async () => undefined),
}))

const tmcCourse = (id: number, notifyAfter: number, newExercises: number[]): LocalCourseData =>
  makeTmcKind({
    id,
    name: `course-${id}`,
    title: `Course ${id}`,
    description: "",
    organization: "test",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises,
    notifyAfter,
    disabled: false,
    materialUrl: null,
  })

function contextWithCourses(courses: LocalCourseData[]): [ReadyActionContext, Dialog] {
  const [dialog] = createDialogMock()
  const byId = new Map(courses.map((c) => [String(c.data.id), c]))
  return [
    {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourses: () => courses,
            getCourse: (id: CourseIdentifier) => Ok(byId.get(CourseIdentifier.toString(id))),
          } as unknown as ReadyStartup["userData"],
        },
      }),
      dialog,
    },
    dialog,
  ]
}

suite("refreshEverything command", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok(true))
    vi.mocked(updateExercises).mockReset()
    vi.mocked(updateExercises).mockResolvedValue(undefined)
  })

  test("refreshes course data before checking for exercise updates", async function () {
    const order: string[] = []
    vi.mocked(updateCourse).mockImplementation(async () => {
      order.push("updateCourse")
      return Ok(true)
    })
    vi.mocked(updateExercises).mockImplementation(async () => {
      order.push("updateExercises")
    })
    const [actionContext] = contextWithCourses([tmcCourse(1, 0, [])])

    const result = await refreshEverything(actionContext, { silent: true })

    expect(result.ok).toBe(true)
    expect(order).toEqual(["updateCourse", "updateExercises"])
    expect(updateExercises).toHaveBeenCalledWith(actionContext, "silent")
  })

  test("rejects a second refresh started while one is still running", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementation(async () => {
      await blocked
      return Ok(true)
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    const first = refreshEverything(actionContext, { silent: false })
    const second = await refreshEverything(actionContext, { silent: false })

    expect(second.err).toBe(true)
    expect(dialog.notification).toHaveBeenCalledWith(expect.stringContaining("already in progress"))
    release()
    expect((await first).ok).toBe(true)
    expect(updateCourse).toHaveBeenCalledTimes(1)
  })

  test("says nothing when a silent refresh is the one rejected", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementation(async () => {
      await blocked
      return Ok(true)
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    const first = refreshEverything(actionContext, { silent: true })
    const second = await refreshEverything(actionContext, { silent: true })

    expect(second.err).toBe(true)
    expect(dialog.notification).not.toHaveBeenCalled()
    release()
    await first
  })
})

suite("refreshCourses command", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok(true))
    vi.mocked(updateExercises).mockReset()
    vi.mocked(updateExercises).mockResolvedValue(undefined)
  })

  // The task closes over `progress`, so a fake `dialog.progressNotification` has to run it
  // itself to reach the `onProgress` callback that actually feeds the notification.
  test("reports the fraction of exercises checked so far", async function () {
    const report = vi.fn()
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, []), tmcCourse(2, 0, [])])
    const progressNotification = dialog.progressNotification as unknown as {
      mockImplementation: (
        impl: (
          message: string,
          task: (progress: { report: typeof report }) => Promise<unknown>,
        ) => Promise<unknown>,
      ) => void
    }
    progressNotification.mockImplementation(async (_message, task) => task({ report }))

    await refreshCourses(actionContext)

    expect(dialog.progressNotification).toHaveBeenCalledWith(
      "Fetching course updates...",
      expect.any(Function),
    )
    expect(updateCourse).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledWith({ fraction: 0.5 })
    expect(report).toHaveBeenCalledWith({ fraction: 1 })

    // Guards the `total === 0` branch separately: with no courses to refresh,
    // `done / total` would divide by zero and leave the progress bar showing `NaN`.
    const emptyReport = vi.fn()
    const [emptyContext, emptyDialog] = contextWithCourses([])
    const emptyProgressNotification = emptyDialog.progressNotification as unknown as {
      mockImplementation: (
        impl: (
          message: string,
          task: (progress: { report: typeof emptyReport }) => Promise<unknown>,
        ) => Promise<unknown>,
      ) => void
    }
    emptyProgressNotification.mockImplementation(async (_message, task) =>
      task({ report: emptyReport }),
    )

    await refreshCourses(emptyContext)

    expect(emptyReport).toHaveBeenCalledWith({ fraction: 1 })
  })
})

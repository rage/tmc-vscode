import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadNewExercisesForCourse } from "../../actions/downloadNewExercisesForCourse"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import { refreshCourses, refreshEverything } from "../../commands/refreshEverything"
import { updateExercises } from "../../commands/updateExercises"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { Logger } from "../../utilities"
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

vi.mock("../../actions/downloadNewExercisesForCourse", () => ({
  downloadNewExercisesForCourse: vi.fn(async () => Ok.EMPTY),
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
            setNewExerciseNotifyAfter: vi.fn(async () => Ok.EMPTY),
            clearFromNewExercises: vi.fn(async () => Ok.EMPTY),
          } as unknown as ReadyStartup["userData"],
        },
      }),
      dialog,
    },
    dialog,
  ]
}

/** Failed-refresh headlines logged rather than shown. */
const headlineLogs = (): unknown[][] =>
  vi.mocked(Logger.warn).mock.calls.filter(([m]) => m === "Failed to check for course updates.")

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
    release()

    expect(second.err).toBe(true)
    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith("A refresh is already in progress.")
    expect(dialog.reportError).not.toHaveBeenCalled()
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
    release()
    await first

    expect(second.err).toBe(true)
    expect(dialog.notification).not.toHaveBeenCalled()
  })
})

suite("refreshEverything reporting", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Err(new Error("connection lost")))
    vi.mocked(updateExercises).mockReset()
    vi.mocked(updateExercises).mockResolvedValue(undefined)
  })

  test("a background refresh that fails shows nothing and logs once", async function () {
    vi.spyOn(Logger, "warn")
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    const result = await refreshEverything(actionContext, { silent: true })

    expect(result.err).toBe(true)
    expect(dialog.reportError).not.toHaveBeenCalled()
    expect(dialog.errorNotification).not.toHaveBeenCalled()
    expect(dialog.notification).not.toHaveBeenCalled()
    expect(headlineLogs()).toHaveLength(1)
  })

  test("a refresh the user asked for that fails notifies once", async function () {
    vi.spyOn(Logger, "warn")
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    await refreshEverything(actionContext, { silent: false })

    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to check for course updates.",
      expect.objectContaining({ message: expect.stringContaining("course-1") }),
      undefined,
    )
    expect(headlineLogs()).toHaveLength(0)
  })

  test("a silent refresh still shows the warning an operation raised", async function () {
    vi.mocked(updateCourse).mockImplementation(async (context) => {
      void context.dialog.reportError("Failed to update course data.", new Error("scope"))
      return Ok(false)
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to update course data.",
      expect.objectContaining({ message: "scope" }),
    )
  })
})

suite("refreshEverything's new-exercises prompt", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok(true))
    vi.mocked(updateExercises).mockReset()
    vi.mocked(updateExercises).mockResolvedValue(undefined)
    vi.mocked(downloadNewExercisesForCourse).mockReset()
    vi.mocked(downloadNewExercisesForCourse).mockResolvedValue(Ok.EMPTY)
  })

  type Button = [string, () => void]
  const buttons = (dialog: Dialog): Button[] =>
    (vi.mocked(dialog.notification).mock.calls[0]?.slice(1) ?? []) as Button[]
  const press = (dialog: Dialog, label: string): void =>
    buttons(dialog).find(([l]) => l === label)?.[1]()

  test("offers a course's new exercises once its reminder is due, even when silent", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "Found 1 new exercises for course-1. Do you wish to download them now?",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
    expect(buttons(dialog).map(([label]) => label)).toEqual([
      "Download",
      "Remind me later",
      "Don't remind about these exercises",
    ])
  })

  test("does not offer the exercises of a course whose reminder is postponed", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, Date.now() + 60_000, [10])])

    await refreshEverything(actionContext, { silent: false })

    expect(updateCourse).toHaveBeenCalledTimes(1)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("downloads the course's new exercises from the Download button", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    await refreshEverything(actionContext, { silent: true })

    press(dialog, "Download")

    await vi.waitFor(() =>
      expect(downloadNewExercisesForCourse).toHaveBeenCalledExactlyOnceWith(
        actionContext,
        CourseIdentifier.from(1),
      ),
    )
    expect(dialog.reportError).not.toHaveBeenCalled()
  })

  test("reports a failed download from the Download button once", async function () {
    vi.mocked(downloadNewExercisesForCourse).mockResolvedValue(Err(new Error("disk full")))
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    await refreshEverything(actionContext, { silent: true })

    press(dialog, "Download")

    await vi.waitFor(() =>
      expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
        "Failed to download new exercises for the course.",
        expect.objectContaining({ message: "disk full" }),
        "tmc",
      ),
    )
  })

  test("postpones or dismisses the reminder from the other two buttons", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    const { userData } = actionContext.startup
    await refreshEverything(actionContext, { silent: true })

    press(dialog, "Remind me later")
    press(dialog, "Don't remind about these exercises")

    await vi.waitFor(() => {
      expect(userData.setNewExerciseNotifyAfter).toHaveBeenCalledExactlyOnceWith(
        CourseIdentifier.from(1),
        expect.any(Number),
      )
      expect(userData.clearFromNewExercises).toHaveBeenCalledExactlyOnceWith(
        CourseIdentifier.from(1),
      )
    })
  })

  test("reports a reminder that could not be postponed once", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    vi.mocked(actionContext.startup.userData.setNewExerciseNotifyAfter).mockResolvedValue(
      Err(new Error("storage full")),
    )
    await refreshEverything(actionContext, { silent: true })

    press(dialog, "Remind me later")

    await vi.waitFor(() =>
      expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
        "Failed to postpone the reminder.",
        expect.objectContaining({ message: "storage full" }),
        "tmc",
      ),
    )
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

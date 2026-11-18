import { Err, Ok } from "ts-results"
import { onTestFinished, vi } from "vitest"

import { CourseIdentifier, LocalCourseData } from "../../../shared/lib"
import { downloadNewExercisesForCourse } from "../../actions/downloadNewExercisesForCourse"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import { downloadNewExercises } from "../../commands/downloadNewExercises"
import { refreshCourses, refreshEverything } from "../../commands/refreshEverything"
import { updateExercises } from "../../commands/updateExercises"
import { NEW_EXERCISES_REMINDER_DELAY } from "../../config/constants"
import type { NewExerciseHandling } from "../../config/settings"
import { BottleneckError } from "../../errors"
import { recentPolicyChanges } from "../../ui/recentPolicyChanges"
import type { CourseHomeFailure } from "../../ui/shownCourseHome"
import { shownCourseHome } from "../../ui/shownCourseHome"
import { Logger } from "../../utilities"
import { moocLocalCourse, tmcLocalCourse } from "../fixtures/courses"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import { createSettingsMock } from "../mocks/settings"

vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn(async () => Ok({ isUpdated: true, warnings: [] })),
  fetchMoocEnrollments: vi.fn(async () => Ok(new Set())),
}))

// The course-update pass ends by rescanning the exercises on disk, which would otherwise
// drive real CLI calls.
vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))

vi.mock("../../commands/updateExercises", () => ({
  updateExercises: vi.fn(async () => undefined),
}))

vi.mock("../../actions/downloadNewExercisesForCourse", () => ({
  downloadNewExercisesForCourse: vi.fn(async () => Ok({ downloaded: [], warnings: [] })),
}))

vi.mock("../../commands/downloadNewExercises", () => ({
  downloadNewExercises: vi.fn(async () => undefined),
}))

const tmcCourse = (id: number, notifyAfter: number, newExercises: number[]): LocalCourseData =>
  tmcLocalCourse({
    id,
    name: `course-${id}`,
    title: `Course ${id}`,
    organization: "test",
    newExercises,
    notifyAfter,
  })

function contextWithCourses(
  courses: LocalCourseData[],
  newExercises: NewExerciseHandling = "ask",
): [ReadyActionContext, Dialog] {
  const [dialog] = createDialogMock()
  const [settings, settingValues] = createSettingsMock()
  settingValues.newExercises = newExercises
  const byId = new Map(courses.map((c) => [String(c.data.id), c]))
  return [
    {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourses: () => courses,
            getCourse: (id: CourseIdentifier) => Ok(byId.get(CourseIdentifier.toString(id))),
            setNewExerciseNotifyAfter: vi.fn(async () => Ok.EMPTY),
            setNewExercisesOffered: vi.fn(async (id: CourseIdentifier) => {
              const course = byId.get(CourseIdentifier.toString(id))
              if (course) {
                course.data.offeredNewExercises = [...course.data.newExercises] as never
              }
              return Ok.EMPTY
            }),
            postponeNewExercises: vi.fn(async () => Ok.EMPTY),
            clearFromNewExercises: vi.fn(async () => Ok.EMPTY),
          } as unknown as ReadyStartup["userData"],
        },
      }),
      dialog,
      settings,
    },
    dialog,
  ]
}

/** Failed-refresh headlines logged rather than shown. */
const headlineLogs = (): unknown[][] =>
  vi.mocked(Logger.warn).mock.calls.filter(([m]) => m === "Failed to fetch updates for course-1.")

suite("refreshEverything command", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok({ isUpdated: true, warnings: [] }))
    vi.mocked(updateExercises).mockReset()
    vi.mocked(updateExercises).mockResolvedValue(undefined)
  })

  test("refreshes course data before checking for exercise updates", async function () {
    const order: string[] = []
    vi.mocked(updateCourse).mockImplementation(async () => {
      order.push("updateCourse")
      return Ok({ isUpdated: true, warnings: [] })
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
      return Ok({ isUpdated: true, warnings: [] })
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

  test("runs refreshes queued while one is running once, after it", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementationOnce(async () => {
      await blocked
      return Ok({ isUpdated: true, warnings: [] })
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])
    const queuedOptions = {
      silent: true,
      isQueuedWhenBusy: true,
      courseId: idOfTmcCourse(1),
    }

    const first = refreshEverything(actionContext, { silent: true })
    const queued = await Promise.all([
      refreshEverything(actionContext, queuedOptions),
      refreshEverything(actionContext, queuedOptions),
    ])
    expect(queued.every((result) => result.ok)).toBe(true)
    release()
    await first

    await vi.waitFor(() => expect(updateExercises).toHaveBeenCalledTimes(2))
    expect(updateCourse).toHaveBeenCalledTimes(2)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("says nothing when a silent refresh is the one rejected", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementation(async () => {
      await blocked
      return Ok({ isUpdated: true, warnings: [] })
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
      "Failed to fetch updates for course-1.",
      expect.objectContaining({ message: "connection lost" }),
    )
    expect(headlineLogs()).toHaveLength(0)
  })

  test("a silent refresh still shows the warning an operation raised", async function () {
    vi.mocked(updateCourse).mockImplementation(async (context) => {
      void context.dialog.reportError("Failed to update course data.", new Error("scope"))
      return Ok({ isUpdated: false, warnings: [] })
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
    vi.mocked(updateCourse).mockResolvedValue(Ok({ isUpdated: true, warnings: [] }))
    vi.mocked(updateExercises).mockReset()
    vi.mocked(updateExercises).mockResolvedValue(undefined)
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
      "1 new exercise in Course 1.",
      expect.anything(),
      expect.anything(),
    )
    expect(buttons(dialog).map(([label]) => label)).toEqual(["Download", "Later"])
  })

  test("announces a changed AI policy, and what it does to AI assistance", async function () {
    const course = moocLocalCourse({ title: "Mooc Course", aiPolicy: "full_use" })
    const [actionContext, dialog] = contextWithCourses([course])
    vi.mocked(updateCourse).mockResolvedValue(
      Ok({ isUpdated: true, warnings: [], aiPolicyChange: { course } }),
    )

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "Mooc Course changed its AI policy: AI may be used freely, with disclosure." +
        " AI assistance is on in this course.",
      expect.anything(),
    )
  })

  test("announces a changed AI policy that leaves AI assistance as it was in the same words", async function () {
    const course = moocLocalCourse({ title: "Mooc Course", aiPolicy: "no_ai" })
    const [actionContext, dialog] = contextWithCourses([course])
    vi.mocked(updateCourse).mockResolvedValue(
      Ok({ isUpdated: true, warnings: [], aiPolicyChange: { course } }),
    )

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "Mooc Course changed its AI policy: AI may not be used at any point." +
        " AI assistance is off in this course.",
      expect.anything(),
    )
  })

  test("notes a changed AI policy in the course home on screen, with no notification", async function () {
    const course = moocLocalCourse({ title: "Mooc Course", aiPolicy: "no_ai" })
    const courseId = LocalCourseData.getCourseId(course)
    const [actionContext, dialog] = contextWithCourses([course])
    vi.mocked(updateCourse).mockResolvedValue(
      Ok({ isUpdated: true, warnings: [], aiPolicyChange: { course } }),
    )
    shownCourseHome.set(courseId)
    onTestFinished(() => {
      shownCourseHome.set(undefined)
      recentPolicyChanges.dismiss(courseId)
    })

    await refreshEverything(actionContext, { silent: true })

    expect(recentPolicyChanges.get(course)).toBe(
      "AI may not be used at any point. AI assistance is off in this course.",
    )
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("shows a session warning in the course home on screen instead of notifying it", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])
    const refusal = new Error("Your courses.mooc.fi session no longer grants access.")
    vi.mocked(updateCourse).mockResolvedValue(
      Ok({
        isUpdated: true,
        warnings: [{ headline: "Failed to update course data.", error: refusal }],
      }),
    )
    shownCourseHome.set(idOfTmcCourse(1))
    const shown: CourseHomeFailure[] = []
    const subscription = shownCourseHome.onDidFail((failure) => shown.push(failure))
    onTestFinished(() => {
      shownCourseHome.set(undefined)
      subscription.dispose()
    })

    await refreshEverything(actionContext, { silent: true })

    expect(shown).toEqual([
      {
        courseId: idOfTmcCourse(1),
        headline: "Failed to update course data.",
        error: refusal,
        tone: "error",
      },
    ])
    expect(dialog.reportError).not.toHaveBeenCalled()
  })

  test("Download downloads the course's new exercises", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    await refreshEverything(actionContext, { silent: true })

    press(dialog, "Download")

    expect(downloadNewExercises).toHaveBeenCalledExactlyOnceWith(actionContext, idOfTmcCourse(1))
  })

  test("Later offers the new exercises again after the reminder delay", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    await refreshEverything(actionContext, { silent: true })
    const before = Date.now()

    press(dialog, "Later")

    const [courseId, notifyAfter] =
      vi.mocked(actionContext.startup.userData.postponeNewExercises).mock.calls[0] ?? []
    expect(courseId).toEqual(idOfTmcCourse(1))
    expect(notifyAfter).toBeGreaterThanOrEqual(before + NEW_EXERCISES_REMINDER_DELAY)
  })

  test("offers nothing about a course that is disabled, not enrolled on or out of reach", async function () {
    const disabled = tmcLocalCourse({ id: 1, newExercises: [10], disabled: true })
    const notEnrolled = moocLocalCourse({ id: "a", newExercises: ["e1"], notEnrolled: true })
    const lost = moocLocalCourse({
      id: "b",
      newExercises: ["e2"],
      accessLoss: { reason: "forbidden", checkedAt: 0 },
    })
    const [actionContext, dialog] = contextWithCourses([disabled, notEnrolled, lost])

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("offers nothing when new exercises are only for the course home", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])], "courseHome")

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.notification).not.toHaveBeenCalled()
    expect(downloadNewExercisesForCourse).not.toHaveBeenCalled()
  })

  test("downloads new exercises when set to, then says how many it downloaded", async function () {
    vi.mocked(downloadNewExercisesForCourse).mockResolvedValueOnce(
      Ok({ downloaded: [idOfTmcExercise(10), idOfTmcExercise(11)], warnings: [] }),
    )
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10, 11])], "download")

    await refreshEverything(actionContext, { silent: true })

    await vi.waitFor(() =>
      expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
        "2 new exercises downloaded in Course 1.",
        expect.anything(),
      ),
    )
    expect(downloadNewExercisesForCourse).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      idOfTmcCourse(1),
      "statusBar",
    )
  })

  test("an automatic download held back by one running says nothing", async function () {
    vi.mocked(downloadNewExercisesForCourse).mockResolvedValueOnce(
      Err(new BottleneckError("Some of these exercises are already downloading.")),
    )
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])], "download")

    await refreshEverything(actionContext, { silent: true })

    await vi.waitFor(() => expect(downloadNewExercisesForCourse).toHaveBeenCalled())
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("offers nothing about the course its course home shows, but still records the offer", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])
    shownCourseHome.set(idOfTmcCourse(1))
    onTestFinished(() => shownCourseHome.set(undefined))

    await refreshEverything(actionContext, { silent: true })

    expect(dialog.notification).not.toHaveBeenCalled()
    expect(actionContext.startup.userData.setNewExercisesOffered).toHaveBeenCalledWith(
      idOfTmcCourse(1),
    )
  })

  // The window that switched to this course workspace has just offered them.
  test("a promptless refresh offers neither new exercises nor updates", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])

    await refreshEverything(actionContext, { silent: true, isPromptless: true })

    expect(dialog.notification).not.toHaveBeenCalled()
    expect(updateExercises).toHaveBeenCalledWith(actionContext, "promptless")
  })

  test("offers each course's new exercises in a notification of its own", async function () {
    const [actionContext, dialog] = contextWithCourses([
      tmcCourse(1, 0, [10, 11]),
      tmcCourse(2, 0, [20]),
    ])
    await refreshEverything(actionContext, { silent: true })

    expect(vi.mocked(dialog.notification).mock.calls.map(([message]) => message)).toEqual([
      "2 new exercises in Course 1.",
      "1 new exercise in Course 2.",
    ])
  })

  test("does not offer the exercises of a course whose reminder is postponed", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, Date.now() + 60_000, [10])])

    await refreshEverything(actionContext, { silent: false })

    expect(updateCourse).toHaveBeenCalledTimes(1)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("offers the same new exercises once, and again when more arrive", async function () {
    const course = tmcCourse(1, 0, [10])
    const [actionContext, dialog] = contextWithCourses([course])

    await refreshEverything(actionContext, { silent: true })
    await refreshEverything(actionContext, { silent: true })
    expect(dialog.notification).toHaveBeenCalledOnce()

    course.data.newExercises = [10, 11]
    await refreshEverything(actionContext, { silent: true })
    expect(dialog.notification).toHaveBeenCalledTimes(2)
    expect(vi.mocked(dialog.notification).mock.calls[1]?.[0]).toBe("2 new exercises in Course 1.")
  })

  test("holds the offer back for a refresh that asks it to, until a later one", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])

    await refreshEverything(actionContext, { silent: true, offersNewExercises: false })
    expect(dialog.notification).not.toHaveBeenCalled()

    await refreshEverything(actionContext, { silent: true })
    expect(dialog.notification).toHaveBeenCalledOnce()
  })
})

suite("refreshCourses command", function () {
  test("waits for a background refresh instead of refusing", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementationOnce(async () => {
      await blocked
      return Ok({ isUpdated: true, warnings: [] })
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    const background = refreshEverything(actionContext, { silent: true })
    const asked = refreshCourses(actionContext)
    release()
    await Promise.all([background, asked])

    expect(updateCourse).toHaveBeenCalledTimes(2)
    expect(updateExercises).toHaveBeenLastCalledWith(actionContext, "loud")
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok({ isUpdated: true, warnings: [] }))
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

    // In the Courses view, whose refresh button this is, rather than a notification.
    expect(dialog.progressNotification).toHaveBeenCalledWith(
      "Fetching course updates…",
      expect.any(Function),
      { location: { viewId: "tmcView" } },
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

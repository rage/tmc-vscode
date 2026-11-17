import { vi } from "vitest"
import * as vscode from "vscode"

import type Dialog from "../../api/dialog"
import type { FractionProgress } from "../../api/dialog"
import type { JobProgress, JobScreen } from "../../ui/backgroundJobs"
import { BackgroundJobs } from "../../ui/backgroundJobs"
import { JobProgressNotifications } from "../../ui/jobProgressNotifications"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"

const COURSE_ID = idOfMoocCourse("course")
const COURSE_HOME: JobScreen = { kind: "courseHome", courseId: COURSE_ID }

/** A notification the notifier opened, with what it reported and whether it was closed. */
interface ShownNotification {
  title: string
  reports: FractionProgress[]
  isClosed: boolean
}

suite("JobProgressNotifications", function () {
  let jobs: BackgroundJobs
  let shown: ShownNotification[]
  let isCourseHomeVisible: boolean
  let screensChanged: vscode.EventEmitter<void>
  let notifications: JobProgressNotifications

  beforeEach(function () {
    vi.useFakeTimers()
    jobs = new BackgroundJobs()
    shown = []
    isCourseHomeVisible = false
    screensChanged = new vscode.EventEmitter<void>()
    const dialog = {
      progressNotification: vi.fn(
        async (
          title: string,
          task: (progress: vscode.Progress<FractionProgress>) => Promise<unknown>,
        ) => {
          const notification: ShownNotification = { title, reports: [], isClosed: false }
          shown.push(notification)
          await task({ report: (value) => notification.reports.push(value) })
          notification.isClosed = true
        },
      ),
    } as unknown as Dialog
    notifications = new JobProgressNotifications(dialog, jobs, {
      isCourseHomeVisible: () => isCourseHomeVisible,
      isResultsVisible: () => false,
      isCoursesViewVisible: () => false,
      onDidChange: screensChanged.event,
    })
  })

  afterEach(function () {
    notifications.dispose()
    vi.useRealTimers()
  })

  /** Starts a job that runs until `finish` is called. */
  function startJob(options: { label: string; screen: JobScreen; isLong?: boolean }): {
    job: JobProgress
    finish: () => Promise<void>
  } {
    const done = Promise.withResolvers<void>()
    let started: JobProgress | undefined
    const running = jobs.run(options, async (job) => {
      started = job
      await done.promise
    })
    if (!started) {
      throw new Error("the job did not start")
    }
    return {
      job: started,
      finish: async () => {
        done.resolve()
        await running
        await vi.advanceTimersByTimeAsync(0)
      },
    }
  }

  const UPDATE = { label: "Updating 2 exercises", screen: COURSE_HOME, isLong: true }

  test("notifies a long job's progress once its screen has been out of sight a moment", async function () {
    const { job, finish } = startJob(UPDATE)
    await vi.advanceTimersByTimeAsync(500)
    expect(shown).toEqual([])

    await vi.advanceTimersByTimeAsync(500)
    job.report(0.5)
    await finish()

    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: "Updating 2 exercises", isClosed: true })
    expect(shown[0]?.reports.at(-1)).toEqual({ message: "Updating 2 exercises", fraction: 0.5 })
  })

  test("notifies nothing of a job that ends within that moment", async function () {
    const { finish } = startJob(UPDATE)
    await vi.advanceTimersByTimeAsync(500)
    await finish()
    await vi.advanceTimersByTimeAsync(1000)

    expect(shown).toEqual([])
  })

  test("leaves a short job to the status bar", async function () {
    const { finish } = startJob({ label: "Refreshing courses", screen: COURSE_HOME })
    await vi.advanceTimersByTimeAsync(1000)
    await finish()

    expect(shown).toEqual([])
  })

  test("keeps quiet while the screen showing the job is in sight", async function () {
    isCourseHomeVisible = true
    const { finish } = startJob(UPDATE)
    await vi.advanceTimersByTimeAsync(1000)
    await finish()

    expect(shown).toEqual([])
  })

  test("takes the notification away when the screen comes back, and shows it when it goes", async function () {
    const { finish } = startJob(UPDATE)
    await vi.advanceTimersByTimeAsync(1000)

    isCourseHomeVisible = true
    screensChanged.fire()
    await vi.advanceTimersByTimeAsync(0)
    expect(shown.map((notification) => notification.isClosed)).toEqual([true])

    isCourseHomeVisible = false
    screensChanged.fire()
    await vi.advanceTimersByTimeAsync(1000)
    expect(shown.map((notification) => notification.isClosed)).toEqual([true, false])
    await finish()
  })

  test("follows a job's new label", async function () {
    const exerciseId = idOfMoocExercise("loops")
    const exerciseUri = vscode.Uri.file("/exercises/loops")
    const { job, finish } = startJob({
      label: "Submitting loops",
      screen: { kind: "results", exerciseId, exerciseUri },
      isLong: true,
    })
    await vi.advanceTimersByTimeAsync(1000)

    job.relabel("Waiting for grading of loops")
    await finish()

    expect(shown[0]?.reports.at(-1)?.message).toBe("Waiting for grading of loops")
  })
})

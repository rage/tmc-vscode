import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { pendingManualExercise } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"

vsCodeTest.use({ isCoursesMoocFiEnabled: true })

const COURSE_TITLE = "MOOC Extra Course"

async function postToMock(path: string, body: object): Promise<void> {
  const response = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(204)
}

/** Adds the course without one of its exercises, which the teacher publishes afterwards. */
async function addCourseThenPublishExercise(coursesView: CoursesViewPage): Promise<void> {
  const exercise = { exercise_id: pendingManualExercise.slide.exercise_id }
  await postToMock("set-exercise-removed", { ...exercise, removed: true })
  await coursesView.goto()
  await coursesView.addNewMoocCourse(COURSE_TITLE)
  await coursesView.runPaletteCommand("View: Close All Editors")
  await postToMock("set-exercise-removed", { ...exercise, removed: false })
}

async function refreshCourses(coursesView: CoursesViewPage): Promise<void> {
  await coursesView.page
    .getByRole("toolbar", { name: "TestMyCode: Courses actions" })
    .getByRole("button", { name: "Refresh Courses", exact: true })
    .click()
}

async function openCourseHome(
  coursesView: CoursesViewPage,
  courseHome: CourseHomePage,
): Promise<void> {
  await coursesView.row(COURSE_TITLE).click()
  await courseHome.expectShown(COURSE_TITLE)
}

vsCodeTest(
  "a course's new exercises are offered by a notification, and Download downloads them",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const toast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: `1 new exercise in ${COURSE_TITLE}.` })

    await addCourseThenPublishExercise(coursesView)
    await refreshCourses(coursesView)

    await expect(toast).toBeVisible({ timeout: 30_000 })
    await expect(toast.getByRole("button", { name: "Later" })).toBeVisible()
    await toast.getByRole("button", { name: "Download" }).click()

    await openCourseHome(coursesView, courseHome)
    await courseHome.expectState(pendingManualExercise.slide.exercise_name, "Downloaded")
  },
)

vsCodeTest.describe(() => {
  vsCodeTest.use({ userSettings: { "testMyCode.newExercises": "download" } })

  vsCodeTest(
    "new exercises download by themselves when set to, and a notification counts them",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const courseHome = new CourseHomePage(page, webview)

      await addCourseThenPublishExercise(coursesView)
      await refreshCourses(coursesView)

      await expect(
        coursesView.notificationToast(`1 new exercise downloaded in ${COURSE_TITLE}.`),
      ).toBeVisible({ timeout: 30_000 })
      await openCourseHome(coursesView, courseHome)
      await courseHome.expectState(pendingManualExercise.slide.exercise_name, "Downloaded")
    },
  )
})

vsCodeTest(
  "a job running out of sight shows in the status bar, which opens its screen",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const spinner = page
      .locator('[id="workbench.parts.statusbar"]')
      .getByRole("button", { name: /^TestMyCode: Downloading/ })

    await coursesView.goto()
    await coursesView.addNewMoocCourse(COURSE_TITLE)
    await postToMock("delay-next-archive", { delayMs: 10_000 })
    await courseHome.downloadAll()
    await coursesView.runPaletteCommand("View: Close All Editors")

    await expect(spinner).toBeVisible()
    await spinner.click()

    await courseHome.expectShown(COURSE_TITLE)
    await expect(spinner).toBeHidden({ timeout: 30_000 })
  },
)

vsCodeTest(
  "a long job's progress is notified only while its screen is out of sight",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const progress = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: "Downloading 2 exercises" })

    await coursesView.goto()
    await coursesView.addNewMoocCourse(COURSE_TITLE)
    await postToMock("delay-next-archive", { delayMs: 10_000 })
    await courseHome.downloadAll()
    await expect(
      page
        .locator('[id="workbench.parts.statusbar"]')
        .getByRole("button", { name: /^TestMyCode: Downloading 2 exercises/ }),
    ).toBeVisible()
    await expect(progress).toHaveCount(0)

    await coursesView.runPaletteCommand("View: Close All Editors")

    await expect(progress).toBeVisible()
    await expect(progress).toBeHidden({ timeout: 30_000 })
  },
)

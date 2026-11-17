import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { pendingManualExercise } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"

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

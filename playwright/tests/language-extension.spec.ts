import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

// The test VS Code has no extensions installed, so the mock's Python course lacks its extension.
const COURSE_TITLE = "MOOC Python Course"
const INSTALL_SENTENCE = "Install the Python extension to run and debug your code."

vsCodeTest(
  "a Python course without the Python extension asks to install it, in its home and once on open",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const tmc = new TmcPage(page, webview)
    const toast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: INSTALL_SENTENCE })

    await vsCodeTest.step("the course home asks once an exercise is downloaded", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await expect(courseHome.notices()).toHaveCount(0)
      await courseHome.downloadAll()
      await courseHome.expectState("passing_exercise", "Downloaded")

      const notice = courseHome
        .notices()
        .getByRole("listitem")
        .filter({ hasText: INSTALL_SENTENCE })
      await expect(notice).toBeVisible({ timeout: 30_000 })
      await expect(notice.getByRole("button", { name: "Install" })).toBeVisible()
    })

    await vsCodeTest.step("opening the exercise asks once, with Install", async () => {
      await courseHome.openExercise("passing_exercise")
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toBeVisible({
        timeout: 30_000,
      })

      await expect(toast).toHaveCount(1)
      await expect(toast.getByRole("button", { name: "Install" })).toBeVisible()
    })

    await vsCodeTest.step("opening it again does not ask again", async () => {
      await tmc.runPaletteCommand("Notifications: Clear All Notifications")
      await expect(toast).toHaveCount(0)
      await page.getByRole("tab", { name: /passing_exercise\.py/ }).click()
      await tmc.runPaletteCommand("View: Close Editor")
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toHaveCount(0)
      await courseHome.reveal(COURSE_TITLE)
      await courseHome.openExercise("passing_exercise")
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toBeVisible({
        timeout: 30_000,
      })

      await expect(toast).toHaveCount(0)
    })
  },
)

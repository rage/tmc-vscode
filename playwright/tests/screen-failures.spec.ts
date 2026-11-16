import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

// A failure of something a screen started shows in that screen; a notification tells of it only
// while the screen is out of sight, and the screen still shows it once back. backend/mooc
// serves the course and fails the download on request.

const COURSE_TITLE = "MOOC Python Course"

async function failNextArchiveDownload(delayMs = 0): Promise<void> {
  const armed = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/fail-next-archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delayMs }),
  })
  expect(armed.status).toBe(204)
}

vsCodeTest(
  "Course Details shows a failed download in place, and notifies it only while hidden",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const tmc = new TmcPage(page, webview)
    const failure = courseHome.webview.getByRole("alert").filter({ hasText: /Failed to download/ })
    const toast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: /Failed to download/ })

    await vsCodeTest.step("a failure on screen shows in Course Details alone", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.expectShown(COURSE_TITLE)
      await failNextArchiveDownload()

      await courseHome.downloadAll()

      await expect(failure).toBeVisible({ timeout: 30_000 })
      await expect(failure.getByRole("button", { name: "Show Details" })).toBeVisible()
      await expect(toast).toHaveCount(0)
    })

    await vsCodeTest.step("dismissing it removes it", async () => {
      await failure.locator('vscode-toolbar-button[title="Dismiss this error"]').click()
      await expect(failure).toHaveCount(0)
    })

    await vsCodeTest.step(
      "a failure while hidden is notified, and shown once Course Details is back",
      async () => {
        await failNextArchiveDownload(8_000)
        // The course's Download leaves out an exercise whose download failed; its row offers it.
        await courseHome.webview
          .locator('vscode-toolbar-button[title="Download passing_exercise"]')
          .click()
        await tmc.runPaletteCommand("File: New Untitled Text File")
        await expect(courseHome.heading(COURSE_TITLE)).toBeHidden()

        await expect(toast).toBeVisible({ timeout: 30_000 })
        await courseHome.reveal(COURSE_TITLE)
        await expect(failure).toBeVisible()
      },
    )
  },
)

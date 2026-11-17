import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TmcPage } from "../pages/tmc"

// What a screen says in place of a notification. A failure of something it started shows in it,
// and a notification tells of the failure only while the screen is out of sight. A local pass
// while logged out shows in the results screen. backend/mooc serves the course and fails a
// download on request.

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

vsCodeTest(
  "a pass while logged out opens the results screen with Log In to Submit",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const tmc = new TmcPage(page, webview)
    const code = page.locator(".monaco-editor").getByText("def hello()")
    const passToast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: "All tests of passing_exercise passed" })

    await vsCodeTest.step("open the exercise in its course workspace, then log out", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await coursesView.expand(coursesView.row(COURSE_TITLE))
      const row = coursesView.row("passing_exercise")
      await coursesView.runContextMenuCommand(row, "Open")
      await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await coursesView.runInlineAction(coursesView.row(COURSE_TITLE), "Open Course Workspace")
      await new ExplorerPage(page).openPath(["src", "passing_exercise.py"])
      await expect(code).toBeVisible({ timeout: 30_000 })
      await coursesView.runPaletteCommand("TestMyCode: Log Out")
      await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
    })

    await vsCodeTest.step("passing tests offer to log in from the results screen", async () => {
      await code.click()
      await page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Run Tests", { exact: true })
        .click()
      const results = await tmc.panelHeaded("passing_exercise")
      await expect(results.getByRole("heading", { name: "All tests passed locally" })).toBeVisible()
      await expect(passToast).toHaveCount(0)

      await results.getByRole("button", { name: "Log In to Submit" }).click()

      await expect(results.getByRole("heading", { name: "Exercise passed" })).toBeVisible({
        timeout: 30_000,
      })
    })
  },
)

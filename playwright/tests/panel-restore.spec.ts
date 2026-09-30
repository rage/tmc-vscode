import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"

// Panels do not retain a hidden webview, so every reveal and every window reload renders the
// panel afresh from what the extension host holds.
vsCodeTest(
  "Course Details comes back after being hidden and after a window reload",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHeading = webview.getByRole("heading", { level: 1, name: "Python Course" })
    const tmcWebviews = page.locator('iframe.webview[src*="extensionId=moocfi.test-my-code"]')
    const courseTab = page.getByRole("tab", { name: /^Python Course/ })

    await vsCodeTest.step("open the course's details", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse("Python Course")
      await coursesView.runContextMenuCommand(
        coursesView.row("Python Course"),
        "Go To Course Details...",
      )
      await expect(courseHeading).toBeVisible()
    })

    await vsCodeTest.step("hide it behind another editor, which unloads it", async () => {
      await coursesView.runPaletteCommand("File: New Untitled Text File")
      await expect(tmcWebviews).toHaveCount(0)
    })

    await vsCodeTest.step("show it again", async () => {
      await courseTab.click()
      await expect(courseHeading).toBeVisible()
    })

    await vsCodeTest.step("reload the window", async () => {
      await coursesView.runPaletteCommand("Developer: Reload Window")
      await expect(courseTab).toBeVisible({ timeout: 30_000 })
      await courseTab.click()
      await expect(courseHeading).toBeVisible({ timeout: 30_000 })
    })
  },
)

import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TmcPage } from "../pages/tmc"

// Open Next Exercise goes forward in the course only. From its last exercise it opens Course
// Details, which offers the earlier ones left to do, and opens none of them itself.

vsCodeTest(
  "Open Next Exercise from the last exercise opens Course Details, not an earlier exercise",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const tmc = new TmcPage(page, webview)
    const first = coursesView.row("01_passing_exercise")
    const code = page.locator(".monaco-editor").getByText("def hello()")

    await vsCodeTest.step("open the course's last exercise, leaving the first undone", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse("Python Course")
      await coursesView.expand(coursesView.row("Python Course"))
      const last = coursesView.row("02_failing_exercise")
      await coursesView.runInlineAction(last, "Download")
      await expect(last).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await coursesView.runInlineAction(coursesView.row("Python Course"), "Open Course Workspace")
      await new ExplorerPage(page).openPath(["src", "failing_exercise.py"])
      await expect(code).toBeVisible({ timeout: 30_000 })
    })

    await vsCodeTest.step("Open Next Exercise opens Course Details", async () => {
      await code.click()
      await tmc.runExercisePaletteCommand("TestMyCode: Open Next Exercise")

      const courseHome = await tmc.panelHeaded("Python Course")
      await expect(courseHome.getByText("You reached the last exercise")).toBeVisible()
      await expect(
        courseHome.getByRole("button", { name: "Continue: 02_failing_exercise" }),
      ).toHaveAttribute("secondary")
      await expect(
        courseHome.getByRole("button", { name: "Download 01_passing_exercise" }),
      ).toBeVisible()
      await coursesView.goto()
      await coursesView.expand(coursesView.row("Python Course"))
      await expect(first).toHaveAccessibleName(/, not downloaded,/)
    })
  },
)

import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

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
        "Show Course Details...",
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

vsCodeTest(
  "a submission result in a background tab is gone after a window reload",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    const courseTitle = "MOOC Variants Course"
    const exercise = coursesView.row("mixed_task_exercise")
    const code = page.locator(".monaco-editor").getByText("def hello()")
    const submissionTab = page.getByRole("tab", { name: /^Submission: / })

    await vsCodeTest.step("submit an exercise in its course workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(courseTitle)
      await coursesView.expand(coursesView.row(courseTitle))
      await exercise.click()
      await expect(exercise).toHaveAccessibleName(/, open,/)
      await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
      await expect(page).toHaveTitle(/\(mooc\)/, { timeout: 30_000 })
      await coursesView.goto()
      await expect(coursesView.row(courseTitle)).toBeVisible({ timeout: 30_000 })
      await coursesView.expand(coursesView.row(courseTitle))
      await exercise.click()
      await expect(code).toBeVisible()
      await code.click()
      await page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Submit Solution", { exact: true })
        .click()
      await expect(sidePanel.getByRole("heading", { name: "Exercise passed" })).toBeVisible()
    })

    await vsCodeTest.step("hide the result behind another editor in its group", async () => {
      await submissionTab.click()
      await coursesView.runPaletteCommand("File: New Untitled Text File")
      // Unsaved text makes VS Code restore the editor, in front of the result.
      await page.keyboard.type("notes")
      await expect(submissionTab).toHaveAttribute("aria-selected", "false")
    })

    await vsCodeTest.step("reload the window", async () => {
      await coursesView.runPaletteCommand("Developer: Reload Window")
      await expect(page.getByRole("tab", { name: /^Untitled-1/ })).toBeVisible({ timeout: 30_000 })
      await expect(submissionTab).toHaveCount(0, { timeout: 30_000 })
    })
  },
)

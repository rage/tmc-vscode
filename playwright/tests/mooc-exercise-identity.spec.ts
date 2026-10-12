import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { QuickPickPage } from "../pages/quick-pick"
import { TmcPage } from "../pages/tmc"

function statusBarText(page: Page, text: string) {
  return page.locator('[id="workbench.parts.statusbar"]').getByText(text)
}

// "Exercise 1" (backend/mooc/fixtures.ts) lives on disk as "exercise-1", so every command
// below has to find its stored data by id rather than by the name it is listed under.
vsCodeTest(
  "a mooc exercise whose name is not its folder name can be worked on",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    const explorerPage = new ExplorerPage(page)
    const quickPick = new QuickPickPage(page)

    const courseTitle = "MOOC Variants Course"
    const exerciseName = "Exercise 1"
    const fileName = "passing_exercise.py"
    const edit = "# edited before submitting"
    const editor = page.locator(".monaco-editor").first()

    await vsCodeTest.step("open the exercise from the Courses view", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(courseTitle)
      await coursesView.expand(coursesView.row(courseTitle))
      const row = coursesView.row(exerciseName)
      await expect(row).toHaveAccessibleName(/, not downloaded,/)
      await coursesView.runContextMenuCommand(row, "Open")
      await expect(row).toHaveAccessibleName(/, open,/)
      await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
    })

    await vsCodeTest.step("edit the exercise file and submit it", async () => {
      await explorerPage.openPath(["src", fileName])
      await expect(page.getByText("def hello()")).toBeVisible()
      await page.getByText("def hello()").click()
      await page.keyboard.press("ControlOrMeta+Home")
      await page.keyboard.type(`${edit}\n`)
      await page.keyboard.press("ControlOrMeta+S")
      await expect(editor.getByText(edit)).toBeVisible()
      await page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Submit Solution", { exact: true })
        .click()
      await expect(sidePanel.getByRole("heading", { name: "Exercise passed" })).toBeVisible()
    })

    await vsCodeTest.step("reset it", async () => {
      await page.getByText("def hello()").click()
      await coursesView.runPaletteCommand("TestMyCode: Reset Exercise")
      await page
        .locator(".monaco-dialog-box")
        .getByRole("button", { name: "Reset Without Submitting" })
        .click()
      await expect(statusBarText(page, "Reset exercise-1.")).toBeVisible()
      await expect(editor.getByText(edit)).toBeHidden()
    })

    await vsCodeTest.step("restore the submission", async () => {
      await explorerPage.runContextMenuCommand(fileName, "Download Old Submission")
      await quickPick.waitForTitle(/^Download Old Submission — /)
      await quickPick.selectOnlyItem()
      await quickPick.expectClosed()
      await page
        .locator(".monaco-dialog-box")
        .getByRole("button", { name: "Restore Without Submitting" })
        .click()
      await expect(editor.getByText(edit)).toBeVisible()
    })

    await vsCodeTest.step("share it via paste", async () => {
      // The extension spaces submissions, pastes among them, 5 s apart.
      await expect(async () => {
        await page.getByText("def hello()").click()
        await coursesView.runPaletteCommand("TestMyCode: Share Exercise via Paste")
        await expect(coursesView.notificationToast("Paste link:")).toBeVisible({ timeout: 2_000 })
      }).toPass()
    })
  },
)

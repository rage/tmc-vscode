import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TmcPage } from "../pages/tmc"

vsCodeTest.use({ isCoursesMoocFiEnabled: true })

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
      await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await coursesView.openCourseWorkspace(courseTitle)
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
        .getByLabel("Submit", { exact: true })
        .click()
      await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible()
    })

    await vsCodeTest.step("reset it, with no offer to submit the code just submitted", async () => {
      await page.getByText("def hello()").click()
      await coursesView.runExercisePaletteCommand("TestMyCode: Reset Exercise")
      const dialog = page.locator(".monaco-dialog-box")
      await expect(dialog.getByRole("button", { name: "Back Up and Reset" })).toHaveCount(0)
      await dialog.getByRole("button", { name: "Reset", exact: true }).click()
      await expect(statusBarText(page, "Reset exercise-1.")).toBeVisible()
      await expect(editor.getByText(edit)).toBeHidden()
    })

    await vsCodeTest.step(
      "restore the submission from History, with no offer to back up the template",
      async () => {
        await explorerPage.runContextMenuCommand(fileName, "History")
        const restore = sidePanel.getByRole("button", { name: /^Restore the submission from / })
        await expect(restore).toHaveCount(1)
        await restore.click()
        const dialog = page.locator(".monaco-dialog-box")
        await expect(dialog.getByRole("button", { name: "Back Up and Restore" })).toHaveCount(0)
        await dialog.getByRole("button", { name: "Restore", exact: true }).click()
        await expect(sidePanel.getByText(/^Restored the submission from /)).toBeVisible()
        await expect(editor.getByText(edit)).toBeVisible()
      },
    )

    await vsCodeTest.step("get a link to it in Get Help, twice, getting one link", async () => {
      await page.getByText("def hello()").click()
      await coursesView.runExercisePaletteCommand("TestMyCode: Get Help")
      const link = sidePanel.getByText(/\/shared-submissions\/[0-9a-f-]+$/)
      await expect(link).toBeVisible()
      const firstLink = await link.textContent()
      await expect(sidePanel.getByRole("button", { name: "Copy Link" })).toBeVisible()
      await expect(sidePanel.getByRole("button", { name: "Open Link" })).toBeVisible()

      await page.getByText("def hello()").click()
      await coursesView.runExercisePaletteCommand("TestMyCode: Get Help")
      await expect(sidePanel.getByText(/unchanged since you last sent it/)).toBeVisible()
      await expect(link).toHaveText(firstLink ?? "")
      await expect(coursesView.notificationToast("Copied the paste link")).toBeHidden()
    })
  },
)

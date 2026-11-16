import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TmcPage } from "../pages/tmc"

// A submission the server has no files for has nothing to download. That is
// ordinary news, not an error: the exercise on disk must be left untouched and
// the user told.
//
// It is unreachable through the client API -- the CLI always uploads before
// submitting -- so it has to be seeded in the mock (backend/mooc/router.ts
// `seedMoocFilelessSubmission`). The integration tier
// covers the CLI's `nothing-to-download` result directly; this walks the UI that
// reports it: the explorer context menu opens History in the results panel.
vsCodeTest(
  "reports a mooc submission with no downloadable files without touching the exercise",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const explorerPage = new ExplorerPage(page)
    const sidePanel = new TmcPage(page, webview).getSidePanel()

    const courseTitle = "MOOC Python Course"
    const exerciseName = "passing_exercise"
    const fileName = "passing_exercise.py"
    const fileContents = "def hello()"
    // backend/mooc/fixtures.ts; same exercise the integration tier seeds against.
    const exerciseId = "a1a1a1a1-0000-4000-8000-000000000001"

    await vsCodeTest.step("add the mooc course and open the exercise", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(courseTitle)
      await coursesView.expand(coursesView.row(courseTitle))
      const row = coursesView.row(exerciseName)
      await coursesView.runContextMenuCommand(row, "Open")
      await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
    })

    await vsCodeTest.step("open the exercise file", async () => {
      await explorerPage.openPath(["src", fileName])
      await expect(page.getByText(fileContents)).toBeVisible()
    })

    await vsCodeTest.step("seed a submission carrying no files", async () => {
      const response = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/seed-fileless-submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exercise_id: exerciseId }),
      })
      expect(response.status).toBe(200)
    })

    await vsCodeTest.step("restore the submission from History", async () => {
      await explorerPage.runContextMenuCommand(fileName, "Download Old Submission")

      await expect(sidePanel.getByRole("button", { name: "History", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      )
      // The seeded one is the only submission: nothing has been submitted from here.
      const restore = sidePanel.getByRole("button", { name: /^Restore the submission from / })
      await expect(restore).toHaveCount(1)
      await expect(sidePanel.getByText("Latest submission")).toBeVisible()
      await restore.click()

      // The exercise is as downloaded, so there is nothing to back up first.
      await page
        .locator(".monaco-dialog-box")
        .getByRole("button", { name: "Restore", exact: true })
        .click()
    })

    await vsCodeTest.step("see it reported in History as a normal outcome", async () => {
      await expect(sidePanel.getByText("That submission has no files to download.")).toBeVisible()
      await expect(
        coursesView.notificationToast("That submission has no files to download."),
      ).toBeHidden()
      // Nothing was restored, so the editor still holds the exercise stub.
      await expect(page.getByText(fileContents)).toBeVisible()
    })
  },
)

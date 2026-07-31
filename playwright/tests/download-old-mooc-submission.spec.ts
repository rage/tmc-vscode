import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { migrationTest } from "../migration-gate"
import { CoursePage } from "../pages/course"
import { ExplorerPage } from "../pages/explorer"
import { MyCoursesPage } from "../pages/my-courses"
import { QuickPickPage } from "../pages/quick-pick"

// A submission the server has no files for has nothing to download. That is
// ordinary news, not an error: the exercise on disk must be left untouched and
// the user told.
//
// It is unreachable through the client API -- the CLI always uploads before
// submitting -- so it has to be seeded in the mock (backend/mooc/router.ts
// `seedMoocFilelessSubmission`). The integration tier
// covers the CLI's `nothing-to-download` result directly; this walks the UI that
// reports it -- the explorer context menu and the three quick picks in
// src/commands/downloadOldSubmission.ts.
migrationTest(
  "reports a mooc submission with no downloadable files without touching the exercise",
  async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const coursePage = new CoursePage(page, webview)
    const explorerPage = new ExplorerPage(page)
    const quickPick = new QuickPickPage(page)

    const courseTitle = "MOOC Python Course"
    const exerciseName = "01_passing_exercise"
    const fileName = "passing_exercise.py"
    const fileContents = "def hello()"
    // backend/mooc/fixtures.ts; same exercise the integration tier seeds against.
    const exerciseId = "a1a1a1a1-0000-4000-8000-000000000001"

    await vsCodeTest.step("add the mooc course and open the exercise", async () => {
      await myCoursesPage.goto()
      await myCoursesPage.addNewMoocCourse(courseTitle)
      await myCoursesPage.selectCourse(courseTitle)
      // The exercise group must have rendered before showExercises can expand it;
      // otherwise its checkbox stays hidden inside a collapsed group.
      await expect(webview.getByRole("heading", { name: "part01" })).toBeVisible()
      await coursePage.showExercises()
      await coursePage.openExercises([exerciseName])
      await expect(webview.getByRole("cell", { name: "opened" })).toBeVisible()
      await coursePage.openWorkspace()
    })

    await vsCodeTest.step("open the exercise file", async () => {
      await explorerPage.openPath(["src", fileName])
      await expect(page.getByText(fileContents)).toBeVisible()
    })

    await vsCodeTest.step("seed a submission carrying no files", async () => {
      const response = await fetch("http://localhost:4001/mooc-mock/seed-fileless-submission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exercise_id: exerciseId }),
      })
      expect(response.status).toBe(200)
    })

    await vsCodeTest.step("pick the submission from the explorer context menu", async () => {
      await explorerPage.runContextMenuCommand(fileName, "Download Old Submission")

      await quickPick.waitForTitle("Download Old Submission")
      // The seeded one is the only submission: nothing has been submitted from here.
      await quickPick.selectOnlyItem()

      await quickPick.selectByLabel("Discard current state")
      // Discarding asks again, since the current state would be lost.
      await quickPick.selectByLabel("Yes, discard current state")
      await quickPick.expectClosed()
    })

    await vsCodeTest.step("see it reported as a normal outcome", async () => {
      await expect(
        page
          .locator(".notifications-toasts")
          .getByText("That submission has no files to download."),
      ).toBeVisible()
      // Nothing was restored, so the editor still holds the exercise stub.
      await expect(page.getByText(fileContents)).toBeVisible()
    })
  },
)

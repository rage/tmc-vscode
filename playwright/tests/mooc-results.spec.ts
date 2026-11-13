import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { passingExercise } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TmcPage } from "../pages/tmc"

// What courses.mooc.fi tells about an exercise after it leaves the student's hands: the
// server's test results of a submission, and that a downloaded exercise was deleted from its
// course. backend/mooc/fixtures.ts serves the courses.

vsCodeTest("a failing submission lists the server's tests", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const sidePanel = new TmcPage(page, webview).getSidePanel()
  const courseTitle = "MOOC Extra Course"
  const exercise = coursesView.row("failing_exercise")

  await vsCodeTest.step("open the exercise", async () => {
    await coursesView.goto()
    await coursesView.addNewMoocCourse(courseTitle)
    await coursesView.expand(coursesView.row(courseTitle))
    await exercise.click()
    await expect(exercise).toHaveAccessibleName(/, open,/)
  })

  await vsCodeTest.step("submit it and see which test failed, and why", async () => {
    await page.locator(".monaco-editor").first().click()
    await page
      .getByRole("toolbar", { name: "Editor actions" })
      .getByLabel("Submit Solution", { exact: true })
      .click()
    await expect(
      sidePanel.getByRole("heading", { name: "Some tests failed on the server" }),
    ).toBeVisible()
    await expect(sidePanel.getByText("1 of 2 tests passed")).toBeVisible()
    await expect(sidePanel.getByText("HelloTest.counts", { exact: true })).toBeVisible()
    await expect(sidePanel.getByText("expected 2 but was 1")).toBeVisible()
  })
})

vsCodeTest(
  "an exercise deleted from its course stays on disk, listed apart",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseTitle = "MOOC Python Course"
    const exercise = coursesView.row("passing_exercise")

    await vsCodeTest.step("download the exercise", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(courseTitle)
      await coursesView.expand(coursesView.row(courseTitle))
      await exercise.click()
      await expect(exercise).toHaveAccessibleName(/, open,/)
    })

    await vsCodeTest.step("a check for updates finds it removed, without failing", async () => {
      const removed = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-exercise-removed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exercise_id: passingExercise.slide.exercise_id, removed: true }),
      })
      expect(removed.status).toBe(204)
      await coursesView.runPaletteCommand("TestMyCode: Update Exercises")

      await expect(coursesView.row("Removed from the course")).toBeVisible()
      await expect(exercise).toHaveAccessibleName(/removed from the course/)
      await expect(coursesView.notificationToast("Failed to check")).toBeHidden()
    })
  },
)

vsCodeTest(
  "the last try asks first, and an exercise out of tries offers no Submit",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    const courseTitle = "MOOC Variants Course"
    const exercise = coursesView.row("limited_tries_exercise")
    const submitButton = page
      .getByRole("toolbar", { name: "Editor actions" })
      .getByLabel("Submit Solution", { exact: true })

    await vsCodeTest.step("open the exercise, which has one try, in its workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(courseTitle)
      await coursesView.expand(coursesView.row(courseTitle))
      await exercise.click()
      await expect(exercise).toHaveAccessibleName(/, open,.*1 try left/)
      await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
      await new ExplorerPage(page).openPath(["src", "passing_exercise.py"])
      await expect(page.getByText("def hello()")).toBeVisible()
    })

    await vsCodeTest.step("submitting asks first, as it is the last try", async () => {
      await page.getByText("def hello()").click()
      await submitButton.click()
      const dialog = page.locator(".monaco-dialog-box")
      await expect(dialog).toContainText("This is your last try on limited_tries_exercise. Submit?")
      await dialog.getByRole("button", { name: "Submit", exact: true }).click()
      await expect(
        sidePanel.getByRole("heading", { name: "Some tests failed on the server" }),
      ).toBeVisible()
    })

    await vsCodeTest.step("Submit is gone everywhere, and the reason is given", async () => {
      await expect(
        sidePanel.getByText("You have no tries left on limited_tries_exercise", { exact: false }),
      ).toBeVisible()
      await expect(sidePanel.getByRole("button", { name: "Submit Again" })).toHaveCount(0)
      await coursesView.goto()
      await coursesView.expand(coursesView.row(courseTitle))
      await expect(exercise).toHaveAccessibleName(/no tries left/)
      await page.getByText("def hello()").click()
      await expect(submitButton).toHaveCount(0)
    })
  },
)

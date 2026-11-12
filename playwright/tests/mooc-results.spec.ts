import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { passingExercise } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
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

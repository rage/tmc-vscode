import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { courseWorkspaceSettings } from "../courseWorkspace"
import { vsCodeTest } from "../fixtures"
import { AddCoursePage } from "../pages/add-course"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TestResultsPage } from "../pages/test-results"
import { TmcPage } from "../pages/tmc"

// End-to-end walk of the mooc (courses.mooc.fi) student flow against the mooc mock
// (backend/mooc, routed via TMC_LANGS_MOOC_ROOT_URL in fixtures.ts): device-flow login ->
// picking an enrolled course -> its exercises in the Courses view -> downloading one from its
// context menu -> opening the workspace and file -> local tests -> submit -> the reduced mooc
// result panel (grading progress and score, no per-test breakdown).
//
// The file explorer, test run and submit depend on mooc workspace tracking (the CLI's
// `list-local-exercises`, consumed by refreshLocalExercises).
vsCodeTest(
  "can add, open, test and submit a mooc course exercise",
  async ({ page, userDataDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const testResultsPage = new TestResultsPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    const explorerPage = new ExplorerPage(page)

    // Served by backend/mooc/fixtures.ts; the exercise packs the same python resource as the
    // TMC course, so its tests run locally.
    const courseTitle = "MOOC Python Course"
    const exerciseName = "passing_exercise"
    const filePath = ["src", "passing_exercise.py"]
    const fileContents = "def hello()"

    await vsCodeTest.step("open the Courses view", async () => {
      await coursesView.goto()
    })

    await vsCodeTest.step("log in and see the enrolled course's card", async () => {
      await coursesView.logInToMooc()
      const card = new AddCoursePage(page, webview).card(courseTitle)
      await expect(card).toContainText(
        "A test python course served by the local mooc mock backend.",
      )
      await expect(card).not.toContainText("Added")
    })

    await vsCodeTest.step("add the mooc course, which opens its course home", async () => {
      const course = coursesView.row(courseTitle)
      await expect(course).toBeHidden()
      await new AddCoursePage(page, webview).addMoocCourse(courseTitle)
      await new CourseHomePage(page, webview).expectShown(courseTitle)
      await expect(course).not.toHaveAccessibleName(/mooc\.fi/)
    })

    await vsCodeTest.step("expand the course and see its exercises", async () => {
      await coursesView.expand(coursesView.row(courseTitle))
      // A mooc course names no parts, so its exercises sit right under it.
      await expect(coursesView.row(exerciseName)).toHaveAccessibleName(/, not downloaded,/)
    })

    await vsCodeTest.step("open an exercise, downloading it on the way", async () => {
      const row = coursesView.row(exerciseName)
      await coursesView.runContextMenuCommand(row, "Open")
      await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
    })

    await vsCodeTest.step("open workspace", async () => {
      await coursesView.openCourseWorkspace(courseTitle)
    })

    await vsCodeTest.step(
      "the course sets no AI policy, so its workspace turns AI off",
      async () => {
        await expect
          .poll(() => courseWorkspaceSettings(userDataDir))
          .toMatchObject({ "editor.inlineSuggest.enabled": false })
      },
    )

    await vsCodeTest.step("open exercise file", async () => {
      // The file only surfaces once the downloaded exercise is registered as a WorkspaceExercise.
      const contents = page.getByText(fileContents)
      await expect(contents).toBeHidden()
      await explorerPage.openPath(filePath)
      await expect(contents).toBeVisible()
    })

    const allPassed = sidePanel.getByRole("heading", { name: "Tests pass on your computer" })

    await vsCodeTest.step("run tests", async () => {
      await page.getByText(fileContents).click()
      await expect(allPassed).toBeHidden()
      // Contributed under `test-my-code:ActiveEditorIsExercise` (package.json), so it renders
      // only once the extension has recognised the open exercise.
      const runTests = page.getByLabel("Run Tests", { exact: true })
      await expect(runTests).toBeVisible()
      await runTests.click()
      await expect(allPassed).toBeVisible()
      await testResultsPage.open()
      await expect(testResultsPage.result("PassingExercise: test_passing").first()).toBeVisible()
    })

    await vsCodeTest.step("submit exercise and see the reduced mooc result", async () => {
      // A "Passed" heading (full points, per the backend's standing) plus the score, not the
      // TMC per-test view.

      const gradedHeading = sidePanel.getByRole("heading", { name: "Passed", exact: true })
      await expect(gradedHeading).toBeHidden()
      await sidePanel.getByRole("button", { name: "Submit", exact: true }).click()
      await expect(gradedHeading).toBeVisible()
      await expect(sidePanel.getByRole("meter", { name: "Points" })).toHaveAttribute(
        "aria-valuetext",
        /^1 \/ \d+ points$/,
      )
      await expect(sidePanel.getByRole("button", { name: "Show Model Solution" })).toHaveCount(0)
    })
  },
)

vsCodeTest("submitting an exercise gone from the server says so", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const sidePanel = new TmcPage(page, webview).getSidePanel()
  const explorerPage = new ExplorerPage(page)

  await vsCodeTest.step("open the exercise in its workspace", async () => {
    await coursesView.goto()
    await coursesView.addNewMoocCourse("MOOC Python Course")
    await coursesView.expand(coursesView.row("MOOC Python Course"))
    const row = coursesView.row("passing_exercise")
    await coursesView.runContextMenuCommand(row, "Open")
    await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
    await coursesView.openCourseWorkspace("MOOC Python Course")
    await explorerPage.openPath(["src", "passing_exercise.py"])
    await expect(page.getByText("def hello()")).toBeVisible()
  })

  await vsCodeTest.step("submit after the exercise is removed", async () => {
    const armed = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/fail-next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId: "getClientExercise", status: 404 }),
    })
    expect(armed.status).toBe(204)
    await page.getByText("def hello()").click()
    await page
      .getByRole("toolbar", { name: "Editor actions" })
      .getByLabel("Submit", { exact: true })
      .click()

    await expect(sidePanel.getByRole("heading", { name: "Submission failed" })).toBeVisible()
    await expect(
      sidePanel.getByText("This exercise is no longer in the course.", { exact: false }),
    ).toBeVisible()
    await expect(sidePanel.getByRole("button", { name: "Refresh Courses" })).toBeVisible()
    await sidePanel.getByRole("button", { name: "Show Details" }).click()
    const help = await new TmcPage(page, webview).panelHeaded("Error Details")
    const cause = await help.getByRole("group", { name: "Cause" }).textContent()
    expect(cause?.split("404 Not Found from")).toHaveLength(2)
  })
})

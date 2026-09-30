import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TestResultsPage } from "../pages/test-results"
import { TestSubmissionPage } from "../pages/test-submission"

// End-to-end walk of the mooc (courses.mooc.fi) student flow against the mooc
// mock backend (backend/mooc, mounted in the same process as the legacy TMC
// mock and routed via TMC_LANGS_MOOC_ROOT_URL in fixtures.ts). It covers the
// full path the mooc migration adds: device-flow login -> picking an enrolled
// course from the add-course quick pick -> the course's exercises in the Courses
// view -> opening (downloading) an exercise from its context menu -> opening the
// workspace -> opening the exercise file -> running the local tests -> submitting
// -> the reduced mooc result panel.
//
// Reaching the file explorer / run-tests / submit depends on mooc workspace
// tracking (the CLI's `mooc list-local-course-exercises` + slug-carrying
// LocalMoocExercise, consumed by refreshLocalExercises). Before that landed the
// exercise files never surfaced in the opened workspace and this walk had to
// stop at "opened". The submit result here is the REDUCED mooc panel (overall
// grading progress + score, no per-test breakdown), distinct from the TMC
// submission view.
vsCodeTest("can add, open, test and submit a mooc course exercise", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const testResultsPage = new TestResultsPage(page, webview)
  const testSubmissionPage = new TestSubmissionPage(page, webview)
  const explorerPage = new ExplorerPage(page)

  // course + exercise are served by backend/mooc/fixtures.ts; the exercise packs
  // the same python resource the TMC course uses, so its tests run locally.
  const courseTitle = "MOOC Python Course"
  const exerciseName = "passing_exercise"
  const filePath = ["src", "passing_exercise.py"]
  const fileContents = "def hello()"

  await vsCodeTest.step("open the Courses view", async () => {
    await coursesView.goto()
  })

  await vsCodeTest.step("add the mooc course", async () => {
    const course = coursesView.row(courseTitle)
    await expect(course).toBeHidden()
    await coursesView.addNewMoocCourse(courseTitle)
    await expect(course).toHaveAccessibleName(/, courses\.mooc\.fi(,|$)/)
  })

  await vsCodeTest.step("expand the course and see its exercises", async () => {
    await coursesView.expand(coursesView.row(courseTitle))
    // A mooc course names no parts, so its exercises sit right under it.
    await expect(coursesView.row(exerciseName)).toHaveAccessibleName(/, not downloaded,/)
  })

  await vsCodeTest.step("open an exercise, downloading it on the way", async () => {
    const row = coursesView.row(exerciseName)
    await coursesView.runContextMenuCommand(row, "Open")
    await expect(row).toHaveAccessibleName(/, open,/)
  })

  await vsCodeTest.step("open workspace", async () => {
    await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
  })

  await vsCodeTest.step("open exercise file", async () => {
    // The file only surfaces if the downloaded mooc exercise was registered as a
    // WorkspaceExercise (the workspace-tracking fix); before it, the "src" folder
    // never appeared.
    const contents = page.getByText(fileContents)
    await expect(contents).toBeHidden()
    await explorerPage.openPath(filePath)
    await expect(contents).toBeVisible()
  })

  const allPassed = page
    .locator(".notifications-toasts .notification-toast")
    .filter({ hasText: "All tests of passing_exercise passed." })

  await vsCodeTest.step("run tests", async () => {
    await page.getByText(fileContents).click()
    await expect(allPassed).toBeHidden()
    // The editor-title action is contributed under `test-my-code:ActiveEditorIsExercise`
    // (package.json), so it renders only once the extension has recognised the
    // open exercise.
    const runTests = page.getByLabel("Run Tests", { exact: true })
    await expect(runTests).toBeVisible()
    await runTests.click()
    await expect(allPassed).toBeVisible()
    await testResultsPage.open()
    await expect(testResultsPage.result("PassingExercise: test_passing").first()).toBeVisible()
  })

  await vsCodeTest.step("submit exercise and see the reduced mooc result", async () => {
    // The mooc submit renders the reduced result panel: a "Exercise graded"
    // heading (FullyGraded) plus the score, not the TMC per-test submission view.
    const gradedHeading = testSubmissionPage.getWebview().getByRole("heading", {
      name: "Exercise graded",
    })
    await expect(gradedHeading).toBeHidden()
    await allPassed.getByRole("button", { name: "Submit" }).click()
    await expect(gradedHeading).toBeVisible()
    await expect(
      testSubmissionPage.getWebview().getByRole("meter", { name: "Points" }),
    ).toHaveAttribute("aria-valuetext", /^1 \/ \d+ points$/)
  })
})

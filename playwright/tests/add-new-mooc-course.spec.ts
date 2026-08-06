import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { migrationTest } from "../migration-gate"
import { CoursePage } from "../pages/course"
import { ExplorerPage } from "../pages/explorer"
import { MyCoursesPage } from "../pages/my-courses"
import { TestResultsPage } from "../pages/test-results"
import { TestSubmissionPage } from "../pages/test-submission"

// End-to-end walk of the mooc (courses.mooc.fi) student flow against the mooc
// mock backend (backend/mooc, mounted in the same process as the legacy TMC
// mock and routed via TMC_LANGS_MOOC_ROOT_URL in fixtures.ts). It covers the
// full path the mooc migration adds: platform selection -> enrolled-course
// selection -> course details -> selecting and opening (downloading) an
// exercise -> opening the workspace -> opening the exercise file -> running the
// local tests -> submitting -> the reduced mooc result panel.
//
// Reaching the file explorer / run-tests / submit depends on mooc workspace
// tracking (the CLI's `mooc list-local-course-exercises` + slug-carrying
// LocalMoocExercise, consumed by refreshLocalExercises). Before that landed the
// exercise files never surfaced in the opened workspace and this walk had to
// stop at "opened". The submit result here is the REDUCED mooc panel (overall
// grading progress + score, no per-test breakdown), distinct from the TMC
// submission view.
migrationTest(
  "can add, open, test and submit a mooc course exercise",
  async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const coursePage = new CoursePage(page, webview)
    const testResultsPage = new TestResultsPage(page, webview)
    const testSubmissionPage = new TestSubmissionPage(page, webview)
    const explorerPage = new ExplorerPage(page)

    // course + exercise are served by backend/mooc/fixtures.ts; the exercise packs
    // the same python resource the TMC course uses, so its tests run locally.
    const courseTitle = "MOOC Python Course"
    const exerciseName = "01_passing_exercise"
    const filePath = ["src", "passing_exercise.py"]
    const fileContents = "def hello()"

    await vsCodeTest.step("open My Courses", async () => {
      await myCoursesPage.goto()
    })

    await vsCodeTest.step("add the mooc course", async () => {
      const courseHeader = webview.getByRole("heading", {
        name: "MOOC Python Course (mooc-python-course)",
      })
      await expect(courseHeader).toBeHidden()
      await myCoursesPage.addNewMoocCourse(courseTitle)
      await expect(courseHeader).toBeVisible()
    })

    await vsCodeTest.step("open the course details and see its exercises", async () => {
      await myCoursesPage.selectCourse(courseTitle)
      // the exercise group parsed from the "part01-..." exercise slug renders
      await expect(webview.getByRole("heading", { name: "part01" })).toBeVisible()
    })

    await vsCodeTest.step("select and open an exercise", async () => {
      const openedStatus = webview.getByRole("cell", { name: "opened" })
      await expect(openedStatus).toBeHidden()
      await coursePage.showExercises()
      await coursePage.openExercises([exerciseName])
      await expect(openedStatus).toBeVisible()
    })

    await vsCodeTest.step("open workspace", async () => {
      await coursePage.openWorkspace()
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

    await vsCodeTest.step("run tests", async () => {
      const successMessage = testResultsPage
        .getWebview()
        .getByRole("heading", { name: "Tests passed" })
      await page.getByText(fileContents).click()
      await expect(successMessage).toBeHidden()
      // wait for the extension to recognise that we have opened an exercise
      // oxlint-disable-next-line playwright/no-wait-for-timeout -- deliberate settle-delay while polling flaky VS Code webview UI
      await page.waitForTimeout(500)
      await page.getByLabel("Run Tests (Ctrl+Shift+T)").click()
      await expect(successMessage).toBeVisible()
    })

    await vsCodeTest.step("submit exercise and see the reduced mooc result", async () => {
      // The mooc submit renders the reduced result panel: a "Exercise graded"
      // heading (FullyGraded) plus the score, not the TMC per-test submission view.
      const gradedHeading = testSubmissionPage.getWebview().getByRole("heading", {
        name: "Exercise graded",
      })
      await expect(gradedHeading).toBeHidden()
      await testResultsPage.submit()
      await expect(gradedHeading).toBeVisible()
      await expect(testSubmissionPage.getWebview().getByText("Score: 1")).toBeVisible()
    })
  },
)

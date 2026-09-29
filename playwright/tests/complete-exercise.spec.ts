import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursePage } from "../pages/course"
import { ExplorerPage } from "../pages/explorer"
import { MyCoursesPage } from "../pages/my-courses"
import { TestResultsPage } from "../pages/test-results"
import { TestSubmissionPage } from "../pages/test-submission"

interface Exercise {
  course: string
  name: string
  file_path: string[]
  file_contents: string
  /** The test's name as the Test Results view labels it. */
  test_name: string
  expected_result: "pass" | "fail"
}

const exercises: Exercise[] = [
  {
    course: "Python Course",
    name: "01_passing_exercise",
    file_path: ["src", "passing_exercise.py"],
    file_contents: "def hello()",
    test_name: "PassingExercise: test_passing",
    expected_result: "pass",
  },
  {
    course: "Python Course",
    name: "02_failing_exercise",
    file_path: ["src", "failing_exercise.py"],
    file_contents: "def hello()",
    test_name: "FailingExercise: test_failing",
    expected_result: "fail",
  },
]

for (const exercise of exercises) {
  // The title is also the trace filename (fixtures.ts), so a constant one would
  // have every case overwrite the last one's trace.
  vsCodeTest(`can complete ${exercise.name}`, async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const coursePage = new CoursePage(page, webview)
    const testResultsPage = new TestResultsPage(page, webview)
    const testSubmissionPage = new TestSubmissionPage(page, webview)
    const explorerPage = new ExplorerPage(page)

    // The session comes from the tmc credentials the fixture seeds (fixtures.ts).
    await vsCodeTest.step("open My Courses", async () => {
      await myCoursesPage.goto()
    })

    await vsCodeTest.step("open course", async () => {
      await myCoursesPage.addNewCourse(exercise.course)
      await myCoursesPage.selectCourse(exercise.course)
    })

    await vsCodeTest.step("open exercise", async () => {
      const openedStatus = webview.getByRole("cell", { name: "opened" })
      await expect(openedStatus).toBeHidden()
      await coursePage.showExercises()
      await coursePage.openExercises([exercise.name])
      await expect(openedStatus).toBeVisible()
    })

    await vsCodeTest.step("open workspace", async () => {
      await coursePage.openWorkspace()
    })

    await vsCodeTest.step("open exercise file", async () => {
      const contents = page.getByText(exercise.file_contents)
      await expect(contents).toBeHidden()
      await explorerPage.openPath(exercise.file_path)
      await expect(contents).toBeVisible()
    })

    await vsCodeTest.step("run tests", async () => {
      await page.getByText(exercise.file_contents).click()
      // The editor-title action is contributed under `test-my-code:ActiveEditorIsExercise`
      // (package.json), so it renders only once the extension has recognised the
      // open exercise.
      const runTests = page.getByLabel("Run Tests", { exact: true })
      await expect(runTests).toBeVisible()
      await runTests.click()
      if (exercise.expected_result === "pass") {
        await expect(allPassedToast(page)).toBeVisible()
      }
      await testResultsPage.open()
      await expect(testResultsPage.result(exercise.test_name).first()).toBeVisible()
      if (exercise.expected_result === "fail") {
        await expect(testResultsPage.result("1 of 1 tests failed.").first()).toBeVisible()
        await expect(allPassedToast(page)).toBeHidden()
      }
    })

    await vsCodeTest.step("submit exercise", async () => {
      const expectedString = expectedResultInSubmissionView(exercise.expected_result)
      await expect(
        testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
      ).toBeHidden()
      if (exercise.expected_result === "pass") {
        await allPassedToast(page).getByRole("button", { name: "Submit" }).click()
      } else {
        await page.getByLabel("Submit Solution", { exact: true }).click()
      }
      await expect(
        testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
      ).toBeVisible()
    })
  })
}

/** The notification that offers Submit after an all-passing local run. */
function allPassedToast(page: Page): Locator {
  return page
    .locator(".notifications-toasts .notification-toast")
    .filter({ hasText: /All tests of .+ passed\./ })
}

function expectedResultInSubmissionView(expectedResult: "pass" | "fail"): string {
  if (expectedResult === "pass") {
    return "All tests passed on the server"
  }
  return "Some tests failed on the server"
}

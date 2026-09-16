import { expect } from "@playwright/test"

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
  expected_result: "pass" | "fail"
}

const exercises: Exercise[] = [
  {
    course: "Python Course",
    name: "01_passing_exercise",
    file_path: ["src", "passing_exercise.py"],
    file_contents: "def hello()",
    expected_result: "pass",
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
      const expectedString = expectedResultInTestView(exercise.expected_result)
      await page.getByText(exercise.file_contents).click()
      const resultMessage = testResultsPage
        .getWebview()
        .getByRole("heading", { name: expectedString })
      await expect(resultMessage).toBeHidden()
      // The editor-title action is contributed under `test-my-code:WorkspaceActive`
      // (package.json), so it renders only once the extension has recognised the
      // open exercise.
      const runTests = page.getByLabel("Run Tests (Ctrl+Shift+T)")
      await expect(runTests).toBeVisible()
      await runTests.click()
      await expect(resultMessage).toBeVisible()
    })

    await vsCodeTest.step("submit exercise", async () => {
      const expectedString = expectedResultInSubmissionView(exercise.expected_result)
      await expect(
        testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
      ).toBeHidden()
      await testResultsPage.submit()
      await expect(
        testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
      ).toBeVisible()
    })
  })
}

function expectedResultInTestView(expectedResult: "pass" | "fail"): string {
  if (expectedResult === "pass") {
    return "Tests passed"
  }
  return "Tests failed"
}

function expectedResultInSubmissionView(expectedResult: "pass" | "fail"): string {
  if (expectedResult === "pass") {
    return "All tests passed on the server"
  }
  return "Some tests failed on the server"
}

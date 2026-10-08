import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

import { VSCODE_TEST_VERSION } from "../../config"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TestResultsPage } from "../pages/test-results"
import { TestSubmissionPage } from "../pages/test-submission"

// Both arrived in VS Code 1.104; an older one does not declare them, so nothing writes them.
const SETTINGS_SINCE_1_104 = { "chat.disableAIFeatures": true, "chat.mcp.access": "none" }

/** Whether the VS Code under test is 1.104 or newer; a channel name such as "stable" is. */
function isAtLeast1104(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  return !match || Number(match[1]) > 1 || Number(match[2]) >= 104
}

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
  vsCodeTest(`can complete ${exercise.name}`, async ({ page, userDataDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const testResultsPage = new TestResultsPage(page, webview)
    const testSubmissionPage = new TestSubmissionPage(page, webview)
    const explorerPage = new ExplorerPage(page)

    // The session comes from the tmc credentials the fixture seeds (fixtures.ts).
    await vsCodeTest.step("open the Courses view", async () => {
      await coursesView.goto()
    })

    await vsCodeTest.step("add and expand the course", async () => {
      await coursesView.addNewCourse(exercise.course)
      await coursesView.expand(coursesView.row(exercise.course))
      await expect(coursesView.row("Part 1")).toHaveAttribute("aria-expanded", "true")
    })

    await vsCodeTest.step("download the exercise, which opens it", async () => {
      const row = coursesView.row(exercise.name)
      await expect(row).toHaveAccessibleName(/, not downloaded,/)
      await coursesView.runInlineAction(row, "Download")
      await expect(row).toHaveAccessibleName(/, open,/)
    })

    await vsCodeTest.step("open workspace", async () => {
      await coursesView.runInlineAction(coursesView.row(exercise.course), "Open Course Workspace")
    })

    await vsCodeTest.step("the course workspace turns AI assistance off", async () => {
      const hasNewerSettings = isAtLeast1104(VSCODE_TEST_VERSION)
      await expect
        .poll(() => courseWorkspaceSettings(userDataDir))
        .toMatchObject({
          "chat.agent.enabled": false,
          "chat.extensionTools.enabled": false,
          "editor.inlineSuggest.enabled": false,
          ...(hasNewerSettings ? SETTINGS_SINCE_1_104 : {}),
        })
      if (!hasNewerSettings) {
        const settings = courseWorkspaceSettings(userDataDir)
        for (const section of Object.keys(SETTINGS_SINCE_1_104)) {
          expect(settings).not.toHaveProperty([section])
        }
      }
      const userSettings = JSON.parse(
        fs.readFileSync(join(userDataDir, "User", "settings.json"), "utf-8"),
      )
      expect(userSettings).toStrictEqual({ "window.dialogStyle": "custom" })
    })

    await vsCodeTest.step("open exercise file", async () => {
      const contents = page.getByText(exercise.file_contents)
      await expect(contents).toBeHidden()
      await explorerPage.openPath(exercise.file_path)
      await expect(contents).toBeVisible()
    })

    await vsCodeTest.step("reveal the exercise in the Courses view", async () => {
      await page.keyboard.press("F1")
      const palette = page.locator(".quick-input-widget")
      await palette.locator("input").fill(">TestMyCode: Reveal in Courses View")
      await palette
        .locator(".quick-input-list .monaco-list-row")
        .filter({ hasText: "Reveal in Courses View" })
        .first()
        .click()
      // A monaco list keeps DOM focus on itself and marks the focused row with a class.
      await expect(coursesView.tree()).toBeFocused()
      const row = coursesView.row(exercise.name)
      await expect(row).toHaveClass(/\bfocused\b/)
      await expect(row).toHaveAttribute("aria-selected", "true")
    })

    await vsCodeTest.step("run tests", async () => {
      await page.getByText(exercise.file_contents).click()
      // The editor-title action is contributed under `test-my-code:ActiveEditorIsExercise`
      // (package.json), so it renders only once the extension has recognised the
      // open exercise.
      const runTests = editorActions(page).getByLabel("Run Tests", { exact: true })
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
        await editorActions(page).getByLabel("Submit Solution", { exact: true }).click()
      }
      await expect(
        testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
      ).toBeVisible()
    })
  })
}

/** The editor title bar's actions; the Courses view's exercise rows carry the same labels. */
function editorActions(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Editor actions" })
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

/** The `settings` of the one course workspace file, or `undefined` while there is none to read. */
function courseWorkspaceSettings(userDataDir: string): Record<string, unknown> | undefined {
  const folder = join(userDataDir, "User", "globalStorage", "moocfi.test-my-code", "workspaces")
  try {
    const [workspaceFile] = fs.readdirSync(folder).filter((f) => f.endsWith(".code-workspace"))
    if (!workspaceFile) {
      return undefined
    }
    return JSON.parse(fs.readFileSync(join(folder, workspaceFile), "utf-8")).settings
  } catch {
    return undefined
  }
}

import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"
import type { FrameLocator, Locator, Page } from "@playwright/test"

import { VSCODE_TEST_VERSION } from "../../config"
import { courseWorkspaceSettings } from "../courseWorkspace"
import { BASE_USER_SETTINGS, vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TestResultsPage } from "../pages/test-results"
import { TmcPage } from "../pages/tmc"

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
  // The title doubles as the trace filename (fixtures.ts); a constant one would overwrite traces.
  vsCodeTest(`can complete ${exercise.name}`, async ({ page, userDataDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const testResultsPage = new TestResultsPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
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
      await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
    })

    await vsCodeTest.step("open workspace", async () => {
      await coursesView.openCourseWorkspace(exercise.course)
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
      expect(userSettings).toStrictEqual(BASE_USER_SETTINGS)
    })

    await vsCodeTest.step("open exercise file", async () => {
      const contents = page.getByText(exercise.file_contents)
      await expect(contents).toBeHidden()
      await explorerPage.openPath(exercise.file_path)
      await expect(contents).toBeVisible()
    })

    await vsCodeTest.step("reveal the exercise in the Courses view", async () => {
      await coursesView.runExercisePaletteCommand("TestMyCode: Show in Courses View")
      // A monaco list keeps DOM focus on itself and marks the focused row with a class.
      await expect(coursesView.tree()).toBeFocused()
      const row = coursesView.row(exercise.name)
      await expect(row).toHaveClass(/\bfocused\b/)
      await expect(row).toHaveAttribute("aria-selected", "true")
    })

    await vsCodeTest.step("run tests", async () => {
      await page.getByText(exercise.file_contents).click()
      // Contributed under `test-my-code:ActiveEditorIsExercise` (package.json), so it
      // renders only once the extension recognises the open exercise.
      const runTests = editorActions(page).getByLabel("Run Tests", { exact: true })
      await expect(runTests).toBeVisible()
      await runTests.click()
      if (exercise.expected_result === "pass") {
        await expect(passedLocally(sidePanel)).toBeVisible()
      }
      await testResultsPage.open()
      await expect(testResultsPage.result(exercise.test_name).first()).toBeVisible()
      if (exercise.expected_result === "fail") {
        await expect(testResultsPage.result("1 of 1 tests failed.").first()).toBeVisible()
        await expect(passedLocally(sidePanel)).toBeHidden()
      }
    })

    await vsCodeTest.step("submit exercise", async () => {
      const expectedString = expectedResultInSubmissionView(exercise.expected_result)
      await expect(
        sidePanel.getByRole("heading", { name: expectedString, exact: true }),
      ).toBeHidden()
      if (exercise.expected_result === "pass") {
        await sidePanel.getByRole("button", { name: "Submit", exact: true }).click()
      } else {
        await editorActions(page).getByLabel("Submit", { exact: true }).click()
      }
      await expect(
        sidePanel.getByRole("heading", { name: expectedString, exact: true }),
      ).toBeVisible()
    })

    await vsCodeTest.step("the score, History and the Courses view agree", async () => {
      const isPassed = exercise.expected_result === "pass"
      await expect(sidePanel.getByRole("meter", { name: "Points" })).toHaveAttribute(
        "aria-valuenow",
        isPassed ? "1" : "0",
      )
      await coursesView.goto()
      await expect(coursesView.row(exercise.name)).toHaveAccessibleName(
        isPassed ? /, passed\b/ : /, not passed\b/,
        { timeout: 30_000 },
      )
      await sidePanel.getByRole("button", { name: "History" }).click()
      await expect(
        sidePanel.getByRole("listitem").filter({ hasText: "Latest" }).first(),
      ).toContainText(isPassed ? "1 / 1" : "0 / 1")
    })
  })
}

/** The editor title bar's actions; the Courses view's exercise rows carry the same labels. */
function editorActions(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Editor actions" })
}

/** The results screen's heading after an all-passing local run, which offers Submit. */
function passedLocally(sidePanel: FrameLocator): Locator {
  return sidePanel.getByRole("heading", { name: "Tests pass on your computer" })
}

function expectedResultInSubmissionView(expectedResult: "pass" | "fail"): string {
  if (expectedResult === "pass") {
    return "Passed"
  }
  return "Not passed"
}

/** The folder of the exercise whose slug ends in `name` under `root`, wherever the CLI put it. */
function exerciseFolder(root: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const entryPath = join(root, entry.name)
    if (entry.name.endsWith(name)) {
      return entryPath
    }
    const found = exerciseFolder(entryPath, name)
    if (found) {
      return found
    }
  }
  return undefined
}

vsCodeTest(
  "submitting an exercise whose source file is gone asks first",
  async ({ page, webview, projectsDir }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const course = "Python Course"
    const exercise = "01_passing_exercise"

    await vsCodeTest.step("download it into the course workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(course)
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Download")
      await coursesView.openCourseWorkspace(course)
    })

    await vsCodeTest.step("delete its source file and submit", async () => {
      const folder = exerciseFolder(projectsDir, exercise)
      expect(folder).toBeDefined()
      fs.rmSync(join(folder ?? "", "src", "passing_exercise.py"))
      await coursesView.goto()
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Submit")
      const question = page
        .locator(".monaco-dialog-box")
        .filter({ hasText: new RegExp(`is missing from \\S*${exercise}\\. Submit anyway\\?`) })
      await expect(question).toBeVisible()
      await question.getByRole("button", { name: "Cancel" }).click()
      await expect(question).toBeHidden()
      await expect(
        new TmcPage(page, webview).getSidePanel().getByRole("heading", { name: /tests/ }),
      ).toBeHidden()
    })
  },
)

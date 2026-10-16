import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"

import { courseWorkspaceFolder, courseWorkspaceSettings } from "../courseWorkspace"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TestResultsPage } from "../pages/test-results"
import { TmcPage } from "../pages/tmc"

const COURSE = "Python Course"
const EXERCISE = "01_passing_exercise"
const EXERCISE_FILE = ["src", "passing_exercise.py"]
const EXERCISE_CONTENTS = "def hello()"

vsCodeTest(
  "unsaved changes to the course workspace file stop Run Tests, with the reason",
  async ({ page, userDataDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const explorerPage = new ExplorerPage(page)
    const tmc = new TmcPage(page, webview)
    const workspaceFolder = courseWorkspaceFolder(userDataDir)
    const workspaceFile = (): string | undefined =>
      fs.readdirSync(workspaceFolder).find((f) => f.endsWith(".code-workspace"))

    await vsCodeTest.step("open the exercise in its course workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(COURSE)
      await coursesView.expand(coursesView.row(COURSE))
      await coursesView.runInlineAction(coursesView.row(EXERCISE), "Download")
      await expect(coursesView.row(EXERCISE)).toHaveAccessibleName(/, open,/)
      await coursesView.runInlineAction(coursesView.row(COURSE), "Open Course Workspace")
      await expect
        .poll(() => courseWorkspaceSettings(userDataDir))
        .toMatchObject({ "editor.inlineSuggest.enabled": false })
      await explorerPage.openPath(EXERCISE_FILE)
      await expect(page.getByText(EXERCISE_CONTENTS)).toBeVisible()
    })

    const fileName = workspaceFile() as string

    await vsCodeTest.step(
      "leave the workspace file unsaved in an editor, and turn AI on in it on disk",
      async () => {
        await tmc.runPaletteCommand("Workspaces: Open Workspace Configuration File")
        await expect(page.getByRole("tab", { name: new RegExp(fileName) })).toBeVisible()
        await page.keyboard.type(" ")
        const path = join(workspaceFolder, fileName)
        const contents = JSON.parse(fs.readFileSync(path, "utf-8"))
        contents.settings["editor.inlineSuggest.enabled"] = true
        fs.writeFileSync(path, JSON.stringify(contents, null, 2))
      },
    )

    await vsCodeTest.step("Run Tests is refused with what to fix", async () => {
      const reason =
        "AI settings in the course workspace couldn't be applied: save or revert the changes" +
        ` to ${fileName} and try again.`
      // VS Code picks the on-disk change up asynchronously; a run that beat it would go ahead.
      await expect(async () => {
        await page.getByRole("tab", { name: "passing_exercise.py" }).click()
        await page
          .getByRole("toolbar", { name: "Editor actions" })
          .getByLabel("Run Tests", { exact: true })
          .click()
        await expect(tmc.notificationToast(reason)).toBeVisible({ timeout: 5_000 })
      }).toPass()
      await expect(
        page
          .locator(".notifications-toasts .notification-toast")
          .filter({ hasText: reason })
          .getByRole("button", { name: `Open ${fileName}` }),
      ).toBeVisible()
    })
  },
)

vsCodeTest(
  "a mooc course that allows AI keeps AI assistance on in its workspace",
  async ({ page, userDataDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const explorerPage = new ExplorerPage(page)
    const testResultsPage = new TestResultsPage(page, webview)
    // backend/mooc/fixtures.ts seeds this course's policy as full_use.
    const courseTitle = "MOOC Extra Course"

    await vsCodeTest.step("open an exercise in the course's workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(courseTitle)
      await coursesView.expand(coursesView.row(courseTitle))
      const row = coursesView.row("failing_exercise")
      await coursesView.runContextMenuCommand(row, "Open")
      await expect(row).toHaveAccessibleName(/, open,/)
      await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
      await explorerPage.openPath(["src", "failing_exercise.py"])
      await expect(page.getByText("def hello()")).toBeVisible()
    })

    await vsCodeTest.step(
      "run its tests, which applies the course's AI settings first",
      async () => {
        await page.getByText("def hello()").click()
        await page
          .getByRole("toolbar", { name: "Editor actions" })
          .getByLabel("Run Tests", { exact: true })
          .click()
        await testResultsPage.open()
        await expect(testResultsPage.result("1 of 1 tests failed.").first()).toBeVisible()
      },
    )

    await vsCodeTest.step("the workspace file turns no AI setting off", async () => {
      const settings = courseWorkspaceSettings(userDataDir)
      expect(settings).toBeDefined()
      for (const section of [
        "chat.agent.enabled",
        "chat.disableAIFeatures",
        "chat.extensionTools.enabled",
        "editor.inlineSuggest.enabled",
      ]) {
        expect(settings).not.toHaveProperty([section])
      }
    })
  },
)

import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
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
    const workspaceFolder = join(
      userDataDir,
      "User",
      "globalStorage",
      "moocfi.test-my-code",
      "workspaces",
    )
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
        .poll(() => {
          const file = workspaceFile()
          return file && JSON.parse(fs.readFileSync(join(workspaceFolder, file), "utf-8")).settings
        })
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

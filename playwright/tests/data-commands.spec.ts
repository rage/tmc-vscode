import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { QuickPickPage } from "../pages/quick-pick"
import { TmcPage } from "../pages/tmc"

vsCodeTest.use({ isCoursesMoocFiEnabled: true })

// The commands that delete, move or sign out of the student's data, run in real VS Code.

const COURSE = "MOOC Python Course"
const EXERCISE = "passing_exercise"

/** The folder a downloaded exercise lives in, wherever below `root` the CLI put it. */
function findExerciseDir(root: string): string | undefined {
  if (!fs.existsSync(root)) {
    return undefined
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === EXERCISE) {
        return path
      }
      const found = findExerciseDir(path)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

async function downloadExercise(coursesView: CoursesViewPage): Promise<void> {
  await coursesView.goto()
  await coursesView.addNewMoocCourse(COURSE)
  await coursesView.expand(coursesView.row(COURSE))
  const row = coursesView.row(EXERCISE)
  await row.click()
  await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
}

vsCodeTest(
  "Wipe All Extension Data deletes the exercises and starts the extension over",
  async ({ page, projectsDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const tmc = new TmcPage(page, webview)
    await downloadExercise(coursesView)
    expect(findExerciseDir(projectsDir)).toBeDefined()

    await tmc.reloadingWindow(async () => {
      await tmc.runPaletteCommand("TestMyCode: Wipe All Extension Data...")
      const input = page.locator(".quick-input-widget input")
      await input.fill("DELETE")
      await input.press("Enter")
    })

    await expect.poll(() => findExerciseDir(projectsDir)).toBeUndefined()
    await coursesView.goto()
    await expect(coursesView.row(COURSE)).toHaveCount(0)
    await expect(
      page
        .locator('[id="workbench.parts.statusbar"]')
        .getByRole("button", { name: /not logged in/ }),
    ).toBeVisible({ timeout: 60_000 })
  },
)

vsCodeTest(
  "Move Exercises Folder moves a downloaded exercise to the chosen folder",
  async ({ page, projectsDir, vsCode, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const target = fs.mkdtempSync(join(projectsDir, "moved-"))
    await downloadExercise(coursesView)
    const before = findExerciseDir(projectsDir)
    expect(before).toBeDefined()

    // The folder picker is the OS's own dialog, out of reach of the page.
    await vsCode.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, target)
    await coursesView.runPaletteCommand("TestMyCode: Move Exercises Folder...")

    await expect.poll(() => findExerciseDir(target), { timeout: 60_000 }).toBeDefined()
    await expect(coursesView.notificationToast("Failed to move")).toBeHidden()
  },
)

vsCodeTest(
  "Delete Generated Files removes what a build left in the exercise",
  async ({ page, projectsDir, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    await downloadExercise(coursesView)
    const dir = findExerciseDir(projectsDir) ?? ""
    const generated = join(dir, "src", "__pycache__")
    fs.mkdirSync(generated, { recursive: true })
    fs.writeFileSync(join(generated, "passing_exercise.cpython-312.pyc"), "")
    await coursesView.openCourseWorkspace(COURSE)
    await new ExplorerPage(page).openPath(["src", "passing_exercise.py"])
    await page.getByText("def hello()").click()

    await new TmcPage(page, webview).runExercisePaletteCommand("TestMyCode: Delete Generated Files")

    await expect.poll(() => fs.existsSync(generated)).toBe(false)
    expect(fs.existsSync(join(dir, "src", "passing_exercise.py"))).toBe(true)
  },
)

vsCodeTest("the account menu of a logged-in student logs them out", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const quickPick = new QuickPickPage(page)
  await coursesView.goto()
  await coursesView.logInToMooc()

  await page
    .locator('[id="workbench.parts.statusbar"]')
    .getByRole("button", { name: /logged in with your MOOC\.fi account/ })
    .click()
  await quickPick.expectItem("Log Out")
  await quickPick.selectByLabel("Log Out")

  await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
})

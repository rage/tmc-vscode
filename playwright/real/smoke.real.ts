import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"

import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { QuickPickPage } from "../pages/quick-pick"
import { TestResultsPage } from "../pages/test-results"

import { completeDeviceLogin, realTest, resetRun, shot, workspaceFile } from "./harness"
import { dumpTree, exerciseDir, revealRow, toasts } from "./helpers"

const COURSE = process.env.COURSE_NAME ?? "Introduction to everything"
const EXERCISE = "python3_simple"
const FILE = "arithfuncs.py"

realTest.beforeAll(() => {
  if (!process.env.KEEP_RUN) resetRun()
})

realTest("smoke: log in, add the course, download an exercise, run its tests", async ({ page, webview, openedExternalUrls }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const explorer = new ExplorerPage(page)
  const quickPick = new QuickPickPage(page)
  const testResults = new TestResultsPage(page, webview)

  await realTest.step("log in with the device flow", async () => {
    await coursesView.goto()
    await coursesView.coursesViewWelcomeButton("Log In").click()
    await completeDeviceLogin(page, openedExternalUrls)
    await shot(page, "logged-in")
  })

  await realTest.step("add the course from the pick the login opens", async () => {
    await quickPick.waitForTitle(/Add Course/)
    await page.waitForTimeout(2000)
    console.log("ADD COURSE ROWS", await page.locator(".quick-input-widget .quick-input-list .monaco-list-row").allTextContents())
    await quickPick.selectByLabel(COURSE)
    await quickPick.expectClosed()
    await expect(coursesView.row(COURSE)).toBeVisible()
  })

  await realTest.step("download and open the exercise", async () => {
    await coursesView.expand(coursesView.row(COURSE))
    await revealRow(page, coursesView, EXERCISE)
    await dumpTree(page)
    const row = coursesView.row(EXERCISE)
    await coursesView.runContextMenuCommand(row, "Open")
    await expect(row).toHaveAccessibleName(/, open,/, { timeout: 120_000 })
    expect(fs.existsSync(join(exerciseDir(), "src", FILE))).toBe(true)
    await shot(page, "exercise-downloaded")
  })

  await realTest.step("run the tests on the stub: they fail", async () => {
    await coursesView.runInlineAction(coursesView.row(COURSE), "Open Course Workspace")
    await expect.poll(() => workspaceFile(), { timeout: 60_000 }).toBeTruthy()
    await page.waitForTimeout(3000)
    await explorer.openPath(["src", FILE])
    await expect(page.getByText("return 0").first()).toBeVisible()
    await page.getByText("return 0").first().click()
    await page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Run Tests", { exact: true }).click()
    await testResults.open()
    await expect(page.getByText(/AssertionError|0 != 3/).first()).toBeVisible({ timeout: 120_000 })
    console.log("TOASTS", await toasts(page))
    console.log("SCREENSHOT", await shot(page, "tests-run"))
  })
})

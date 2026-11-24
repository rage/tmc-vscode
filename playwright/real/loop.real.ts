import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"

import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { QuickPickPage } from "../pages/quick-pick"
import { TestResultsPage } from "../pages/test-results"
import { TmcPage } from "../pages/tmc"

import { completeDeviceLogin, realTest, resetRun, shot, workspaceFile, workspaceSettings } from "./harness"
import { dumpTree, exerciseDir, revealRow, toasts } from "./helpers"

const COURSE = process.env.COURSE_NAME ?? "Introduction to everything"
const EXERCISE = "python3_simple"
const FILE = "arithfuncs.py"

realTest.beforeAll(() => {
  process.env.SHOT_PREFIX = ""
  if (!process.env.KEEP_RUN) resetRun()
})

realTest("the mooc student loop in the real extension", async ({ page, webview, openedExternalUrls }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const explorer = new ExplorerPage(page)
  const quickPick = new QuickPickPage(page)
  const testResults = new TestResultsPage(page, webview)
  const tmc = new TmcPage(page, webview)
  const submission = tmc.getSidePanel()

  await realTest.step("log in with the device flow", async () => {
    await coursesView.goto()
    await shot(page, "logged-out-courses-view")
    await coursesView.coursesViewWelcomeButton("Log In").click()
    await completeDeviceLogin(page, openedExternalUrls)
    await shot(page, "logged-in")
  })

  await realTest.step("add the mooc course from the pick the login opens", async () => {
    await quickPick.waitForTitle(/Add Course/)
    await page.waitForTimeout(2000)
    await shot(page, "add-course-pick")
    console.log("ADD COURSE ROWS", await page.locator(".quick-input-widget .quick-input-list .monaco-list-row").allTextContents())
    await quickPick.selectByLabel(COURSE)
    await quickPick.expectClosed()
    await expect(coursesView.row(COURSE)).toBeVisible()
    await shot(page, "course-added")
  })

  await realTest.step("the tree shows chapters and exercises", async () => {
    await coursesView.expand(coursesView.row(COURSE))
    await page.waitForTimeout(1500)
    await revealRow(page, coursesView, EXERCISE)
    await dumpTree(page)
    await expect(coursesView.row(EXERCISE)).toHaveAccessibleName(/not downloaded/)
    await shot(page, "exercise-visible")
  })

  await realTest.step("download and open the exercise", async () => {
    const row = coursesView.row(EXERCISE)
    await coursesView.runContextMenuCommand(row, "Open")
    await expect(row).toHaveAccessibleName(/, open,/, { timeout: 120_000 })
    await shot(page, "exercise-downloaded")
    expect(fs.existsSync(join(exerciseDir(), "src", FILE))).toBe(true)
  })

  await realTest.step("open the course workspace: AI-off settings written", async () => {
    await coursesView.runInlineAction(coursesView.row(COURSE), "Open Course Workspace")
    await expect.poll(() => workspaceFile(), { timeout: 60_000 }).toBeTruthy()
    await expect
      .poll(() => workspaceSettings(), { timeout: 60_000 })
      .toMatchObject({ "editor.inlineSuggest.enabled": false, "chat.disableAIFeatures": true })
    await page.waitForTimeout(3000)
    await shot(page, "course-workspace")
    console.log("WORKSPACE FILE", workspaceFile(), fs.readFileSync(workspaceFile() as string, "utf-8"))
  })

  await realTest.step("open the exercise file", async () => {
    await explorer.openPath(["src", FILE])
    await expect(page.getByText("return 0").first()).toBeVisible()
    await shot(page, "exercise-file-open")
  })

  await realTest.step("run the tests: they fail", async () => {
    await page.getByText("return 0").first().click()
    const runTests = page
      .getByRole("toolbar", { name: "Editor actions" })
      .getByLabel("Run Tests", { exact: true })
    await expect(runTests).toBeVisible()
    await runTests.click()
    await page.waitForTimeout(8000)
    await shot(page, "tests-failed-notification")
    console.log("TOASTS after failing run", await toasts(page))
    await testResults.open()
    await page.waitForTimeout(1000)
    await shot(page, "tests-failed-results")
    await expect(page.getByText(/AssertionError|0 != 3/).first()).toBeVisible()
  })

  await realTest.step("submit the failing solution", async () => {
    await page.getByRole("tab", { name: FILE }).click()
    await tmc.runExercisePaletteCommand("TestMyCode: Submit Solution")
    await page.waitForTimeout(1500)
    await shot(page, "submit-fail-started")
    await expect(submission.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      /^0 \/ 1 points$/,
      { timeout: 180_000 },
    )
    await shot(page, "submit-fail-graded")
    console.log("SUBMISSION HEADINGS (fail)", await submission.getByRole("heading").allTextContents())
  })

  await realTest.step("fix and run the tests: they pass; submit from the toast", async () => {
    // Langs throttles submits to one per MINIMUM_SUBMISSION_INTERVAL (5 s); this grading takes ~2 s.
    await page.waitForTimeout(6000)
    fs.writeFileSync(join(exerciseDir(), "src", FILE), "def sum(a, b):\n    return a + b\n")
    await expect(page.getByText("return a + b").first()).toBeVisible()
    await page.getByRole("tab", { name: FILE }).click()
    await page
      .getByRole("toolbar", { name: "Editor actions" })
      .getByLabel("Run Tests", { exact: true })
      .click()
    const passed = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: `All tests of ${EXERCISE} passed.` })
    await expect(passed).toBeVisible({ timeout: 120_000 })
    await shot(page, "tests-passed")
    await passed.getByRole("button", { name: "Submit" }).click()
    await expect(submission.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      /^1 \/ 1 points$/,
      { timeout: 180_000 },
    )
    await shot(page, "submit-pass-graded")
    console.log("SUBMISSION HEADINGS (pass)", await submission.getByRole("heading").allTextContents())
  })

  await realTest.step("the tree shows the exercise passed", async () => {
    await coursesView.goto()
    await page.waitForTimeout(2000)
    await dumpTree(page)
    await shot(page, "tree-after-pass")
    await page.getByRole("tab", { name: /^Explorer/ }).first().click()
    await expect(page.locator(".explorer-folders-view").getByText(FILE)).toBeVisible()
  })

  await realTest.step("download a failing old submission", async () => {
    await explorer.runContextMenuCommand(FILE, "Download Old Submission")
    await quickPick.waitForTitle(/^Download Old Submission/)
    await page.waitForTimeout(1000)
    await shot(page, "old-submissions-pick")
    const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row")
    console.log("OLD SUBMISSION ROWS", await rows.allTextContents())
    expect(await rows.count()).toBeGreaterThanOrEqual(2)
    await rows.filter({ hasText: "(score 0)" }).first().click()
    await quickPick.expectClosed()
    await page.waitForTimeout(500)
    await shot(page, "old-submission-confirm")
    await page
      .locator(".monaco-dialog-box")
      .getByRole("button", { name: "Restore Without Submitting" })
      .click()
    await expect
      .poll(() => fs.readFileSync(join(exerciseDir(), "src", FILE), "utf-8"), { timeout: 60_000 })
      .toContain("return 0")
    await page.waitForTimeout(1500)
    await shot(page, "old-submission-restored")
  })

  await realTest.step("paste", async () => {
    await page.getByRole("tab", { name: FILE }).click()
    await tmc.runExercisePaletteCommand("TestMyCode: Share Exercise via Paste")
    const pasteToast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: /Paste link/ })
    await expect(pasteToast).toBeVisible({ timeout: 60_000 })
    await shot(page, "paste")
    const text = await pasteToast.textContent()
    console.log("PASTE TOAST", text)
    const link = /https?:\/\/\S+/.exec(text ?? "")?.[0]
    expect(link).toContain("project-331.local/shared-submissions/")
  })

  await realTest.step("reset the exercise", async () => {
    await page.getByRole("tab", { name: FILE }).click()
    await page.locator(".monaco-editor .view-lines").first().click()
    await page.keyboard.press("Control+A")
    await page.keyboard.type("def sum(a, b):\n    return 42\n")
    await page.keyboard.press("Control+S")
    await expect
      .poll(() => fs.readFileSync(join(exerciseDir(), "src", FILE), "utf-8"))
      .toContain("return 42")
    await tmc.runExercisePaletteCommand("TestMyCode: Reset Exercise")
    await page.waitForTimeout(500)
    await shot(page, "reset-confirm")
    await page
      .locator(".monaco-dialog-box")
      .getByRole("button", { name: "Reset Without Submitting" })
      .click()
    await expect
      .poll(() => fs.readFileSync(join(exerciseDir(), "src", FILE), "utf-8"), { timeout: 60_000 })
      .toContain("return 0")
    await page.waitForTimeout(1500)
    await shot(page, "reset-done")
  })
})

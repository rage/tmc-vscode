import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"

import { Student, readSrc, serverSubmissions } from "./b-common"
import { realTest, resetRun, shot } from "./harness"
import { exerciseDir } from "./helpers"

const EX = "b_history"
const NOTESTS = "b_notests"

realTest.beforeAll(() => {
  process.env.SHOT_PREFIX = "b4-"
  if (!process.env.KEEP_RUN) resetRun()
})

realTest("b4: fresh-machine open, syntax errors, no tests, per-test results, quick submits", async ({ page, webview, openedExternalUrls }) => {
  const s = new Student(page, webview, openedExternalUrls)
  const step = async (name: string, body: () => Promise<void>): Promise<void> => {
    console.log(`\n===== STEP ${name}`)
    try {
      await realTest.step(name, body)
    } catch (e) {
      console.log(`STEP FAILED ${name}:`, String(e).slice(0, 1500))
      await shot(page, `FAILED-${name.replace(/\W+/g, "-")}`)
      await page.keyboard.press("Escape")
    }
  }
  const panel = async (label: string): Promise<void> => {
    console.log(`PANEL ${label}`, (await s.submission.locator("body").innerText().catch(() => "?")).slice(0, 3000))
    console.log(`PANEL BUTTONS ${label}`, await s.submission.getByRole("button").allTextContents().catch(() => []))
  }
  const counts = async (ex: string, label: string): Promise<void> => {
    const list = (await serverSubmissions(ex)) as { kind?: string }[]
    if (Array.isArray(list)) {
      const c: Record<string, number> = {}
      for (const x of list) c[x.kind ?? "?"] = (c[x.kind ?? "?"] ?? 0) + 1
      console.log(`SERVER COUNTS ${ex} ${label}`, JSON.stringify(c), "total", list.length)
    }
  }

  await step("login, add, open on a fresh profile", async () => {
    await s.loginAndAdd()
    await s.openExercise(EX)
    await s.openWorkspace()
    await s.openSrc()
    console.log("OPENED SRC (fresh machine)", JSON.stringify(readSrc(EX)))
    await shot(page, "opened-fresh")
    await s.toastTexts()
    await counts(EX, "start")
  })

  await step("syntax error: run tests locally", async () => {
    await s.write(EX, "def sum(a, b)\n    return a +\n", "return a +")
    await s.focusEditor()
    await page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Run Tests", { exact: true }).click()
    await page.waitForTimeout(12000)
    await shot(page, "syntax-local-tests")
    await s.toastTexts()
  })

  await step("syntax error: submit", async () => {
    await s.clearToasts()
    await s.palette("TestMyCode: Submit Solution")
    await expect(s.submission.getByRole("meter", { name: "Points" })).toBeVisible({ timeout: 180_000 })
    await page.waitForTimeout(3000)
    await shot(page, "syntax-submitted")
    await panel("syntax")
    await s.toastTexts()
    await counts(EX, "after syntax submit")
  })

  await step("syntax error: expand panel details", async () => {
    for (const b of await s.submission.getByRole("button", { expanded: false }).all()) {
      await b.click().catch(() => undefined)
    }
    await page.waitForTimeout(800)
    await shot(page, "syntax-details")
    await panel("syntax expanded")
  })

  await step("failing test: per-test results", async () => {
    await page.waitForTimeout(3000)
    await s.write(EX, "def sum(a, b):\n    return a - b  # per-test\n", "per-test")
    await s.submitAndWait(/^0 \/ 1 points$/)
    await page.waitForTimeout(2500)
    await shot(page, "failing-graded")
    await panel("failing")
    for (const b of await s.submission.getByRole("button", { expanded: false }).all()) {
      await b.click().catch(() => undefined)
    }
    await page.waitForTimeout(800)
    await shot(page, "failing-details")
    await panel("failing expanded")
  })

  await step("passing: per-test results", async () => {
    await page.waitForTimeout(3000)
    await s.write(EX, "def sum(a, b):\n    return a + b  # pass b4\n", "pass b4")
    await s.submitAndWait(/^1 \/ 1 points$/)
    await page.waitForTimeout(2500)
    await shot(page, "passing-graded")
    await panel("passing")
    console.log("STATUSBAR", await s.statusBarText())
  })

  await step("quick consecutive submits: palette x2 then panel button", async () => {
    await s.clearToasts()
    await s.write(EX, "def sum(a, b):\n    return a + b  # quick 1\n", "quick 1")
    const t0 = Date.now()
    await s.palette("TestMyCode: Submit Solution")
    await page.waitForTimeout(300)
    await s.palette("TestMyCode: Submit Solution")
    await page.waitForTimeout(300)
    const again = s.submission.getByRole("button", { name: /Submit/ })
    console.log("PANEL SUBMIT BUTTONS DURING", await again.allTextContents().catch(() => []))
    await shot(page, "quick-during")
    await s.toastTexts()
    await panel("during")
    await expect(s.submission.getByRole("meter", { name: "Points" })).toHaveAttribute("aria-valuetext", /^1 \/ 1 points$/, { timeout: 180_000 })
    console.log("quick submit graded after", (Date.now() - t0) / 1000, "s")
    await page.waitForTimeout(1500)
    await shot(page, "quick-after")
    await s.toastTexts()
    await counts(EX, "after quick")
  })

  await step("submit, change code, submit again right after grading", async () => {
    await s.clearToasts()
    await s.write(EX, "def sum(a, b):\n    return a + b  # quick 2\n", "quick 2")
    await s.palette("TestMyCode: Submit Solution")
    await expect(s.submission.getByText(/quick|Grading|Waiting|Submitting|Sending/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => undefined)
    await s.write(EX, "def sum(a, b):\n    return a + b  # edited while grading\n", "edited while grading")
    await shot(page, "edited-while-grading")
    await panel("edited while grading")
    await page.waitForTimeout(20000)
    await shot(page, "edited-while-grading-after")
    await panel("edited while grading after")
    await counts(EX, "after edit-while-grading")
  })

  await step("resubmit unchanged code", async () => {
    await s.clearToasts()
    await s.palette("TestMyCode: Submit Solution")
    await page.waitForTimeout(2500)
    if (await s.dialog().isVisible()) {
      await s.dialogText()
      await shot(page, "resubmit-unchanged-dialog")
      await page.keyboard.press("Escape")
    } else {
      await shot(page, "resubmit-unchanged")
      await page.waitForTimeout(20000)
      await s.toastTexts()
    }
    await counts(EX, "after unchanged resubmit")
  })

  await step("history: find the newest graded among 20 backups", async () => {
    await s.openHistory("history-b4")
    await page.locator(".quick-input-widget input").fill("Passed")
    await page.waitForTimeout(800)
    await shot(page, "history-filter-passed")
    console.log("FILTERED ROWS", await s.historyRows())
    await page.keyboard.press("Escape")
  })

  await step("no-tests exercise: open, run tests, submit", async () => {
    await s.openExercise(NOTESTS)
    const dir = exerciseDir("introduction-to-everything", NOTESTS)
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else files.push(p.slice(dir.length))
      }
    }
    walk(dir)
    console.log("NOTESTS FILES", files)
    await s.coursesView.goto()
    await shot(page, "notests-opened")
    const src = files.find((f) => /\.(py|java|c|R|cs)$/.test(f) && !/test/i.test(f))
    console.log("NOTESTS SRC", src)
    await page.keyboard.press("Control+P")
    await page.keyboard.type(src ? src.split("/").pop()! : "notests")
    await page.waitForTimeout(800)
    await page.keyboard.press("Enter")
    await page.waitForTimeout(1500)
    await shot(page, "notests-src")
    await page.locator(".monaco-editor .view-lines").first().click()
    await page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Run Tests", { exact: true }).click().catch((e) => console.log("no run tests", String(e).slice(0, 200)))
    await page.waitForTimeout(12000)
    await shot(page, "notests-local-tests")
    await s.toastTexts()
    await s.clearToasts()
    await page.locator(".monaco-editor .view-lines").first().click()
    await s.tmc.runExercisePaletteCommand("TestMyCode: Submit Solution")
    await expect(s.submission.getByRole("meter", { name: "Points" })).toBeVisible({ timeout: 180_000 })
    await page.waitForTimeout(3000)
    await shot(page, "notests-submitted")
    await panel("notests")
    await s.toastTexts()
    await counts(NOTESTS, "after submit")
  })

  await step("tree and test results view", async () => {
    await s.tree()
    await shot(page, "tree-final")
    await page.keyboard.press("F1")
    await page.locator(".quick-input-widget input").fill(">Testing: Focus on Test Results View")
    await page.waitForTimeout(500)
    await page.keyboard.press("Enter")
    await page.waitForTimeout(1500)
    await shot(page, "test-results-view")
  })
})

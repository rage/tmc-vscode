import { expect } from "@playwright/test"

import { Student, readSrc, serverSubmissions } from "./b-common"
import { realTest, shot } from "./harness"

// Continues b-3's profile (KEEP_RUN=1): b_tries is out of tries and open in the course workspace.
const EX = "b_tries"

realTest.use({ courseWorkspace: "introduction-to-everything" })
realTest.beforeAll(() => {
  process.env.SHOT_PREFIX = "b3b-"
})

realTest("b3b: out of tries, after a restart", async ({ page, webview, openedExternalUrls }) => {
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

  await step("reopen", async () => {
    await page.waitForTimeout(8000)
    await shot(page, "restarted")
    await s.explorer.openPath([EX, "src", "arithfuncs.py"]).catch(async () => s.openSrc())
    await page.waitForTimeout(1500)
    console.log("STATUSBAR", await s.statusBarText())
    console.log("SRC", readSrc(EX))
    await shot(page, "src-open")
  })

  await step("tree row actions when out of tries", async () => {
    await s.coursesView.goto()
    await page.waitForTimeout(1000)
    const row = s.coursesView.row(EX)
    await row.hover()
    const inline = await row.locator(".actions .action-label").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
    console.log("INLINE ACTIONS", inline)
    await row.click({ button: "right" })
    await page.waitForTimeout(800)
    await shot(page, "tree-context-menu")
    console.log("CONTEXT MENU", await page.locator(".context-view .action-label").allTextContents())
    await page.keyboard.press("Escape")
  })

  await step("paste while out of tries", async () => {
    await s.palette("TestMyCode: Share Exercise via Paste")
    await page.waitForTimeout(6000)
    await shot(page, "paste-out-of-tries")
    await s.toastTexts()
    await s.clearToasts()
  })

  await step("reset while out of tries", async () => {
    await s.palette("TestMyCode: Reset Exercise")
    await page.waitForTimeout(1500)
    if (await s.dialog().isVisible()) {
      await s.dialogText()
      await shot(page, "reset-out-of-tries-confirm")
      await s.dialog().getByRole("button", { name: /Back Up and Reset|^Reset$/ }).first().click()
      await page.waitForTimeout(5000)
    }
    await shot(page, "reset-out-of-tries-done")
    console.log("SRC", readSrc(EX))
  })

  await step("history when out of tries; restore newest graded", async () => {
    await s.openHistory("history-out-of-tries")
    const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row")
    await rows.filter({ hasText: "Latest submission" }).first().click()
    await page.waitForTimeout(1500)
    if (await s.dialog().isVisible()) {
      await s.dialogText()
      await s.dialog().getByRole("button", { name: /Without Backup|^Restore$/ }).first().click()
    }
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).toContain("try 3")
    await shot(page, "restored-latest-graded")
    await s.toastTexts()
    await serverSubmissions(EX)
  })

  await step("model solution", async () => {
    await s.palette("TestMyCode: Show Exercise Actions...")
    await page.waitForTimeout(1500)
    await shot(page, "exercise-actions")
    console.log("EXERCISE ACTIONS", await page.locator(".quick-input-widget .quick-input-list .monaco-list-row").allTextContents())
    await page.keyboard.press("Escape")
  })
})

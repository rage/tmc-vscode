import { expect } from "@playwright/test"

import { Student, readSrc, serverExercise, serverSubmissions } from "./b-common"
import { realTest, resetRun, shot } from "./harness"

const EX = "b_tries"

realTest.beforeAll(() => {
  process.env.SHOT_PREFIX = "b3-"
  if (!process.env.KEEP_RUN) resetRun()
})

realTest("b3: max tries 2, pastes/backups vs tries, out of tries", async ({ page, webview, openedExternalUrls }) => {
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
  const server = async (label: string): Promise<void> => {
    console.log(`--- SERVER ${label}`)
    await serverSubmissions(EX)
    await serverExercise(EX)
  }

  await step("login, add, open", async () => {
    await s.loginAndAdd()
    await s.tree()
    await shot(page, "tree-start")
    await s.openExercise(EX)
    await s.openWorkspace()
    await s.openSrc()
    await server("start")
  })

  await step("paste + backup before any submission", async () => {
    await s.write(EX, "def sum(a, b):\n    return 1  # paste before submit\n", "paste before submit")
    await s.palette("TestMyCode: Share Exercise via Paste")
    await expect(page.locator(".notifications-toasts .notification-toast").filter({ hasText: /paste link/i })).toBeVisible({ timeout: 60_000 })
    await shot(page, "paste-before")
    await s.clearToasts()
    await s.write(EX, "def sum(a, b):\n    return 2  # backup before submit\n", "backup before submit")
    await s.palette("TestMyCode: Reset Exercise")
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await s.dialog().getByRole("button", { name: "Back Up and Reset" }).click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).toContain("return 0")
    await page.waitForTimeout(1500)
    await server("after paste + backup")
    await s.tree()
    await shot(page, "tree-after-paste-backup")
    console.log("STATUSBAR", await s.statusBarText())
  })

  const where = async (label: string): Promise<void> => {
    console.log(`--- WHERE ${label}`)
    console.log("STATUSBAR", await s.statusBarText())
    console.log("PANEL", (await s.submission.locator("body").innerText().catch(() => "?")).slice(0, 1500))
    console.log("PANEL BUTTONS", await s.submission.getByRole("button").allTextContents().catch(() => []))
    await s.tree()
  }

  await step("submit 1 (fails)", async () => {
    await s.submitAndWait(/^0 \/ 1 points$/)
    await page.waitForTimeout(1500)
    await shot(page, "submit1")
    await where("after submit 1")
    await server("after submit 1")
  })

  await step("paste + backup between tries", async () => {
    await s.write(EX, "def sum(a, b):\n    return 3  # paste between\n", "paste between")
    await s.palette("TestMyCode: Share Exercise via Paste")
    await expect(page.locator(".notifications-toasts .notification-toast").filter({ hasText: /paste link/i })).toBeVisible({ timeout: 60_000 })
    await s.clearToasts()
    await s.write(EX, "def sum(a, b):\n    return 4  # backup between\n", "backup between")
    await s.palette("TestMyCode: Reset Exercise")
    await expect(s.dialog()).toBeVisible()
    await s.dialog().getByRole("button", { name: "Back Up and Reset" }).click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).toContain("return 0")
    await page.waitForTimeout(1500)
    await server("after paste + backup between")
    await s.tree()
    await shot(page, "tree-between")
  })

  await step("submit 2 (fails)", async () => {
    await page.waitForTimeout(3000)
    await s.write(EX, "def sum(a, b):\n    return a - b  # try 2\n", "try 2")
    await s.submitAndWait(/^0 \/ 1 points$/)
    await page.waitForTimeout(2000)
    await shot(page, "submit2")
    await where("after submit 2")
    await server("after submit 2")
  })

  await step("last try: confirm shown, cancel sends nothing", async () => {
    await s.write(EX, "def sum(a, b):\n    return a * b  # try 3\n", "try 3")
    await s.palette("TestMyCode: Submit Solution")
    await expect(s.dialog()).toBeVisible({ timeout: 15_000 })
    await s.dialogText()
    console.log("DIALOG BUTTONS", await s.dialog().getByRole("button").allTextContents())
    await shot(page, "last-try-confirm")
    await s.dialog().getByRole("button", { name: "Cancel" }).click()
    await page.waitForTimeout(4000)
    await shot(page, "last-try-cancelled")
    await s.toastTexts()
    await server("after cancelled last try")
  })

  await step("last try via panel Submit Again: confirm, submit", async () => {
    const again = s.submission.getByRole("button", { name: /Submit Again/ })
    if (await again.isVisible().catch(() => false)) {
      await again.click()
    } else {
      console.log("NO Submit Again in panel; using palette")
      await s.palette("TestMyCode: Submit Solution")
    }
    await expect(s.dialog()).toBeVisible({ timeout: 15_000 })
    await s.dialogText()
    await s.dialog().getByRole("button", { name: "Submit" }).click()
    await expect(s.submission.getByRole("meter", { name: "Points" })).toHaveAttribute("aria-valuetext", /^0 \/ 1 points$/, { timeout: 180_000 })
    await page.waitForTimeout(2500)
    await shot(page, "submit3-out-of-tries")
    await where("after submit 3")
    await server("after submit 3")
  })

  await step("tree and status after out of tries", async () => {
    await s.tree()
    await shot(page, "tree-out-of-tries")
    await page.getByRole("tab", { name: /^Explorer/ }).first().click()
    await page.waitForTimeout(800)
    await shot(page, "explorer-out-of-tries")
  })

  await step("submit a 4th time (out of tries)", async () => {
    await page.waitForTimeout(5000)
    await s.write(EX, "def sum(a, b):\n    return a + b  # try 4 correct\n", "try 4 correct")
    await s.palette("TestMyCode: Submit Solution")
    await page.waitForTimeout(5000)
    await shot(page, "submit3-refused")
    await s.toastTexts()
    console.log("PANEL3", (await s.submission.locator("body").innerText().catch(() => "?")).slice(0, 1500))
    await server("after submit 3 attempt")
  })

  await step("run tests locally when out of tries: offers Submit?", async () => {
    await s.clearToasts()
    await s.focusEditor()
    await page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Run Tests", { exact: true }).click()
    await page.waitForTimeout(10000)
    await shot(page, "tests-pass-out-of-tries")
    await s.toastTexts()
    const btns = await page.locator(".notifications-toasts .notification-toast").getByRole("button").allTextContents()
    console.log("TOAST BUTTONS", btns)
  })

  await step("editor actions and palette entries when out of tries", async () => {
    await s.focusEditor()
    const actions = await page.getByRole("toolbar", { name: "Editor actions" }).getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
    console.log("EDITOR ACTIONS", actions)
    await page.keyboard.press("F1")
    await page.locator(".quick-input-widget input").fill(">TestMyCode:")
    await page.waitForTimeout(800)
    await shot(page, "palette-out-of-tries")
    console.log("PALETTE", await page.locator(".quick-input-widget .quick-input-list .monaco-list-row").allTextContents())
    await page.keyboard.press("Escape")
  })

  await step("paste while out of tries", async () => {
    await s.palette("TestMyCode: Share Exercise via Paste")
    await page.waitForTimeout(6000)
    await shot(page, "paste-out-of-tries")
    await s.toastTexts()
    await s.clearToasts()
  })

  await step("reset with backup while out of tries", async () => {
    await s.palette("TestMyCode: Reset Exercise")
    await page.waitForTimeout(1000)
    if (await s.dialog().isVisible()) {
      await s.dialogText()
      await shot(page, "reset-out-of-tries-confirm")
      await s.dialog().getByRole("button", { name: /Back Up and Reset/ }).click()
      await page.waitForTimeout(5000)
    }
    await shot(page, "reset-out-of-tries-done")
    await s.toastTexts()
    console.log("SRC", readSrc(EX))
  })

  await step("history when out of tries", async () => {
    await s.openHistory("history-out-of-tries")
    await page.keyboard.press("Escape")
    await server("final")
  })

  await step("course home webview", async () => {
    await s.coursesView.goto()
    await s.coursesView.row("Introduction to everything").click()
    await page.waitForTimeout(4000)
    await shot(page, "course-home")
    const txt = await webview.locator("body").innerText().catch(() => "?")
    console.log("COURSE HOME", txt.slice(0, 3000))
  })
})

import { expect } from "@playwright/test"

import { Student, readSrc, serverExercise, serverSubmissions } from "./b-common"
import { realTest, resetRun, shot } from "./harness"

const EX = "b_history"

realTest.beforeAll(() => {
  process.env.SHOT_PREFIX = "b1-"
  if (!process.env.KEEP_RUN) resetRun()
})

realTest("b1: submission history, restore, reset, paste", async ({ page, webview, openedExternalUrls }) => {
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

  await step("login, add, open", async () => {
    await s.loginAndAdd()
    await s.openExercise(EX)
    await s.openWorkspace()
    await s.openSrc()
    console.log("STUB", readSrc(EX))
    await shot(page, "opened")
  })

  await step("history before any submission", async () => {
    await s.paletteKeepOpen("TestMyCode: Download Old Submission")
    await page.waitForTimeout(4000)
    await shot(page, "history-empty")
    await s.toastTexts()
    await page.keyboard.press("Escape")
  })

  await step("submit 1: stub, fails", async () => {
    await s.submitAndWait(/^0 \/ 1 points$/)
    await shot(page, "submit1-graded")
    console.log("PANEL1", (await s.submission.locator("body").innerText()).slice(0, 2000))
  })

  await step("submit 2: wrong", async () => {
    await page.waitForTimeout(6000)
    await s.write(EX, "def sum(a, b):\n    return a - b  # attempt 2\n", "attempt 2")
    await s.submitAndWait(/^0 \/ 1 points$/)
    await shot(page, "submit2-graded")
  })

  await step("submit 3: correct", async () => {
    await page.waitForTimeout(6000)
    await s.write(EX, "def sum(a, b):\n    return a + b  # attempt 3\n", "attempt 3")
    await s.submitAndWait(/^1 \/ 1 points$/)
    await shot(page, "submit3-graded")
    console.log("PANEL3", (await s.submission.locator("body").innerText()).slice(0, 2000))
    console.log("STATUSBAR", await s.statusBarText())
  })

  await step("paste", async () => {
    await s.write(EX, "def sum(a, b):\n    return a + b  # pasted version\n", "pasted version")
    await s.palette("TestMyCode: Share Exercise via Paste")
    const toast = page.locator(".notifications-toasts .notification-toast").filter({ hasText: /paste link/i })
    await expect(toast).toBeVisible({ timeout: 60_000 })
    await shot(page, "paste-toast")
    const text = (await toast.textContent()) ?? ""
    console.log("PASTE TOAST", text)
    const before = (await openedExternalUrls()).length
    await toast.getByRole("button", { name: "Open in Browser" }).click()
    await page.waitForTimeout(1500)
    const linkProtection = page.locator(".monaco-dialog-box").filter({ hasText: "open the external website" })
    if (await linkProtection.isVisible()) {
      await shot(page, "paste-link-protection")
      await linkProtection.getByRole("button", { name: "Open", exact: true }).click()
      await page.waitForTimeout(1000)
    }
    const urls = await openedExternalUrls()
    console.log("OPENED URLS after paste", urls.slice(before))
    process.env.B_PASTE_URL = urls.slice(before)[0] ?? /https?:\/\/\S+/.exec(text)?.[0] ?? ""
    console.log("B_PASTE_URL", process.env.B_PASTE_URL)
  })

  await step("history after 3 submissions + paste", async () => {
    const rows = await s.openHistory("history-3sub-1paste")
    console.log("ROWS", rows.length)
    await page.keyboard.press("Escape")
  })

  await step("restore oldest WITH backup", async () => {
    await s.write(EX, "def sum(a, b):\n    return a + b  # unsaved work A\n", "unsaved work A")
    await s.openHistory("history-before-restore-backup")
    const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row")
    await rows.last().click()
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await shot(page, "restore-confirm")
    await s.dialog().getByRole("button", { name: "Back Up and Restore" }).click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).not.toContain("unsaved work A")
    await page.waitForTimeout(2000)
    console.log("AFTER RESTORE W/ BACKUP", readSrc(EX))
    await shot(page, "restored-with-backup")
    await s.toastTexts()
    console.log("STATUSBAR", await s.statusBarText())
  })

  await step("restore WITHOUT backup", async () => {
    await s.write(EX, "def sum(a, b):\n    return a + b  # unsaved work B\n", "unsaved work B")
    await s.openHistory("history-after-backup-restore")
    const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row")
    // the graded passing one
    await rows.filter({ hasText: /1\/1|Graded \(1/ }).first().click()
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await s.dialog().getByRole("button", { name: "Restore Without Backup" }).click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).not.toContain("unsaved work B")
    await page.waitForTimeout(2000)
    console.log("AFTER RESTORE W/O BACKUP", readSrc(EX))
    await shot(page, "restored-without-backup")
  })

  await step("restore a backup then restore unchanged (no-change dialog)", async () => {
    await s.openHistory("history-pick-backup")
    const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row")
    await rows.filter({ hasText: /Backup/ }).first().click()
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await shot(page, "restore-backup-confirm")
    const buttons = await s.dialog().getByRole("button").allTextContents()
    console.log("BUTTONS", buttons)
    await s.dialog().getByRole("button", { name: /Without Backup|^Restore$/ }).first().click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).toContain("unsaved work A")
    await page.waitForTimeout(1500)
    console.log("AFTER RESTORE OF BACKUP", readSrc(EX))
    await shot(page, "backup-restored")
  })

  await step("reset WITH backup", async () => {
    await s.write(EX, "def sum(a, b):\n    return a + b  # unsaved work C\n", "unsaved work C")
    await s.palette("TestMyCode: Reset Exercise")
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await shot(page, "reset-confirm")
    await s.dialog().getByRole("button", { name: "Back Up and Reset" }).click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).toContain("return 0")
    await page.waitForTimeout(1500)
    await shot(page, "reset-with-backup")
    console.log("STATUSBAR", await s.statusBarText())
  })

  await step("reset WITHOUT backup", async () => {
    await s.write(EX, "def sum(a, b):\n    return a + b  # unsaved work D\n", "unsaved work D")
    await s.palette("TestMyCode: Reset Exercise")
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await s.dialog().getByRole("button", { name: "Reset Without Backup" }).click()
    await expect.poll(() => readSrc(EX), { timeout: 60_000 }).toContain("return 0")
    await page.waitForTimeout(1500)
    await shot(page, "reset-without-backup")
  })

  await step("reset an unchanged template", async () => {
    await s.palette("TestMyCode: Reset Exercise")
    await page.waitForTimeout(1000)
    if (await s.dialog().isVisible()) {
      await s.dialogText()
      await shot(page, "reset-template-confirm")
      await page.keyboard.press("Escape")
    } else {
      await shot(page, "reset-template-nodialog")
      await s.toastTexts()
    }
  })

  await step("final history + server", async () => {
    await s.openHistory("history-final")
    await page.keyboard.press("Escape")
    await serverSubmissions(EX)
    await serverExercise(EX)
    await s.tree()
    await shot(page, "tree-final")
    console.log("STATUSBAR", await s.statusBarText())
  })

  await step("unsaved-in-editor edits before reset w/o backup", async () => {
    // A dirty editor buffer (not saved to disk) — does reset-without-backup warn about it?
    await s.focusEditor()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("\n# typed but never saved\n")
    await page.waitForTimeout(500)
    await s.palette("TestMyCode: Reset Exercise")
    await expect(s.dialog()).toBeVisible()
    await s.dialogText()
    await shot(page, "reset-dirty-confirm")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(500)
    console.log("DISK AFTER CANCEL", readSrc(EX))
  })
})

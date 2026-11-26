import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"
import type { FrameLocator, Page } from "@playwright/test"

import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { QuickPickPage } from "../pages/quick-pick"
import { TmcPage } from "../pages/tmc"

import { B, completeDeviceLogin, dirs, shot, workspaceFile } from "./harness"
import { dumpTree, exerciseDir, revealRow, toasts } from "./helpers"

export const COURSE = "Introduction to everything"
export const SLUG = "introduction-to-everything"
export const FILE = "arithfuncs.py"
/** Exercise ids by name, as scripts/setup-course.sh records them in scripts/ids.env. */
export const IDS: Record<string, string> = {
  python3_simple: process.env.EXERCISE_PYTHON3_SIMPLE ?? "",
  python3_mockio: process.env.EXERCISE_PYTHON3_MOCKIO ?? "",
}

export function srcFile(exercise: string): string {
  return join(exerciseDir(SLUG, exercise), "src", FILE)
}

export function readSrc(exercise: string): string {
  return fs.readFileSync(srcFile(exercise), "utf-8")
}

/** The access token the CLI stored; read only, so it never rotates the refresh token. */
export function accessToken(): string {
  const found: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.startsWith("credentials_mooc")) found.push(p)
    }
  }
  walk(dirs.config)
  expect(found.length, `credentials in ${dirs.config}`).toBeGreaterThan(0)
  const creds = JSON.parse(fs.readFileSync(found[0] as string, "utf-8"))
  const tok = creds.access_token ?? creds.token?.access_token ?? creds.token?.access_token?.secret
  if (typeof tok === "string") return tok
  return JSON.stringify(creds).match(/"access_token"\s*:\s*"([^"]+)"/)?.[1] as string
}

export async function client(path: string): Promise<unknown> {
  const res = await fetch(`${B}/exercise-services/client/${path}`, {
    headers: { authorization: `Bearer ${accessToken()}` },
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

export async function serverSubmissions(exercise: string): Promise<unknown> {
  const r = (await client(`exercises/${IDS[exercise]}/submissions`)) as { status: number; body: unknown }
  console.log(`SERVER SUBMISSIONS ${exercise} (${r.status})`, JSON.stringify(r.body, null, 1))
  return r.body
}

export async function serverExercise(exercise: string): Promise<unknown> {
  const r = (await client(`exercises/${IDS[exercise]}`)) as { status: number; body: unknown }
  const s = JSON.stringify(r.body)
  console.log(`SERVER EXERCISE ${exercise} (${r.status})`, s.length > 3000 ? s.slice(0, 3000) + "…" : s)
  return r.body
}

export class Student {
  coursesView: CoursesViewPage
  explorer: ExplorerPage
  quickPick: QuickPickPage
  tmc: TmcPage
  submission: FrameLocator

  constructor(
    public page: Page,
    webview: FrameLocator,
    public openedExternalUrls: () => Promise<string[]>,
  ) {
    this.coursesView = new CoursesViewPage(page, webview)
    this.explorer = new ExplorerPage(page)
    this.quickPick = new QuickPickPage(page)
    this.tmc = new TmcPage(page, webview)
    this.submission = this.tmc.getSidePanel()
  }

  async loginAndAdd(): Promise<void> {
    const { page, coursesView, quickPick } = this
    await coursesView.goto()
    await coursesView.coursesViewWelcomeButton("Log In").click()
    await completeDeviceLogin(page, this.openedExternalUrls)
    await quickPick.waitForTitle(/Add Course/)
    await page.waitForTimeout(1500)
    await quickPick.selectByLabel(COURSE)
    await quickPick.expectClosed()
    await expect(coursesView.row(COURSE)).toBeVisible()
    await coursesView.expand(coursesView.row(COURSE))
    await page.waitForTimeout(1500)
  }

  async openExercise(exercise: string): Promise<void> {
    const { page, coursesView } = this
    await coursesView.goto()
    await revealRow(page, coursesView, exercise)
    const row = coursesView.row(exercise)
    await coursesView.runContextMenuCommand(row, "Open")
    await expect(row).toHaveAccessibleName(/, open,/, { timeout: 120_000 })
    expect(fs.existsSync(srcFile(exercise)), srcFile(exercise)).toBe(true)
  }

  async openWorkspace(): Promise<void> {
    const { page, coursesView } = this
    await coursesView.goto()
    await coursesView.runInlineAction(coursesView.row(COURSE), "Open Course Workspace")
    await expect.poll(() => workspaceFile(), { timeout: 60_000 }).toBeTruthy()
    await page.waitForTimeout(4000)
  }

  async openSrc(): Promise<void> {
    await this.explorer.openPath(["src", FILE])
    await expect(this.page.getByRole("tab", { name: FILE })).toBeVisible()
  }

  async focusEditor(): Promise<void> {
    await this.page.getByRole("tab", { name: FILE }).first().click()
    await this.page.locator(".monaco-editor .view-lines").first().click()
  }

  /** Replaces the editor's text as a student would (select all, paste-like insert, save) and waits for the disk. */
  async write(exercise: string, text: string, marker: string): Promise<void> {
    await this.focusEditor()
    await this.page.keyboard.press("Control+A")
    await this.page.keyboard.insertText(text)
    await this.page.keyboard.press("Control+S")
    await expect(this.page.locator(".monaco-editor .view-lines").getByText(marker).first()).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => readSrc(exercise), { timeout: 15_000 }).toContain(marker)
    if (readSrc(exercise) !== text) console.log("WRITE MISMATCH", JSON.stringify(readSrc(exercise)))
  }

  async palette(title: string): Promise<void> {
    await this.focusEditor()
    // Submit Solution is hidden once out of tries, so wait for an action that always shows.
    await expect(
      this.page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Run Tests", { exact: true }),
    ).toBeVisible()
    await this.tmc.runPaletteCommand(title)
  }

  async submitAndWait(points: RegExp): Promise<void> {
    await this.palette("TestMyCode: Submit Solution")
    await expect(this.submission.getByRole("meter", { name: "Points" })).toHaveAttribute("aria-valuetext", points, {
      timeout: 180_000,
    })
  }

  async toastTexts(): Promise<string[]> {
    const t = await toasts(this.page)
    console.log("TOASTS", JSON.stringify(t))
    return t
  }

  async clearToasts(): Promise<void> {
    await this.page.keyboard.press("Escape")
    const clear = this.page.locator(".notifications-toasts .codicon-notifications-clear-all")
    for (const t of await this.page.locator(".notifications-toasts .notification-toast").all()) {
      await t.hover().catch(() => undefined)
      await t.locator(".codicon-notifications-clear").first().click({ timeout: 1000 }).catch(() => undefined)
    }
    void clear
  }

  async statusBarText(): Promise<string> {
    return (await this.page.locator('[id="workbench\\.parts\\.statusbar"]').innerText()).replace(/\s+/g, " ")
  }

  /** Opens Download Old Submission and returns the picker's rows; leaves the picker open. */
  /** Runs a palette command that itself opens a quick pick, so the palette never closes. */
  async paletteKeepOpen(title: string): Promise<void> {
    await this.focusEditor()
    await expect(
      this.page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Run Tests", { exact: true }),
    ).toBeVisible()
    await this.page.keyboard.press("F1")
    const palette = this.page.locator(".quick-input-widget")
    await palette.locator("input").fill(`>${title}`)
    await palette.locator(".quick-input-list .monaco-list-row").filter({ hasText: title }).first().click()
  }

  async openHistory(name: string): Promise<string[]> {
    await this.paletteKeepOpen("TestMyCode: Download Old Submission")
    await this.quickPick.waitForTitle(/^Download Old Submission/)
    await this.page.waitForTimeout(1000)
    await shot(this.page, name)
    const rows = await this.historyRows()
    console.log(`HISTORY ${name}`, JSON.stringify(rows, null, 1))
    return rows
  }

  async historyRows(): Promise<string[]> {
    return this.page
      .locator(".quick-input-widget .quick-input-list .monaco-list-row")
      .evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "") + " || " + (e.textContent ?? "")))
  }

  dialog() {
    return this.page.locator(".monaco-dialog-box")
  }

  async dialogText(): Promise<string> {
    const t = (await this.dialog().innerText()).replace(/\s+/g, " ")
    console.log("DIALOG", t)
    return t
  }

  async tree(): Promise<void> {
    await this.coursesView.goto()
    await this.page.waitForTimeout(1000)
    await dumpTree(this.page)
  }
}

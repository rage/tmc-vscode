import * as fs from "fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

import { test as base, _electron as electron, expect } from "@playwright/test"
import type { ElectronApplication, FrameLocator, Page } from "@playwright/test"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"

import { productionApi } from "../../config"
import { getLangsCLIForPlatform, getPlatform } from "../../src/utilities/env"

/** This checkout, built with BACKEND=mockTmcLocalMooc. */
export const WT = fs.realpathSync(process.env.WT ?? join(__dirname, "..", ".."))
export const MOOC_ROOT_URL = process.env.E2E_MOOC_ROOT_URL ?? "http://project-331.local"
export const B = `${MOOC_ROOT_URL}/api/v0`

/**
 * The seeded student this run logs in as. sp331 revokes a whole refresh-token family on reuse,
 * so two runs sharing a student log each other out: every concurrent run needs its own.
 */
export const STUDENT = process.env.E2E_STUDENT ?? ""
if (!STUDENT) throw new Error("Set E2E_STUDENT (e.g. student1); see the README")
export const STUDENT_PASSWORD = process.env.E2E_STUDENT_PASSWORD ?? STUDENT

/** Everything one run writes: VS Code user data, CLI config, exercises, screenshots. */
export const OUT = process.env.E2E_OUT ?? join(__dirname, "out", STUDENT)
export const RUN = join(OUT, "run")
export const SCREENS = join(OUT, "screens")

// The extension looks the CLI up by its pinned filename (TMC_LANGS_RUST_VERSION in config.js),
// whatever version the binary is.
const CLI_NAME =
  process.env.E2E_CLI_NAME ??
  getLangsCLIForPlatform(getPlatform(), JSON.parse(productionApi.__TMC_LANGS_VERSION__) as string)
export const CLI = process.env.E2E_CLI ?? join(WT, "backend", "cli", CLI_NAME)

export const dirs = {
  config: join(RUN, "config"),
  projects: join(RUN, "projects"),
  userData: join(RUN, "user-data"),
  // A shared, pre-seeded folder (E2E_EXTENSIONS_DIR) keeps language extensions such as Python across resets.
  extensions: process.env.E2E_EXTENSIONS_DIR ?? join(RUN, "extensions"),
}

/** Starts this run from a clean, logged-out VS Code profile. Skip it (KEEP_RUN=1) to continue a previous spec's state. */
export function resetRun(): void {
  fs.rmSync(RUN, { recursive: true, force: true })
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.mkdirSync(join(dirs.userData, "User"), { recursive: true })
  fs.writeFileSync(
    join(dirs.userData, "User", "settings.json"),
    JSON.stringify({ "window.dialogStyle": "custom", "workbench.startupEditor": "none", "testMyCode.logLevel": "verbose" }),
  )
  // Seeded so the extension never downloads one: its download URL is the mock on :4001.
  const cliDir = join(dirs.userData, "User", "globalStorage", "moocfi.test-my-code", "cli")
  fs.mkdirSync(cliDir, { recursive: true })
  fs.copyFileSync(CLI, join(cliDir, CLI_NAME))
  fs.chmodSync(join(cliDir, CLI_NAME), 0o755)
  // The extension verifies the binary against this file, so it must describe the copy, not the release.
  const digest = createHash("sha256").update(fs.readFileSync(CLI)).digest("hex")
  fs.writeFileSync(join(cliDir, CLI_NAME + ".sha256"), `${digest}  ${CLI_NAME}\n`)
  fs.rmSync(SCREENS, { recursive: true, force: true })
  fs.mkdirSync(SCREENS, { recursive: true })
}

let shotCounter = 0
export async function shot(page: Page, name: string): Promise<string> {
  shotCounter++
  fs.mkdirSync(SCREENS, { recursive: true })
  const path = join(SCREENS, `${process.env.SHOT_PREFIX ?? ""}${String(shotCounter).padStart(2, "0")}-${name}.png`)
  await page.screenshot({ path })
  return path
}

/** Web-session cookie for a seeded account; test mode accepts the email's local part as its password. */
async function webLogin(email: string, password: string): Promise<string> {
  const login = await fetch(`${B}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  expect(login.status).toBe(200)
  expect((await login.clone().text()).toLowerCase(), `web login as ${email}`).toContain("success")
  return login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
}

/** Approves `userCode` as this run's student, as the browser would. */
export async function approveDeviceCode(userCode: string, who = STUDENT, password = who === STUDENT ? STUDENT_PASSWORD : who): Promise<void> {
  const cookie = await webLogin(`${who}@example.com`, password)
  const approve = await fetch(`${B}/main-frontend/oauth/device_verification/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ user_code: userCode }),
  })
  expect(approve.status, await approve.clone().text()).toBe(200)
}

/**
 * Runs the device flow from wherever the login was started: clicks through VS Code's
 * link-protection dialog if it shows, approves the code from the opened URL as this run's
 * student, and waits for the confirmation.
 */
export async function completeDeviceLogin(page: Page, openedExternalUrls: () => Promise<string[]>): Promise<void> {
  const before = (await openedExternalUrls()).length
  const linkProtection = page.locator(".monaco-dialog-box").filter({ hasText: "open the external website" })
  await expect
    .poll(
      async () => {
        if (await linkProtection.isVisible()) {
          await linkProtection.getByRole("button", { name: "Open", exact: true }).click()
        }
        return (await openedExternalUrls()).length
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(before)
  const url = new URL((await openedExternalUrls())[before] as string)
  expect(url.host).toBe(new URL(MOOC_ROOT_URL).host)
  const userCode = url.searchParams.get("user_code")
  expect(userCode, `user_code in ${url}`).toBeTruthy()
  await approveDeviceCode(userCode as string)
  await expect(
    page.locator('[id="workbench\\.parts\\.statusbar"], .notifications-toasts').getByText(/^Logged in( to courses\.mooc\.fi)?\.$/).first(),
  ).toBeVisible({ timeout: 60_000 })
}

interface Fixtures {
  /** A course slug whose `.code-workspace` the window opens at launch. */
  courseWorkspace: string | undefined
  vsCode: ElectronApplication
  page: Page
  webview: FrameLocator
  openedExternalUrls: () => Promise<string[]>
}

export const realTest = base.extend<Fixtures>({
  courseWorkspace: [undefined, { option: true }],
  vsCode: async ({ courseWorkspace }, run) => {
    const args = [
      "--disable-gpu-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--disable-updates",
      "--disable-workspace-trust",
      "--extensionDevelopmentPath=" + WT,
      "--extensions-dir=" + dirs.extensions,
      "--new-window",
      "--no-sandbox",
      "--skip-release-notes",
      "--skip-welcome",
      "--user-data-dir=" + dirs.userData,
      "--force-disable-user-env",
      "--password-store=basic",
    ]
    if (courseWorkspace) {
      args.push(workspaceFile(courseWorkspace) as string)
    }
    const app = await electron.launch({
      executablePath: await downloadAndUnzipVSCode({
        // 1.100.0 does not write chat.disableAIFeatures into course workspaces.
        version: process.env.VSCODE_TEST_VERSION ?? "1.138.0",
        cachePath: join(WT, ".vscode-test"),
      }),
      args,
      env: {
        ...process.env,
        RUST_LOG: "debug",
        // Nothing listens here: the legacy backend is out of scope, and tmc.mooc.fi must never be reached.
        TMC_LANGS_TMC_ROOT_URL: process.env.E2E_TMC_ROOT_URL ?? "http://localhost:4999",
        TMC_LANGS_MOOC_ROOT_URL: MOOC_ROOT_URL,
        // The local stack is plain http on a dev host, to which the CLI otherwise sends no login.
        TMC_LANGS_MOOC_TRUST_LOCALHOST: "1",
        TMC_LANGS_CONFIG_DIR: dirs.config,
        TMC_LANGS_DEFAULT_PROJECTS_DIR: dirs.projects,
      },
    })
    await app.firstWindow()
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      Object.assign(globalThis, { tmcOpenedExternalUrls: opened })
      shell.openExternal = async (url: string): Promise<void> => void opened.push(url)
    })
    await run(app)
    const proc = app.process()
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))])
    try {
      if (proc.pid) process.kill(proc.pid, "SIGKILL")
    } catch {
      // gone
    }
  },
  page: async ({ vsCode }, run) => {
    const page = await vsCode.firstWindow()
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[renderer]", m.text())
    })
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => undefined)
    await run(page)
  },
  webview: async ({ page }, run) => {
    await run(
      page
        .frameLocator('iframe.webview.ready[src*="extensionId=moocfi.test-my-code"]')
        .last()
        .frameLocator("iframe#active-frame"),
    )
  },
  openedExternalUrls: async ({ vsCode }, run) => {
    await run(() =>
      vsCode.evaluate(() => [
        ...((globalThis as { tmcOpenedExternalUrls?: string[] }).tmcOpenedExternalUrls ?? []),
      ]),
    )
  },
})

export function workspaceFile(slug = "introduction-to-everything"): string | undefined {
  const file = join(dirs.userData, "User", "globalStorage", "moocfi.test-my-code", "workspaces", `${slug} (mooc).code-workspace`)
  return fs.existsSync(file) ? file : undefined
}

export function workspaceSettings(slug?: string): Record<string, unknown> | undefined {
  const file = workspaceFile(slug)
  if (!file) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")).settings ?? {}
  } catch {
    return undefined
  }
}

/** Calls the local stack's web API as `who` ("admin", or a student such as STUDENT); the session cookie is cached per user. */
const sessions = new Map<string, string>()
export async function web(who: string, method: string, path: string, body?: unknown): Promise<Response> {
  if (!sessions.has(who)) {
    sessions.set(who, await webLogin(`${who}@example.com`, who === STUDENT ? STUDENT_PASSWORD : who))
  }
  return fetch(`${B}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: sessions.get(who) as string },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

import * as fs from "fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { test as base, _electron as electron } from "@playwright/test"
import type {
  BrowserContext,
  ElectronApplication,
  Fixtures,
  FrameLocator,
  Page,
  PlaywrightWorkerOptions,
  TestInfo,
} from "@playwright/test"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"

import { CLIENT_CONFIG_DIR_NAME, MOCK_BACKEND_URL, tmcCredentials } from "../backend/mockSession"
import { VSCODE_TEST_VERSION } from "../config"

const rootPath = resolve(__dirname, "..")

console.log("Loading extension from", rootPath)

const GRACEFUL_CLOSE_TIMEOUT_MS = 10_000

/** The user settings every run starts with, before the test's own `userSettings`. */
export const BASE_USER_SETTINGS = {
  // A native dialog is outside the page, where Playwright cannot press its buttons; the
  // extension's confirmations are modal dialogs.
  "window.dialogStyle": "custom",
  // On a fresh profile VS Code's own welcome walkthrough sometimes opens late and takes over
  // the Get Started editor from ours.
  "workbench.startupEditor": "none",
}

// Chromium's helper processes exit with the main process, so killing it leaks nothing.
function forceKill(pid: number): void {
  try {
    // Reaps the whole tree if Electron leads its own process group.
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  }
}

// Under Xvfb electronApp.close() often hangs, so race it against a timeout and force-kill.
// The caller has already flushed tracing.
export async function closeElectron(electronApp: ElectronApplication): Promise<void> {
  const electronProcess = electronApp.process()
  // The context may already be gone.
  const gracefulClose = electronApp.close().then(
    () => true,
    () => true,
  )
  const closedGracefully = await Promise.race([
    gracefulClose,
    new Promise<boolean>((r) => {
      setTimeout(() => r(false), GRACEFUL_CLOSE_TIMEOUT_MS)
    }),
  ])
  if (!closedGracefully && electronProcess.pid !== undefined) {
    console.warn(
      `vsCode did not close gracefully within ${GRACEFUL_CLOSE_TIMEOUT_MS}ms; force killing (pid ${electronProcess.pid}).`,
    )
    forceKill(electronProcess.pid)
  }
}

/** Where VS Code loads the extension from: this checkout, or a dir VSIXs were installed into. */
export type ExtensionSource = { developmentPath: string } | { extensionsDir: string }

// Must be per-test, hence built here rather than at module load: a shared user data dir makes
// VS Code restore the previous test's window and workspace state.
export function launchArgs(
  userDataDir: string,
  isWorkspaceTrustEnabled: boolean,
  extension: ExtensionSource,
): string[] {
  return [
    "--disable-gpu-sandbox",
    // Under Xvfb Chromium sometimes kills the renderer of a window it deems occluded
    // ("Target page/context/browser has been closed"); these flags prevent that.
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "--disable-updates",
    // The trust prompt interrupts at unpredictable points once a course workspace opens.
    ...(isWorkspaceTrustEnabled ? [] : ["--disable-workspace-trust"]),
    "developmentPath" in extension
      ? "--extensionDevelopmentPath=" + extension.developmentPath
      : "--extensions-dir=" + extension.extensionsDir,
    "--new-window",
    "--no-sandbox",
    "--skip-release-notes",
    "--skip-welcome",
    "--user-data-dir=" + userDataDir,
    // Keeps VS Code from overwriting the env set in `electron.launch` with `~/.bashrc` etc.
    "--force-disable-user-env",
  ]
}

// The only login is the device flow; a seeded tmc token lets tmc specs start logged in
// and covers the "existing credentials keep working" path.
function seedTmcCredentials(configDir: string): void {
  const clientConfigDir = join(configDir, CLIENT_CONFIG_DIR_NAME)
  fs.mkdirSync(clientConfigDir, { recursive: true })
  fs.writeFileSync(join(clientConfigDir, "credentials.json"), JSON.stringify(tmcCredentials()))
}

// The mock backend outlives each test, so its in-memory state must be reset between tests.
export async function resetMockBackend(mock: string): Promise<void> {
  const reset = await fetch(`${MOCK_BACKEND_URL}/${mock}-mock/reset`, { method: "POST" })
  if (!reset.ok) {
    throw new Error(
      `Could not reset the ${mock} mock state: ${reset.status} ${reset.statusText}. ` +
        "The test would have run against the previous test's state.",
    )
  }
}

/** The environment that points the extension and its CLI at the mock backend and the run's dirs. */
export function mockBackendEnv(configDir: string, projectsDir: string): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    TMC_LANGS_TMC_ROOT_URL: MOCK_BACKEND_URL,
    // Overrides the compiled MOOC_BACKEND_URL; the mock is mounted in the same process.
    TMC_LANGS_MOOC_ROOT_URL: MOCK_BACKEND_URL,
    // Without this the CLI sends no bearer to localhost and every mooc call 401s.
    TMC_LANGS_MOOC_TRUST_LOCALHOST: "1",
    // Skips the real RFC 8628 polling interval.
    TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS: "250",
    TMC_LANGS_CONFIG_DIR: configDir,
    TMC_LANGS_DEFAULT_PROJECTS_DIR: projectsDir,
  }
}

type TraceMode = Exclude<PlaywrightWorkerOptions["trace"], { mode: unknown }>

// The `trace` modes, applied to the Electron context Playwright's own tracing never sees.
const isTraceRecorded = (mode: TraceMode, testInfo: TestInfo): boolean => {
  switch (mode) {
    case "on":
    case "retain-on-failure":
    case "retain-on-failure-and-retries":
      return true
    case "retain-on-first-failure":
      return testInfo.retry === 0
    case "on-first-retry":
      return testInfo.retry === 1
    case "on-all-retries":
      return testInfo.retry > 0
    default:
      return false
  }
}

// A leaked ~50MB user data dir per test fills the 16G /tmp tmpfs within a few runs.
const tempDirFixture =
  (prefix: string) =>
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  async ({}, run: (dir: string) => Promise<void>): Promise<void> => {
    const dir = fs.mkdtempSync(join(tmpdir(), prefix))
    try {
      await run(dir)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

interface CustomTestFixtures {
  /** VS Code's `--user-data-dir`, where the extension's global storage and course workspace files live. */
  userDataDir: string
  /** TMC_LANGS_CONFIG_DIR. */
  configDir: string
  /** TMC_LANGS_DEFAULT_PROJECTS_DIR. */
  projectsDir: string
  vsCode: ElectronApplication
  /** The URLs VS Code has been asked to open in a browser, which no test really opens. */
  openedExternalUrls: () => Promise<string[]>
  page: Page
  context: BrowserContext
  webview: FrameLocator
}

interface CustomTestOptions {
  // Overrides TMC_LANGS_MOOC_CLIENT_ID; the mock picks its device-flow scenario from this id
  // (backend/mooc/oauth.ts), e.g. a "never approves" client. Defaults to the real client.
  moocClientId: string | undefined
  // Set false for specs that need a logged-out extension; login entry points hide while logged in.
  seedTmcCredentials: boolean
  // Set true to run under Workspace Trust with the VS Code version's own defaults. Newer VS Code
  // keeps the trusted folders in the home directory, so the run gets a home of its own.
  isWorkspaceTrustEnabled: boolean
  // User settings beside the ones every run gets, e.g. `{ "testMyCode.newExercises": "download" }`.
  userSettings: Record<string, unknown>
  // Turns on `testMyCode.experimental.coursesMoocFi`, without which no courses.mooc.fi course
  // can be added.
  isCoursesMoocFiEnabled: boolean
}

export const customTestFixtures: Fixtures<
  CustomTestFixtures & CustomTestOptions,
  object,
  object,
  PlaywrightWorkerOptions
> = {
  moocClientId: [undefined, { option: true }],
  seedTmcCredentials: [true, { option: true }],
  isWorkspaceTrustEnabled: [false, { option: true }],
  userSettings: [{}, { option: true }],
  isCoursesMoocFiEnabled: [false, { option: true }],
  userDataDir: tempDirFixture("tmc-vscode-playwright-user"),
  configDir: tempDirFixture("tmc-vscode-playwright-config"),
  projectsDir: tempDirFixture("tmc-vscode-playwright-projects"),
  vsCode: async (
    {
      configDir,
      isCoursesMoocFiEnabled,
      isWorkspaceTrustEnabled,
      moocClientId,
      projectsDir,
      seedTmcCredentials: shouldSeedTmcCredentials,
      trace,
      userDataDir,
      userSettings,
    },
    run,
    testInfo,
  ) => {
    fs.mkdirSync(join(userDataDir, "User"))
    fs.writeFileSync(
      join(userDataDir, "User", "settings.json"),
      JSON.stringify({
        ...BASE_USER_SETTINGS,
        ...(isCoursesMoocFiEnabled && { "testMyCode.experimental.coursesMoocFi": true }),
        ...userSettings,
      }),
    )
    if (isWorkspaceTrustEnabled) {
      fs.mkdirSync(join(userDataDir, "home"))
    }
    if (shouldSeedTmcCredentials) {
      seedTmcCredentials(configDir)
    }
    await resetMockBackend("mooc")
    await resetMockBackend("tmc")
    const electronApp = await electron.launch({
      executablePath: await downloadAndUnzipVSCode(VSCODE_TEST_VERSION),
      args: launchArgs(userDataDir, isWorkspaceTrustEnabled, { developmentPath: rootPath }),
      env: {
        ...mockBackendEnv(configDir, projectsDir),
        ...(isWorkspaceTrustEnabled && { HOME: join(userDataDir, "home") }),
        ...(moocClientId ? { TMC_LANGS_MOOC_CLIENT_ID: moocClientId } : {}),
      },
    })
    const traceMode = typeof trace === "string" ? trace : trace.mode
    const isTracing = isTraceRecorded(traceMode, testInfo)
    try {
      if (isTracing) {
        await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
      }
      // Evaluating before the first window opens can lose the execution context mid-call.
      await electronApp.firstWindow()
      await electronApp.evaluate(({ shell }) => {
        const opened: string[] = []
        Object.assign(globalThis, { tmcOpenedExternalUrls: opened })
        shell.openExternal = async (url: string): Promise<void> => void opened.push(url)
      })

      await run(electronApp)

      if (isTracing) {
        const isDiscarded = traceMode.startsWith("retain-on-") && testInfo.status === "passed"
        await electronApp
          .context()
          .tracing.stop(isDiscarded ? {} : { path: testInfo.outputPath("trace.zip") })
      }
    } finally {
      await closeElectron(electronApp)
    }
  },
  openedExternalUrls: async ({ vsCode }, run) => {
    await run(() =>
      vsCode.evaluate(() => [
        ...((globalThis as { tmcOpenedExternalUrls?: string[] }).tmcOpenedExternalUrls ?? []),
      ]),
    )
  },
  page: async ({ vsCode }, run) => {
    const page = await vsCode.firstWindow()
    page.on("console", console.log)

    await run(page)
  },
  context: async ({ vsCode }, run) => {
    const context = vsCode.context()

    await run(context)
  },
  webview: async ({ page }, run) => {
    // The inner frame's title follows the panel's tab title, so the extension is
    // matched on the id VS Code puts in the outer frame's URL instead.
    const webviewFrame = page
      .frameLocator('iframe.webview.ready[src*="extensionId=moocfi.test-my-code"]')
      .last()
    const tmcFrame = webviewFrame.frameLocator("iframe#active-frame")
    await run(tmcFrame)
  },
}

// @ts-expect-error: Custom type
export const vsCodeTest = base.extend<CustomTestFixtures & CustomTestOptions>(customTestFixtures)

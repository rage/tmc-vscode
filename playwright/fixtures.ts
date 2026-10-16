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

// Chromium's helper processes (gpu/utility/renderer/crashpad) exit once the
// main process is gone, so killing the main pid is enough to avoid leaking
// VS Code processes between tests.
function forceKill(pid: number): void {
  try {
    // If Electron leads its own process group this reaps the whole tree.
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  }
}

// Under Xvfb in a headless sandbox, electronApp.close() frequently hangs
// indefinitely instead of resolving; race it against a timeout and force-kill
// if needed so teardown always completes. Caller has already flushed tracing.
async function closeElectron(electronApp: ElectronApplication): Promise<void> {
  const electronProcess = electronApp.process()
  // Swallow close() errors/rejections (e.g. if the context is already gone).
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

// Must be per-test, hence built here rather than at module load: a shared user data dir makes
// VS Code restore the previous test's window and workspace state.
function launchArgs(userDataDir: string, isWorkspaceTrustEnabled: boolean): string[] {
  return [
    "--disable-gpu-sandbox",
    // Xvfb has no real display, so Chromium sometimes backgrounds/kills the
    // renderer for a window it considers occluded, tearing down VS Code mid-test
    // ("Target page/context/browser has been closed"). These flags keep the
    // renderer alive and force software GL.
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "--disable-updates",
    // The workspace-trust prompt interrupts at unpredictable points once a
    // course workspace is opened.
    ...(isWorkspaceTrustEnabled ? [] : ["--disable-workspace-trust"]),
    "--extensionDevelopmentPath=" + rootPath,
    "--new-window",
    "--no-sandbox",
    "--skip-release-notes",
    "--skip-welcome",
    "--user-data-dir=" + userDataDir,
    // this makes it so vscode will not overwrite the environment
    // variables we set below in `electron.launch` with values from `~/.bashrc` etc.
    "--force-disable-user-env",
  ]
}

// The only login is the courses.mooc.fi device flow. Seeding a stored tmc token
// exercises the "existing credentials keep working" path and lets the tmc specs
// start logged in without a device-flow round trip.
function seedTmcCredentials(configDir: string): void {
  const clientConfigDir = join(configDir, CLIENT_CONFIG_DIR_NAME)
  fs.mkdirSync(clientConfigDir, { recursive: true })
  fs.writeFileSync(join(clientConfigDir, "credentials.json"), JSON.stringify(tmcCredentials()))
}

// The mock backend is a long-lived process shared across specs, so both of its
// mocks carry in-memory state from one test into the next; reset them the same
// way the per-test config/projects dirs isolate on-disk state.
async function resetMockBackend(mock: string): Promise<void> {
  const reset = await fetch(`${MOCK_BACKEND_URL}/${mock}-mock/reset`, { method: "POST" })
  if (!reset.ok) {
    throw new Error(
      `Could not reset the ${mock} mock state: ${reset.status} ${reset.statusText}. ` +
        "The test would have run against the previous test's state.",
    )
  }
}

type TraceMode = Exclude<PlaywrightWorkerOptions["trace"], { mode: unknown }>

// The `trace` option's modes, applied to the Electron context Playwright's own
// tracing never sees.
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

// Each test gets fresh dirs; a ~50MB user data dir per test fills this
// machine's 16G /tmp tmpfs within a few runs if one leaks.
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
  // Overrides TMC_LANGS_MOOC_CLIENT_ID; the mock picks its device-flow
  // scenario from this id (backend/mooc/oauth.ts), e.g. a "never approves"
  // client for testing cancellation. Defaults to the real client, which the mock approves.
  moocClientId: string | undefined
  // Set false for specs that need a logged-out extension, e.g. the login entry
  // points, which are hidden while a session exists.
  seedTmcCredentials: boolean
  // Set true to run under Workspace Trust with the VS Code version's own defaults. Newer VS Code
  // keeps the trusted folders in the home directory, so the run gets a home of its own.
  isWorkspaceTrustEnabled: boolean
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
  userDataDir: tempDirFixture("tmc-vscode-playwright-user"),
  configDir: tempDirFixture("tmc-vscode-playwright-config"),
  projectsDir: tempDirFixture("tmc-vscode-playwright-projects"),
  vsCode: async (
    {
      configDir,
      isWorkspaceTrustEnabled,
      moocClientId,
      projectsDir,
      seedTmcCredentials: shouldSeedTmcCredentials,
      trace,
      userDataDir,
    },
    run,
    testInfo,
  ) => {
    // A native dialog is outside the page, where Playwright cannot press its buttons; the
    // extension's confirmations are modal dialogs.
    fs.mkdirSync(join(userDataDir, "User"))
    fs.writeFileSync(
      join(userDataDir, "User", "settings.json"),
      JSON.stringify({ "window.dialogStyle": "custom" }),
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
      args: launchArgs(userDataDir, isWorkspaceTrustEnabled),
      env: {
        ...process.env,
        ...(isWorkspaceTrustEnabled && { HOME: join(userDataDir, "home") }),
        TMC_LANGS_TMC_ROOT_URL: MOCK_BACKEND_URL,
        // Route mooc (courses.mooc.fi) CLI calls at the mock mounted in the same
        // backend process (backend/mooc). Overrides the compiled MOOC_BACKEND_URL
        // define.
        TMC_LANGS_MOOC_ROOT_URL: MOCK_BACKEND_URL,
        // The CLI only attaches its bearer to trusted domains, not localhost, so
        // without this every mooc resource call would 401 (same knob the
        // integration bearer-auth suite uses).
        TMC_LANGS_MOOC_TRUST_LOCALHOST: "1",
        // Poll fast so the e2e doesn't wait the real RFC 8628 interval.
        TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS: "250",
        ...(moocClientId ? { TMC_LANGS_MOOC_CLIENT_ID: moocClientId } : {}),
        TMC_LANGS_CONFIG_DIR: configDir,
        TMC_LANGS_DEFAULT_PROJECTS_DIR: projectsDir,
      },
    })
    const traceMode = typeof trace === "string" ? trace : trace.mode
    const isTracing = isTraceRecorded(traceMode, testInfo)
    try {
      if (isTracing) {
        await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
      }
      // Evaluated before the main process opens its first window, the stub can lose its
      // execution context mid-call ("Execution context was destroyed").
      await electronApp.firstWindow()
      await electronApp.evaluate(({ shell }) => {
        const opened: string[] = []
        Object.assign(globalThis, { tmcOpenedExternalUrls: opened })
        shell.openExternal = async (url: string): Promise<void> => void opened.push(url)
      })

      await run(electronApp)

      if (isTracing) {
        const isDiscarded = traceMode.startsWith("retain-on-") && testInfo.status === "passed"
        // outputPath sanitises the title and scopes the file to this test, so two
        // titles cannot collide on one trace.
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

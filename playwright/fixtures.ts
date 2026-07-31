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
} from "@playwright/test"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"

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

// A shared user data dir let VS Code restore the *previous* test's window and
// workspace state, so e.g. the file explorer rendered a stale projects dir while
// the editor showed the current one. Must stay per-test, hence built here rather
// than at module load.
function launchArgs(userDataDir: string): string[] {
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
    "--extensionDevelopmentPath=" + rootPath,
    "--new-window",
    "--no-sandbox",
    "--profile-temp",
    "--skip-release-notes",
    "--skip-welcome",
    "--user-data-dir=" + userDataDir,
    // this makes it so vscode will not overwrite the environment
    // variables we set below in `electron.launch` with values from `~/.bashrc` etc.
    "--force-disable-user-env",
  ]
}

// tmc-langs' per-client config directory inside TMC_LANGS_CONFIG_DIR
// (src/config/constants.ts CLIENT_NAME).
const CLIENT_CONFIG_DIR_NAME = "tmc-vscode_plugin"

// The extension no longer has a TMC username/password login -- the only login is
// the courses.mooc.fi device flow, which needs a CLI carrying the mooc contract
// (see migration-gate.ts). Seeding a tmc token instead is the "existing
// credentials keep working" path, and it is what lets the tmc specs start from a
// logged-in extension against the pinned released CLI. The mock backend accepts
// any token (backend/controllers).
function seedTmcCredentials(configDir: string): void {
  const clientConfigDir = join(configDir, CLIENT_CONFIG_DIR_NAME)
  fs.mkdirSync(clientConfigDir, { recursive: true })
  fs.writeFileSync(
    join(clientConfigDir, "credentials.json"),
    '{"access_token":"1234","token_type":"bearer","scope":"public"}',
  )
}

interface CustomTestFixtures {
  vsCode: ElectronApplication
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
}

export const customTestFixtures: Fixtures<CustomTestFixtures & CustomTestOptions> = {
  moocClientId: [undefined, { option: true }],
  seedTmcCredentials: [true, { option: true }],
  vsCode: async ({ moocClientId, seedTmcCredentials: shouldSeedTmcCredentials }, run, testInfo) => {
    const configDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-config"))
    const projectsDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-projects"))
    const userDataDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-user"))
    if (shouldSeedTmcCredentials) {
      seedTmcCredentials(configDir)
    }
    // The mock backend is a long-lived process shared across specs, so its
    // in-memory mooc state leaks between tests; reset it here the same way the
    // per-test config/projects dirs isolate on-disk state. Best-effort — a down
    // backend will fail the spec anyway.
    try {
      await fetch("http://localhost:4001/mooc-mock/reset", { method: "POST" })
    } catch (error) {
      console.warn("Could not reset mooc mock state (is the mock backend running?):", error)
    }
    const electronApp = await electron.launch({
      executablePath: await downloadAndUnzipVSCode(),
      args: launchArgs(userDataDir),
      env: {
        ...process.env,
        RUST_LOG: "TRACE",
        TMC_LANGS_TMC_ROOT_URL: "http://localhost:4001",
        // Route mooc (courses.mooc.fi) CLI calls at the mock mounted in the same
        // backend process (backend/mooc). Overrides the compiled MOOC_BACKEND_URL
        // define.
        TMC_LANGS_MOOC_ROOT_URL: "http://localhost:4001",
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
    await electronApp.context().tracing.start({ screenshots: true, snapshots: true })

    await run(electronApp)

    let tracePath = undefined
    if (testInfo.status !== "passed") {
      // a non-undefined tracepath causes the trace to be saved
      // we'll do this only when the test hasn't passed
      tracePath = `./test-results/${testInfo.title.split(" ").join("-")}_trace.zip`
    }
    await electronApp.context().tracing.stop(tracePath ? { path: tracePath } : {})

    await closeElectron(electronApp)

    // A per-test user data dir is ~50MB of re-extracted VS Code state, on top of
    // the workspace and config dirs; /tmp here is a 16G tmpfs, so leaking these
    // fills it within a few suite runs. Only after the process is gone.
    for (const dir of [userDataDir, configDir, projectsDir]) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
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
    const webviewFrame = page.frameLocator("iframe.webview.ready").last()
    const tmcFrame = webviewFrame.frameLocator('iframe#active-frame[title="TestMyCode"]')
    await run(tmcFrame)
  },
}

// @ts-expect-error: Custom type
export const vsCodeTest = base.extend<CustomTestFixtures & CustomTestOptions>(customTestFixtures)

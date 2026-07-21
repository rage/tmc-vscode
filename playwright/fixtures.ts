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

const userDataDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-user"))

const args = [
  "--disable-gpu-sandbox",
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

interface CustomTestFixtures {
  vsCode: ElectronApplication
  page: Page
  context: BrowserContext
  webview: FrameLocator
}

interface CustomTestOptions {
  // Overrides the mooc OAuth client id the CLI authenticates as
  // (TMC_LANGS_MOOC_CLIENT_ID). The mooc mock selects the device-flow scenario
  // from this id (see backend/mooc/oauth.ts) — e.g. the cancel spec uses the
  // "never approves" client so the login stays pending until it is cancelled.
  // Defaults to unset (the real default client id, which the mock approves).
  moocClientId: string | undefined
}

export const customTestFixtures: Fixtures<CustomTestFixtures & CustomTestOptions> = {
  moocClientId: [undefined, { option: true }],
  vsCode: async ({ moocClientId }, run, testInfo) => {
    const configDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-config"))
    const projectsDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-projects"))
    // The mock backend (localhost:4001) is one long-lived process shared across
    // all specs, so its in-memory mooc state (issued device-flow tokens/polls,
    // submissions) leaks between tests. Reset it before each test the same way
    // the per-test config/projects dirs isolate on-disk state. Best-effort: if
    // the backend isn't up yet the individual spec will fail loudly on its own.
    try {
      await fetch("http://localhost:4001/mooc-mock/reset", { method: "POST" })
    } catch (error) {
      console.warn("Could not reset mooc mock state (is the mock backend running?):", error)
    }
    const electronApp = await electron.launch({
      executablePath: await downloadAndUnzipVSCode(),
      args,
      env: {
        ...process.env,
        RUST_LOG: "TRACE",
        TMC_LANGS_TMC_ROOT_URL: "http://localhost:4001",
        // Route mooc (courses.mooc.fi) CLI calls at the mock mounted in the same
        // backend process (backend/mooc). Overrides the compiled MOOC_BACKEND_URL
        // define.
        TMC_LANGS_MOOC_ROOT_URL: "http://localhost:4001",
        // Poll the device-flow token endpoint fast so the mooc login e2e does
        // not wait the real multi-second RFC 8628 interval.
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

    await electronApp.close()
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

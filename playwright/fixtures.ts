import { test as base, _electron as electron } from "@playwright/test";
import type {
    BrowserContext,
    ElectronApplication,
    Fixtures,
    FrameLocator,
    Page,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import * as fs from "fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const rootPath = resolve(__dirname, "..");

console.log("Loading extension from", rootPath);

const userDataDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-user"));

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
];

type CustomTestFixtures = {
    vsCode: ElectronApplication;
    page: Page;
    context: BrowserContext;
    webview: FrameLocator;
};

export const customTestFixtures: Fixtures<CustomTestFixtures> = {
    // eslint-disable-next-line no-empty-pattern
    vsCode: async ({}, run) => {
        const configDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-config"));
        const projectsDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-playwright-projects"));
        const electronApp = await electron.launch({
            executablePath: await downloadAndUnzipVSCode(),
            args,
            env: {
                ...process.env,
                RUST_LOG: "TRACE",
                TMC_LANGS_TMC_ROOT_URL: "http://localhost:4001",
                TMC_LANGS_CONFIG_DIR: configDir,
                TMC_LANGS_DEFAULT_PROJECTS_DIR: projectsDir,
            },
        });
        await run(electronApp);
        await electronApp.close();
    },
    page: async ({ vsCode }, run) => {
        const page = await vsCode.firstWindow();
        page.on("console", console.log);

        await run(page);
    },
    context: async ({ vsCode }, run) => {
        const context = vsCode.context();

        await run(context);
    },
    webview: async ({ page }, run) => {
        const webviewFrame = await page.frameLocator("iframe.webview.ready").last();
        const tmcFrame = await webviewFrame.frameLocator('iframe#active-frame[title="TestMyCode"]');
        await run(tmcFrame);
    },
};

// @ts-expect-error: Custom type
export const vsCodeTest = base.extend<CustomTestFixtures>(customTestFixtures);

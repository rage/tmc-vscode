import { test as base, _electron as electron } from "@playwright/test";
import type { BrowserContext, ElectronApplication, Fixtures, Page } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { resolve } from "node:path";

const rootPath = resolve(__dirname, "..");

console.log("Loading extension from", rootPath);

const args = [
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--extensionDevelopmentPath=" + rootPath,
    "--new-window",
    "--no-sandbox",
    "--profile-temp",
    "--skip-release-notes",
    "--skip-welcome",
];

type CustomTestFixtures = {
    vsCode: ElectronApplication;
    page: Page;
    context: BrowserContext;
};

export const customTestFixtures: Fixtures<CustomTestFixtures> = {
    // eslint-disable-next-line no-empty-pattern
    vsCode: async ({}, run) => {
        const electronApp = await electron.launch({
            executablePath: await downloadAndUnzipVSCode(),
            args,
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
};

// @ts-expect-error: Custom type
export const vsCodeTest = base.extend<CustomTestFixtures>(customTestFixtures);

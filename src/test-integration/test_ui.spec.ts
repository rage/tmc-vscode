import { _electron as electron, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import * as path from "node:path";

let electronApp: ElectronApplication;

const rootPath = path.resolve(__dirname, "path/to/your/extension-files");

const args = [
    "--disable-gpu-sandbox", // https://github.com/microsoft/vscode-test/issues/221
    "--disable-updates", // https://github.com/microsoft/vscode-test/issues/120
    "--disable-workspace-trust",
    "--extensionDevelopmentPath=" + rootPath,
    "--new-window", // Opens a new session of VS Code instead of restoring the previous session (default).
    "--no-sandbox", // https://github.com/microsoft/vscode/issues/84238
    "--profile-temp", // "debug in a clean environment"
    "--skip-release-notes",
    "--skip-welcome",
];

// test.beforeEach(async () => {
//   electronApp = await electron.launch({
//     executablePath: await downloadAndUnzipVSCode(),
//     args
//   });
// });

test("launches vscode", async () => {
    const electronApp = await electron.launch({
        executablePath: await downloadAndUnzipVSCode(),
        args,
    });
    const page = await electronApp.firstWindow();

    await page.getByRole("button", { name: "Some button" }).click();
});

test.afterEach(async () => {
    await electronApp.close();
});

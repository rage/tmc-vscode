//@ts-check

const path = require("path");
const runTests = require("vscode-test").runTests;

async function main() {
    let exitCode = 0;
    /**@type {import("child_process").ChildProcess} */
    try {
        const platform =
            process.platform === "win32" && process.arch === "x64"
                ? "win32-x64-archive"
                : undefined;

        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "..");

        // The path to test runner
        // Passed to --extensionTestsPath
        const testLoader = process.argv[2] === "integration" ? "integrationLoader" : "testLoader";
        const extensionTestsPath = path.resolve(__dirname, testLoader);

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath, platform });
    } catch (err) {
        console.error("Failed to run tests");
        exitCode = 1;
    }

    process.exit(exitCode);
}

main();

//@ts-check

const cp = require("child_process");
const path = require("path");
const kill = require("tree-kill");
const runTests = require("vscode-test").runTests;

/**@returns {Promise<import("child_process").ChildProcess>} */
async function startServer() {
    let ready = false;
    console.log(path.join(__dirname, "..", "backend"));
    const server = cp.spawn("npm", ["start"], {
        cwd: path.join(__dirname, "..", "backend"),
        shell: "bash",
    });
    server.stdout.on("data", (chunk) => {
        if (chunk.toString().startsWith("Server listening to")) {
            ready = true;
        }
    });

    const timeout = setTimeout(() => {
        throw new Error("Failed to start server");
    }, 10000);

    while (!ready) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    clearTimeout(timeout);
    return server;
}

async function main() {
    let exitCode = 0;
    /**@type {import("child_process").ChildProcess} */
    let backend;
    try {
        backend = await startServer();
        const platform =
            process.platform === "win32" && process.arch === "x64"
                ? "win32-x64-archive"
                : undefined;

        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "..");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "testLoader");

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath, platform });
    } catch (err) {
        console.error("Failed to run tests");
        exitCode = 1;
    } finally {
        kill(backend.pid);
        process.exit(exitCode);
    }
}

main();

//@ts-check

// Runs the integration tier: downloads the VS Code build config.js pins and runs
// dist/integration.spec.js in the extension host via mocha
// (bin/integrationTestLoader.js).
//
// The suite spawns the mock backend and the real CLI from backend/cli, so run
// `pnpm --filter tmc-vscode-mock-backend run setup` and `pnpm run build` first.
const runTests = require("@vscode/test-electron").runTests
const path = require("path")

const { VSCODE_TEST_VERSION } = require("../config.js")

async function main() {
  let exitCode = 0
  try {
    const platform =
      process.platform === "win32" && process.arch === "x64" ? "win32-x64-archive" : undefined

    const extensionDevelopmentPath = path.resolve(__dirname, "..")
    const extensionTestsPath = path.resolve(__dirname, "integrationTestLoader")

    const extensionTestsEnv = {
      TMC_VSCODE_TESTMODE: "1",
    }

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv,
      platform,
      version: VSCODE_TEST_VERSION,
    })
  } catch (err) {
    console.error("Failed to run integration tests:", err)
    exitCode = 1
  }

  process.exitCode = exitCode
}

main()

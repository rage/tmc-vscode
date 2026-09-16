//@ts-check

// Loaded by test-electron (see bin/runIntegrationTests.js) as the
// --extensionTestsPath. Runs the bundled integration suite
// (dist/integration.spec.js) with mocha's tdd UI inside the extension host.
const Mocha = require("mocha")
const path = require("path")

// Zero tests are zero failures, so a suite that stopped reaching the bundle
// would pass. Raise this with the suite; mocha counts a pending test in
// `stats.tests`, so the figure is the number of cases src/test-integration
// declares and does not move when the CLI-version gate skips the
// migration-contract cases.
const MINIMUM_TESTS = 63

function run() {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    // Individual tests set their own timeouts; keep a generous default so
    // slow CI machines don't flake.
    timeout: 60000,
  })

  return /** @type {Promise<void>} */ (
    new Promise((c, e) => {
      mocha.addFile(path.resolve(__dirname, "..", "dist", "integration.spec.js"))

      try {
        const runner = mocha.run((failures) => {
          if (failures > 0) {
            e(new Error(`${failures} tests failed.`))
          } else if (runner.stats.tests < MINIMUM_TESTS) {
            e(
              new Error(
                `Integration suite ran ${runner.stats.tests} tests, expected at least ` +
                  `${MINIMUM_TESTS}. Either the suite shrank and MINIMUM_TESTS in ` +
                  `bin/integrationTestLoader.js needs updating, or the bundle is missing tests.`,
              ),
            )
          } else {
            c()
          }
        })
      } catch (err) {
        e(err)
      }
    })
  )
}

exports.run = run

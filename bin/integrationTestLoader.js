//@ts-check

// Loaded by test-electron (see bin/runIntegrationTests.js) as the
// --extensionTestsPath. Runs the bundled integration suite
// (dist/integration.spec.js) with mocha's tdd UI inside the extension host.
const Mocha = require("mocha")
const path = require("path")

// Zero tests are zero failures, so a suite that stopped reaching the bundle, or
// whose cases were all skipped, would pass. Raise this with the suite.
const MINIMUM_PASSING = 62

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
          } else if (runner.stats.passes < MINIMUM_PASSING) {
            e(
              new Error(
                `Integration suite passed ${runner.stats.passes} tests, expected at least ` +
                  `${MINIMUM_PASSING}. Either the suite shrank and MINIMUM_PASSING in ` +
                  `bin/integrationTestLoader.js needs updating, or tests are missing or skipped.`,
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

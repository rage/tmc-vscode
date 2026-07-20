//@ts-check

// Loaded by test-electron (see bin/runIntegrationTests.js) as the
// --extensionTestsPath. Runs the bundled integration suite
// (dist/integration.spec.js) with mocha's tdd UI inside the extension host.
const Mocha = require("mocha")
const path = require("path")

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
        mocha.run((failures) => {
          if (failures > 0) {
            e(new Error(`${failures} tests failed.`))
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

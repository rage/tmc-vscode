//@ts-check

// Fails unless a test run reached a minimum number of tests: zero tests are zero failures, so a
// glob that matches nothing or a skipped suite passes otherwise. Raise the minimums with the suites.
//
//   node bin/assertMinimumTests.js vitest <minimum> <vitest json report>
//   node bin/assertMinimumTests.js playwright <minimum> <playwright --list json report>
const fs = require("node:fs")

/** @param {{ suites?: any[], specs?: any[] }} node */
const countSpecs = (node) =>
  (node.specs?.length ?? 0) +
  (node.suites ?? []).reduce((total, suite) => total + countSpecs(suite), 0)

const [kind, minimumArg, reportPath] = process.argv.slice(2)
const minimum = Number(minimumArg)
if (!reportPath || !Number.isInteger(minimum)) {
  console.error("usage: assertMinimumTests.js <vitest|playwright> <minimum> <report.json>")
  process.exit(2)
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"))
const actual = kind === "vitest" ? report.numPassedTests : countSpecs(report)
if (!(actual >= minimum)) {
  console.error(
    `The ${kind} run reached ${actual} tests, expected at least ${minimum}. Either the suite ` +
      `shrank and the minimum in .github/workflows/test.yml needs lowering, or tests are missing or skipped.`,
  )
  process.exit(1)
}
console.log(`${kind}: ${actual} tests, at least ${minimum} expected`)

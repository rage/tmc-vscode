import { semVerCompare } from "../../utilities"

suite("Semantic version utils", function () {
  test("Major version comparisons work as expected", function () {
    expect(semVerCompare("1.2.3", "1.2.3", "major"), "1.2.3 === 1.2.3").toBe(0)
    expect(semVerCompare("1.2.0", "1.2.3", "major"), "1.2.0 === 1.2.3").toBe(0)
    expect(semVerCompare("1.0.0", "1.2.3", "major"), "1.0.0 === 1.2.3").toBe(0)
    expect(semVerCompare("1.1.1", "2.0.0", "major"), "1.1.1 < 2.0.0").toBeLessThan(0)
    expect(semVerCompare("2.0.0", "1.1.1", "major"), "2.0.0 > 1.1.1").toBeGreaterThan(0)
  })

  test("Minor version comparisons work as expected", function () {
    expect(semVerCompare("1.2.3", "1.2.3", "minor"), "1.2.3 === 1.2.3").toBe(0)
    expect(semVerCompare("1.2.0", "1.2.3", "minor"), "1.2.0 === 1.2.3").toBe(0)
    expect(semVerCompare("1.0.0", "1.2.3", "minor"), "1.0.0 < 1.2.3").toBeLessThan(0)
    expect(semVerCompare("1.1.1", "2.0.0", "minor"), "1.1.1 < 2.0.0").toBeLessThan(0)
    expect(semVerCompare("2.0.0", "1.1.1", "minor"), "2.0.0 > 1.1.1").toBeGreaterThan(0)
  })

  test("Patch version comparisons work as expected", function () {
    expect(semVerCompare("1.2.3", "1.2.3", "patch"), "1.2.3 === 1.2.3").toBe(0)
    expect(semVerCompare("1.2.0", "1.2.3", "patch"), "1.2.0 < 1.2.3").toBeLessThan(0)
    expect(semVerCompare("1.0.0", "1.2.3", "patch"), "1.0.0 < 1.2.3").toBeLessThan(0)
    expect(semVerCompare("1.1.1", "2.0.0", "patch"), "1.1.1 < 2.0.0").toBeLessThan(0)
    expect(semVerCompare("2.0.0", "1.1.1", "patch"), "2.0.0 > 1.1.1").toBeGreaterThan(0)
  })

  test("Non semantic version comparisations return undefined", function () {
    expect(semVerCompare("", "1.0.0", "patch")).toBeUndefined()
    expect(semVerCompare("1", "1.0.0", "patch")).toBeUndefined()
    expect(semVerCompare("100", "1.0.0", "patch")).toBeUndefined()
    expect(semVerCompare("1.0", "1.0.0", "patch")).toBeUndefined()
    expect(semVerCompare("1x2x3", "1.2.3", "patch")).toBeUndefined()
  })

  // The two migration gates (src/test-integration/tmc_langs_cli.spec.ts and
  // playwright/migration-gate.ts) feed in `tmc-langs-cli --version` output verbatim, and
  // silently skip every mooc case if the version stops being found inside it.
  test("A version embedded in a command's output is still compared", function () {
    expect(semVerCompare("tmc-langs-cli 0.40.0\n", "0.40.0", "patch")).toBe(0)
    expect(semVerCompare("tmc-langs-cli 0.39.6\n", "0.40.0", "patch")).toBeLessThan(0)
  })
})

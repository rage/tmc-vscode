import type { TestResult } from "../shared/langsSchema"

/**
 * The point names a local test run awards: those of passed tests that no failed test also
 * carries. tmc-langs repeats a shared point on every test that needs it (Java) and, for some
 * languages (Python, C#), strips a failed test's points from every result, so counting
 * `points.length` per test over- or under-counts.
 */
export function awardedPoints(results: readonly TestResult[]): Set<string> {
  const failed = new Set(results.filter((result) => !result.successful).flatMap((r) => r.points))
  return new Set(
    results
      .filter((result) => result.successful)
      .flatMap((result) => result.points)
      .filter((point) => !failed.has(point)),
  )
}

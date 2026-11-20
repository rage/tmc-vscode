/**
 * Compares two strings representing semantic versions at different possible levels.
 * @param a Semantic version string.
 * @param b Semantic version string,
 * @param level Level of comparison; eg. if set to minor, 1.3.0 and 1.3.1 are considered to be same.
 * @return Positive number if a is bigger than b, negative number if a is smaller than b, zero if
 * versions are same, undefined if a or b doensn't match semantic version.
 */
function semVerCompare(
  a: string,
  b: string,
  level: "major" | "minor" | "patch",
): number | undefined {
  const matcher = /(\d+)\.(\d+)\.(\d+)/
  const matchA = a.match(matcher)
  const matchB = b.match(matcher)
  if (matchA === null || matchB === null) {
    return undefined
  }

  const majdiff = Math.trunc(Number(matchA[1] ?? "0")) - Math.trunc(Number(matchB[1] ?? "0"))
  if (majdiff !== 0 || level === "major") {
    return majdiff
  }

  const mindiff = Math.trunc(Number(matchA[2] ?? "0")) - Math.trunc(Number(matchB[2] ?? "0"))
  if (mindiff !== 0 || level === "minor") {
    return mindiff
  }

  return Math.trunc(Number(matchA[3] ?? "0")) - Math.trunc(Number(matchB[3] ?? "0"))
}

/** A start that is the first of an install or of a newer minor or major version. */
type VersionChange = "installed" | "updated"

/**
 * How `currentVersion` relates to `previousVersion`, the one that last ran: `installed` when no
 * readable version ran before, `updated` on a newer minor or major version, and `undefined`
 * otherwise (the same version, a patch update, or a downgrade).
 */
function versionChangeSince(
  previousVersion: string | undefined,
  currentVersion: string,
): VersionChange | undefined {
  const versionDiff = semVerCompare(currentVersion, previousVersion ?? "", "minor")
  if (versionDiff === undefined) {
    return "installed"
  }
  return versionDiff > 0 ? "updated" : undefined
}

export type { VersionChange }
export { semVerCompare, versionChangeSince }

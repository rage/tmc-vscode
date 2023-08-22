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
    const matcher = /([0-9]+).([0-9]+).([0-9]+)/;
    const matchA = a.match(matcher);
    const matchB = b.match(matcher);
    if (matchA === null || matchB === null) {
        return undefined;
    }

    const majdiff = parseInt(matchA[1]) - parseInt(matchB[1]);
    if (majdiff !== 0 || level === "major") {
        return majdiff;
    }

    const mindiff = parseInt(matchA[2]) - parseInt(matchB[2]);
    if (mindiff !== 0 || level === "minor") {
        return mindiff;
    }

    return parseInt(matchA[3]) - parseInt(matchB[3]);
}

export { semVerCompare };

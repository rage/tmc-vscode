// shared across testExercise/submitExercise/pasteExercise so a single set of keys guards
// both the local test+checkstyle pair and the submit/paste pair per exercise path
const inFlightKeys: Set<string> = new Set();

/**
 * Atomically checks and claims `key`. Returns true if claimed (caller must call `release`
 * exactly once when done), false if another operation already holds it.
 */
export function acquireSingleFlight(key: string): boolean {
    if (inFlightKeys.has(key)) {
        return false;
    }
    inFlightKeys.add(key);
    return true;
}

export function releaseSingleFlight(key: string): void {
    inFlightKeys.delete(key);
}

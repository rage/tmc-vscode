// one shared set, so e.g. submitting and pasting the same exercise collide on one key
const inFlightKeys: Set<string> = new Set();

/**
 * Claims `key`, or returns false if another operation holds it. Callers that claim it
 * must release it exactly once.
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

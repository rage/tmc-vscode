// one shared set, so e.g. submitting and pasting the same exercise collide on one key
const inFlightKeys: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Claims `key`, or returns false if another operation holds it. Callers that claim it
 * must release it exactly once. `maxHoldMs` force-releases the key after that delay
 * regardless, so a CLI call whose promise never settles can't wedge the key forever.
 */
export function acquireSingleFlight(key: string, maxHoldMs: number): boolean {
    if (inFlightKeys.has(key)) {
        return false;
    }
    const backstop = setTimeout(() => inFlightKeys.delete(key), maxHoldMs);
    inFlightKeys.set(key, backstop);
    return true;
}

export function releaseSingleFlight(key: string): void {
    const backstop = inFlightKeys.get(key);
    if (backstop !== undefined) {
        clearTimeout(backstop);
    }
    inFlightKeys.delete(key);
}

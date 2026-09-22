import { vi } from "vitest"

/**
 * A loose auto-mock: every property access yields a memoized `vi.fn()`, so
 * any method can be called (returning `undefined`) without being explicitly
 * stubbed. Used for the placeholder fields of the action context that a
 * given action never touches.
 */
export function autoMock<T>(): T {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(
    {},
    {
      get(_target, prop) {
        let value = cache.get(prop)
        if (value === undefined) {
          value = vi.fn()
          cache.set(prop, value)
        }
        return value
      },
    },
  ) as T
}

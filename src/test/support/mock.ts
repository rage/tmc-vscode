import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
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

/**
 * A successful `Result` for a service a test does not drive itself.
 *
 * Do not reach for {@link autoMock} on a `Result`: its `Proxy` makes `.ok` and
 * `.err` both truthy, so both arms of every guard are reachable and neither is
 * asserted.
 *
 * @param value the wrapped service; a loose auto-mock when omitted.
 */
export function okResult<T>(value?: T): Result<T, Error> {
  return new Ok(value ?? autoMock<T>())
}

/**
 * A failed `Result`, so a guard testing `.err` genuinely takes the failure arm.
 * See {@link okResult}.
 */
export function errResult<T>(message: string): Result<T, Error> {
  return new Err(new Error(message))
}

import { Err, Ok } from "ts-results"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { BottleneckError } from "../../errors"
import { acquireSingleFlight, releaseSingleFlight, runSingleFlight } from "../../utilities"

// Keys live in one module-level map, so every test releases what it claims.
describe("single-flight keys", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("a second acquire of a held key is rejected", () => {
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    expect(acquireSingleFlight("k", 1000)).toBe(false)
    releaseSingleFlight("k")
  })

  test("a released key can be acquired again", () => {
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    releaseSingleFlight("k")
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    releaseSingleFlight("k")
  })

  test("different keys do not collide", () => {
    expect(acquireSingleFlight("a", 1000)).toBe(true)
    expect(acquireSingleFlight("b", 1000)).toBe(true)
    releaseSingleFlight("a")
    releaseSingleFlight("b")
  })

  test("the backstop frees a key nobody released", () => {
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    vi.advanceTimersByTime(999)
    expect(acquireSingleFlight("k", 1000)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    releaseSingleFlight("k")
  })

  test("releasing clears the backstop, so it cannot free a later holder", () => {
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    releaseSingleFlight("k")
    expect(acquireSingleFlight("k", 60_000)).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(acquireSingleFlight("k", 60_000)).toBe(false)
    releaseSingleFlight("k")
  })

  test("runSingleFlight releases the key even when the body throws", async () => {
    const options = {
      key: "k",
      maxHoldMs: 1000,
      busyMessage: "busy",
      onBusy: vi.fn(),
    }
    await expect(runSingleFlight(options, () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    )
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    releaseSingleFlight("k")
  })

  test("runSingleFlight rejects a concurrent call with a BottleneckError", async () => {
    const onBusy = vi.fn()
    const options = { key: "k", maxHoldMs: 60_000, busyMessage: "busy", onBusy }

    let releaseFirst!: () => void
    const first = runSingleFlight(
      options,
      () =>
        new Promise<Ok<string>>((resolve) => {
          releaseFirst = () => resolve(Ok("done"))
        }),
    )

    const second = await runSingleFlight(options, () => Promise.resolve(Ok("unreachable")))
    expect(second.err).toBe(true)
    expect(second.val).toBeInstanceOf(BottleneckError)
    expect((second.val as Error).message).toBe("busy")
    expect(onBusy).toHaveBeenCalledExactlyOnceWith("busy")

    releaseFirst()
    expect((await first).val).toBe("done")

    // the rejected call must not have released the key the first call still held
    expect(acquireSingleFlight("k", 1000)).toBe(true)
    releaseSingleFlight("k")
  })

  test("runSingleFlight rejects without an onBusy callback", async () => {
    expect(acquireSingleFlight("k", 1000)).toBe(true)

    const result = await runSingleFlight({ key: "k", maxHoldMs: 1000, busyMessage: "busy" }, () =>
      Promise.resolve(Ok("unreachable")),
    )

    expect(result.val).toBeInstanceOf(BottleneckError)
    releaseSingleFlight("k")
  })

  test("runSingleFlight passes the body's own Err through untouched", async () => {
    const error = new Error("body failed")
    const result = await runSingleFlight(
      { key: "k", maxHoldMs: 1000, busyMessage: "busy", onBusy: vi.fn() },
      () => Promise.resolve(Err(error)),
    )
    expect(result.val).toBe(error)
  })
})

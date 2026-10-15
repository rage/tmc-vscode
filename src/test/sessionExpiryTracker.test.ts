import { createSessionExpiryTracker } from "../sessionExpiryTracker"

suite("createSessionExpiryTracker", () => {
  test("never warns someone who has had no session this run", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker(false, onExpired)

    tracker.onAuthChecked(false)
    tracker.onAuthChecked(false)

    expect(onExpired).not.toHaveBeenCalled()
  })

  test("a session that goes true -> false warns exactly once across repeated false checks", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker(true, onExpired)

    tracker.onAuthChecked(false)
    tracker.onAuthChecked(false)
    tracker.onAuthChecked(false)

    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  test("a logout followed by continued false checks never warns", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker(true, onExpired)

    tracker.onLogout()
    tracker.onAuthChecked(false)
    tracker.onAuthChecked(false)

    expect(onExpired).not.toHaveBeenCalled()
  })

  test("logging back in re-arms the warning", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker(true, onExpired)

    tracker.onAuthChecked(false)
    tracker.onLogin()
    tracker.onAuthChecked(false)

    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  test("a check that sees a session re-arms the warning", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker(false, onExpired)

    tracker.onAuthChecked(true)
    tracker.onAuthChecked(false)

    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})

suite("createSessionExpiryTracker with an operation that hit the rejection", () => {
  test("warns once whether the operation or the re-check reports it first", () => {
    for (const operationFirst of [true, false]) {
      const onExpired = vi.fn()
      const tracker = createSessionExpiryTracker(true, onExpired)
      const rejection = new Error("invalid token")

      if (operationFirst) {
        tracker.onSessionLost(rejection)
        tracker.onAuthChecked(false, rejection)
      } else {
        tracker.onAuthChecked(false, rejection)
        tracker.onSessionLost(rejection)
      }

      expect(onExpired).toHaveBeenCalledTimes(1)
    }
  })

  test("a later operation on the lost session warns again", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker(true, onExpired)
    const first = new Error("invalid token")
    const second = new Error("invalid token")

    tracker.onAuthChecked(false, first)
    tracker.onSessionLost(first)
    tracker.onAuthChecked(false, second)
    tracker.onSessionLost(second)

    expect(onExpired).toHaveBeenCalledTimes(2)
  })
})

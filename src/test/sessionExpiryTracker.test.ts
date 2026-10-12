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

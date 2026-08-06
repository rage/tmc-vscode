import { createSessionExpiryTracker } from "../../utilities/sessionExpiryTracker"

suite("createSessionExpiryTracker", () => {
  test("never warns for a backend that has never been logged in this session", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: false, mooc: false }, onExpired)

    // Repeated "still not authenticated" polls for a backend that was never
    // logged in this session must never be mistaken for an expired session.
    tracker.onAuthChecked("tmc", false)
    tracker.onAuthChecked("tmc", false)
    tracker.onAuthChecked("mooc", false)

    expect(onExpired).not.toHaveBeenCalled()
  })

  test("a session that goes true -> false warns exactly once across repeated false polls", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: true, mooc: false }, onExpired)

    tracker.onAuthChecked("tmc", false)
    tracker.onAuthChecked("tmc", false)
    tracker.onAuthChecked("tmc", false)

    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(onExpired).toHaveBeenCalledWith("tmc")
  })

  test("an explicit logout followed by continued false polls never warns", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: true, mooc: false }, onExpired)

    // The user explicitly logged out; this must not be treated as an
    // expired session, and the poll observing "still not authenticated"
    // afterwards must not warn either.
    tracker.onLogout("tmc", true)
    tracker.onAuthChecked("tmc", false)
    tracker.onAuthChecked("tmc", false)

    expect(onExpired).not.toHaveBeenCalled()
  })

  test("logging back in resets the dedup so a second unexpected drop warns again", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: true, mooc: false }, onExpired)

    tracker.onAuthChecked("tmc", false)
    expect(onExpired).toHaveBeenCalledTimes(1)

    tracker.onLogin("tmc")
    tracker.onAuthChecked("tmc", false)

    expect(onExpired).toHaveBeenCalledTimes(2)
    expect(onExpired).toHaveBeenNthCalledWith(1, "tmc")
    expect(onExpired).toHaveBeenNthCalledWith(2, "tmc")
  })

  test("an unexpected logout event warns immediately, independent of a later poll", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: true, mooc: true }, onExpired)

    tracker.onLogout("mooc", false)
    // The poll runs after the event and observes the same drop; must not
    // double-warn.
    tracker.onAuthChecked("mooc", false)

    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(onExpired).toHaveBeenCalledWith("mooc")
  })

  // What the extension does to tmc's state on a successful mooc login: whether
  // the mooc token also authenticates tmc is a property of the pinned CLI, so the
  // stale state is dropped rather than replaced with a claimed session.
  test("reset clears the warning without arming a new one", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: true, mooc: false }, onExpired)

    tracker.onAuthChecked("tmc", false)
    expect(onExpired).toHaveBeenCalledTimes(1)

    tracker.reset("tmc")
    tracker.onAuthChecked("tmc", false)
    expect(onExpired).toHaveBeenCalledTimes(1)

    // A later check that does see a session re-arms the warning.
    tracker.onAuthChecked("tmc", true)
    tracker.onAuthChecked("tmc", false)
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  test("tracks tmc and mooc independently", () => {
    const onExpired = vi.fn()
    const tracker = createSessionExpiryTracker({ tmc: true, mooc: true }, onExpired)

    tracker.onAuthChecked("tmc", false)

    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(onExpired).toHaveBeenCalledWith("tmc")

    tracker.onAuthChecked("mooc", false)

    expect(onExpired).toHaveBeenCalledTimes(2)
    expect(onExpired).toHaveBeenCalledWith("mooc")
  })
})

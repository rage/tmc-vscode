import { vi } from "vitest"

import { MoocLoginRegistry } from "../../panels/moocLoginRegistry"

// The invocation-identity logic that keeps orphaned/concurrent `mooc login`
// processes from racing on the credentials file or driving the wrong panel. The
// registry is pure (no vscode/CLI), so the guards are exercised directly here
// rather than through TmcPanel's message plumbing.
suite("MoocLoginRegistry", () => {
  test("start returns a unique, increasing invocation id per attempt", () => {
    const registry = new MoocLoginRegistry()
    const first = registry.start(1, () => {})
    // A second start supersedes the first (same or different panel id).
    const second = registry.start(1, () => {})
    expect(second).not.toEqual(first)
    expect(second).toBeGreaterThan(first)
  })

  test("only the latest attempt is current", () => {
    const registry = new MoocLoginRegistry()
    const first = registry.start(1, () => {})
    const second = registry.start(2, () => {})
    expect(registry.isCurrent(first)).toBe(false)
    expect(registry.isCurrent(second)).toBe(true)
  })

  test("start interrupt-and-replaces an in-flight attempt (never two live)", () => {
    const registry = new MoocLoginRegistry()
    const firstInterrupt = vi.fn()
    registry.start(1, firstInterrupt)
    const secondInterrupt = vi.fn()
    // Re-entry / "Try again": starting again must kill the previous process.
    registry.start(1, secondInterrupt)
    expect(firstInterrupt).toHaveBeenCalledTimes(1)
    expect(secondInterrupt).not.toHaveBeenCalled()
  })

  test("finish clears the registry only for the current attempt", () => {
    const registry = new MoocLoginRegistry()
    const stale = registry.start(1, () => {})
    const current = registry.start(1, () => {})
    // The superseded attempt resolving late must not clear the live one.
    registry.finish(stale)
    expect(registry.isCurrent(current)).toBe(true)
    registry.finish(current)
    expect(registry.isCurrent(current)).toBe(false)
  })

  test("a stale attempt cannot delete the newer attempt's entry (cancel->instant-retry)", () => {
    const registry = new MoocLoginRegistry()
    // Cancel kills the first attempt and clears it.
    const stale = registry.start(7, () => {})
    registry.cancel(7)
    // "Try again" (same panel id) registers a fresh attempt before the old
    // process has finished dying.
    const retryInterrupt = vi.fn()
    const retry = registry.start(7, retryInterrupt)
    // The old invocation finally resolves and tries to clean up.
    expect(registry.isCurrent(stale)).toBe(false)
    registry.finish(stale)
    // The retry must remain current and uninterrupted.
    expect(registry.isCurrent(retry)).toBe(true)
    expect(retryInterrupt).not.toHaveBeenCalled()
  })

  test("cancel interrupts and clears only the matching panel's attempt", () => {
    const registry = new MoocLoginRegistry()
    const interrupt = vi.fn()
    const invocation = registry.start(42, interrupt)
    // A cancel for some other panel id is a no-op.
    registry.cancel(99)
    expect(interrupt).not.toHaveBeenCalled()
    expect(registry.isCurrent(invocation)).toBe(true)
    // The matching cancel kills the process and clears the entry.
    registry.cancel(42)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(registry.isCurrent(invocation)).toBe(false)
  })

  test("cancelAll interrupts and clears any in-flight attempt (dispose/navigation)", () => {
    const registry = new MoocLoginRegistry()
    const interrupt = vi.fn()
    const invocation = registry.start(1, interrupt)
    registry.cancelAll()
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(registry.isCurrent(invocation)).toBe(false)
    // Idempotent: nothing in flight means nothing to interrupt.
    registry.cancelAll()
    expect(interrupt).toHaveBeenCalledTimes(1)
  })
})

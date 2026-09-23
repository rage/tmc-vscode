import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { logout } from "../../actions/logout"
import type { ReadyActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import { withOperation } from "../../api/withOperation"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

suite("logout action", function () {
  let dialogMock: Dialog
  let deauthenticate: ReturnType<typeof vi.fn>
  let deauthenticateMooc: ReturnType<typeof vi.fn>

  function actionContext(): ReadyActionContext {
    const langs = {
      deauthenticate,
      deauthenticateMooc,
    } as unknown as Langs
    return { ...createMockActionContext({ startup: { langs } }), dialog: dialogMock }
  }

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    deauthenticate = vi.fn(async () => Ok.EMPTY)
    deauthenticateMooc = vi.fn(async () => Ok.EMPTY)
  })

  test("logs out of both backends when both succeed", async function () {
    const result = await logout(actionContext())
    expect(result.ok).toBe(true)
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
  })

  test("returns the tmc failure without reporting it, when only tmc fails", async function () {
    const error = new Error("tmc logout failed")
    deauthenticate = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain("Failed to log out")
    expect((result.val as Error).cause).toBe(error)
    expect(dialogMock.reportError).not.toHaveBeenCalled()
  })

  test("returns the mooc failure without reporting it, when only mooc fails", async function () {
    const error = new Error("mooc logout failed")
    deauthenticateMooc = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain("courses.mooc.fi")
    expect((result.val as Error).cause).toBe(error)
    expect(dialogMock.reportError).not.toHaveBeenCalled()
  })

  test("still attempts the mooc logout when the tmc logout throws instead of returning an Err", async function () {
    // Regression test: an earlier `logout` relied on deauthenticate calls
    // never rejecting; this guards against that assumption breaking.
    const error = new Error("tmc logout exploded")
    deauthenticate = vi.fn(async () => {
      throw error
    })
    const result = await logout(actionContext())
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect((result.val as Error).cause).toBe(error)
    expect(dialogMock.reportError).not.toHaveBeenCalled()
  })

  test("still attempts the tmc logout when the mooc logout throws instead of returning an Err", async function () {
    const error = new Error("mooc logout exploded")
    deauthenticateMooc = vi.fn(async () => {
      throw error
    })
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect((result.val as Error).cause).toBe(error)
    expect(dialogMock.reportError).not.toHaveBeenCalled()
  })

  test("warns the mooc failure it does not return, when both backends fail", async function () {
    const tmcError = new Error("tmc logout failed")
    const moocError = new Error("mooc logout failed")
    deauthenticate = vi.fn(async () => Err(tmcError))
    deauthenticateMooc = vi.fn(async () => Err(moocError))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(dialogMock.reportError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("courses.mooc.fi"),
      moocError,
      "mooc",
    )
    expect(result.err).toBe(true)
    expect((result.val as Error).cause).toBe(tmcError)
  })

  // Composed exactly like `commands/logout.ts`, to prove the failure is
  // reported exactly once end to end, not zero or twice.
  test("withOperation reports exactly one notification when a single backend fails", async function () {
    deauthenticateMooc = vi.fn(async () => Err(new Error("mooc logout failed")))
    await withOperation(dialogMock, { failure: "Failed to log out." }, () =>
      logout(actionContext()),
    )
    expect(dialogMock.reportError).toHaveBeenCalledTimes(1)
  })

  test("withOperation reports exactly two notifications when both backends fail", async function () {
    deauthenticate = vi.fn(async () => Err(new Error("tmc logout failed")))
    deauthenticateMooc = vi.fn(async () => Err(new Error("mooc logout failed")))
    await withOperation(dialogMock, { failure: "Failed to log out." }, () =>
      logout(actionContext()),
    )
    expect(dialogMock.reportError).toHaveBeenCalledTimes(2)
  })
})

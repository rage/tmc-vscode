import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { logout } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import { createDialogMock } from "../mocks/dialog"

suite("logout action", function () {
  let dialogMock: Dialog
  let deauthenticate: ReturnType<typeof vi.fn>
  let deauthenticateMooc: ReturnType<typeof vi.fn>

  function actionContext(): ActionContext {
    const langs = {
      deauthenticate,
      deauthenticateMooc,
    } as unknown as Langs
    return {
      dialog: dialogMock,
      langs: new Ok(langs),
    } as unknown as ActionContext
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

  test("still attempts the mooc logout when the tmc logout fails", async function () {
    const error = new Error("tmc logout failed")
    deauthenticate = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      error,
    )
  })

  test("still attempts the tmc logout when the mooc logout fails, and reports it", async function () {
    const error = new Error("mooc logout failed")
    deauthenticateMooc = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      error,
    )
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
    expect(result.val).toBe(error)
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      error,
    )
  })

  test("still attempts the tmc logout when the mooc logout throws instead of returning an Err", async function () {
    const error = new Error("mooc logout exploded")
    deauthenticateMooc = vi.fn(async () => {
      throw error
    })
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      error,
    )
  })

  test("attempts both regardless of outcome and surfaces both failures individually", async function () {
    const tmcError = new Error("tmc logout failed")
    const moocError = new Error("mooc logout failed")
    deauthenticate = vi.fn(async () => Err(tmcError))
    deauthenticateMooc = vi.fn(async () => Err(moocError))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      tmcError,
    )
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      moocError,
    )
    expect(result.err).toBe(true)
    expect(result.val).toBe(tmcError)
  })
})

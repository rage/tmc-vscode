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

  function actionContext(): ReadyActionContext {
    const langs = { deauthenticate } as unknown as Langs
    return { ...createMockActionContext({ startup: { langs } }), dialog: dialogMock }
  }

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    deauthenticate = vi.fn(async () => Ok.EMPTY)
  })

  test("logs out once, without asking about the session again", async function () {
    const context = actionContext()
    const result = await logout(context)
    expect(result.ok).toBe(true)
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(context.authState.refresh).not.toHaveBeenCalled()
  })

  // Some credential may be gone by then, and only a check says whether a session is left.
  test("a failed logout checks the session again and returns the failure unreported", async function () {
    const error = new Error("logout failed")
    deauthenticate = vi.fn(async () => Err(error))
    const context = actionContext()
    const result = await logout(context)
    expect(result.val).toBe(error)
    expect(context.authState.refresh).toHaveBeenCalledOnce()
    expect(dialogMock.reportError).not.toHaveBeenCalled()
  })

  // Composed exactly like `commands/logout.ts`, to prove the failure is
  // reported exactly once end to end, not zero or twice.
  test("withOperation reports a failed logout once", async function () {
    deauthenticate = vi.fn(async () => Err(new Error("logout failed")))
    await withOperation(dialogMock, { failure: "Failed to log out." }, () =>
      logout(actionContext()),
    )
    expect(dialogMock.reportError).toHaveBeenCalledTimes(1)
  })
})

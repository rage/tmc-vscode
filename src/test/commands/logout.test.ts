import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { logout } from "../../commands/logout"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  logout: vi.fn(async () => Ok.EMPTY),
}))

function context(): ReadyActionContext {
  return { ...createMockActionContext(), dialog: createDialogMock()[0] }
}

suite("logout command", function () {
  beforeEach(function () {
    vi.mocked(actions.logout).mockReset().mockResolvedValue(Ok.EMPTY)
  })

  test("logs out without asking, and says so in the status bar", async function () {
    const actionContext = context()

    await logout(actionContext)

    expect(actionContext.dialog.confirm).not.toHaveBeenCalled()
    expect(actions.logout).toHaveBeenCalledOnce()
    expect(actionContext.dialog.statusMessage).toHaveBeenCalledExactlyOnceWith("Logged out.")
    expect(actionContext.dialog.notification).not.toHaveBeenCalled()
  })

  test("reports a failure once, through withOperation, and announces no success", async function () {
    vi.mocked(actions.logout).mockResolvedValue(Err(new Error("deauthentication failed")))
    const actionContext = context()

    await logout(actionContext)

    expect(actionContext.dialog.statusMessage).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledOnce()
  })
})

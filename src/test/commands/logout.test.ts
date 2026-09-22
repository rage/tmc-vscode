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

function contextWith(
  confirmed: boolean,
): [ReadyActionContext, ReturnType<typeof createDialogMock>[0]] {
  const [dialog, values] = createDialogMock()
  values.confirmation = confirmed
  const notification = vi.fn(async () => undefined)
  dialog.notification = notification
  return [{ ...createMockActionContext(), dialog }, dialog]
}

suite("logout command", function () {
  afterEach(function () {
    vi.mocked(actions.logout).mockClear()
  })

  test("logs out and announces success once the user confirms", async function () {
    const [context, dialog] = contextWith(true)

    await logout(context)

    expect(actions.logout).toHaveBeenCalledOnce()
    expect(vi.mocked(dialog.notification)).toHaveBeenCalledExactlyOnceWith("Logged out.")
  })

  test("does nothing when the user declines", async function () {
    const [context, dialog] = contextWith(false)

    await logout(context)

    expect(actions.logout).not.toHaveBeenCalled()
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  // `actions.logout` already shows the user why, so a second notification here
  // would say the same thing twice.
  test("stays quiet on failure, since the action layer already reported it", async function () {
    vi.mocked(actions.logout).mockResolvedValue(Err(new Error("deauthentication failed")))
    const [context, dialog] = contextWith(true)

    await logout(context)

    expect(dialog.notification).not.toHaveBeenCalled()
  })
})

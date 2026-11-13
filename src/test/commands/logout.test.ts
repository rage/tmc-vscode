import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { logout } from "../../commands/logout"
import { submissionViews } from "../../ui/submissionViews"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  logout: vi.fn(async () => Ok.EMPTY),
}))

function context(exercisesOnDisk: unknown[] = []): ReadyActionContext {
  const base = createMockActionContext({
    startup: { workspaceManager: { getExercises: () => exercisesOnDisk } as never },
  })
  return { ...base, dialog: createDialogMock()[0] }
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

  test("closes the submissions shown, and leaves the next login a question when exercises remain", async function () {
    const cleared = vi.fn()
    const subscription = submissionViews.onDidClear(cleared)
    onTestFinished(() => subscription.dispose())
    const actionContext = context([{}])

    await logout(actionContext)

    expect(cleared).toHaveBeenCalledOnce()
    expect(await actionContext.startup.accountHandover.takeLogout()).toBe(true)
  })

  test("leaves no question for the next login when no exercise is on disk", async function () {
    const actionContext = context()

    await logout(actionContext)

    expect(await actionContext.startup.accountHandover.takeLogout()).toBe(false)
  })
})

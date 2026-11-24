import { vi } from "vitest"
import type * as vscode from "vscode"

import type { MoocAccountActions } from "../../api/moocAuthenticationProvider"
import { MoocAuthenticationProvider } from "../../api/moocAuthenticationProvider"

function harness(
  isLoggedIn: boolean,
  label?: { current: string | undefined },
): {
  provider: MoocAuthenticationProvider
  account: MoocAccountActions
} {
  let loggedIn = isLoggedIn
  const account = {
    isLoggedIn: () => loggedIn,
    accountLabel: () => label?.current,
    login: vi.fn(async () => {
      loggedIn = true
      return true
    }),
    logout: vi.fn(async () => {}),
  }
  return {
    provider: new MoocAuthenticationProvider(account),
    account,
  }
}

suite("MoocAuthenticationProvider", function () {
  test("lists the logged-in account and never hands out a token", async function () {
    const { provider } = harness(true)

    const sessions = await provider.getSessions(undefined)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.account.label).toBe("courses.mooc.fi")
    expect(sessions[0]?.accessToken).toBe("")
  })

  test("lists nothing while logged out, or for scopes it does not grant", async function () {
    expect(await harness(false).provider.getSessions(undefined)).toEqual([])
    expect(await harness(true).provider.getSessions(["exercise-services"])).toEqual([])
  })

  test("signs in with the device-flow login", async function () {
    const { provider, account } = harness(false)

    const session = await provider.createSession([])

    expect(account.login).toHaveBeenCalledOnce()
    expect(session.account.label).toBe("courses.mooc.fi")
  })

  test("a login that does not succeed creates no session", async function () {
    const { provider, account } = harness(false)
    vi.mocked(account.login).mockResolvedValue(false)

    await expect(provider.createSession([])).rejects.toThrow()
  })

  test("refuses scopes without starting a login", async function () {
    const { provider, account } = harness(false)

    await expect(provider.createSession(["exercise-services"])).rejects.toThrow()
    expect(account.login).not.toHaveBeenCalled()
  })

  test("signs out through the extension's logout", async function () {
    const { provider, account } = harness(true)

    await provider.removeSession()

    expect(account.logout).toHaveBeenCalledOnce()
  })

  test("tells the Accounts menu when the login state changes", function () {
    const { provider } = harness(false)
    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = []
    provider.onDidChangeSessions((event) => void events.push(event))

    provider.setLoggedIn(true)
    provider.setLoggedIn(false)

    expect(events.map((event) => [event.added?.length, event.removed?.length])).toEqual([
      [1, 0],
      [0, 1],
    ])
  })

  test("a named account replaces the unnamed entry, leaving exactly one", async function () {
    const label: { current: string | undefined } = { current: undefined }
    const { provider } = harness(true, label)
    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = []
    provider.onDidChangeSessions((event) => void events.push(event))

    label.current = "Ada (ada@example.com)"
    provider.setLoggedIn(true)
    provider.setLoggedIn(true)

    const sessions = await provider.getSessions(undefined)
    expect(sessions.map((session) => session.account.label)).toEqual([
      "Ada (ada@example.com) (courses.mooc.fi)",
    ])
    expect(events).toHaveLength(1)
    expect(events[0]?.removed?.map((session) => session.account.label)).toEqual(["courses.mooc.fi"])
    expect(events[0]?.added?.map((session) => session.account.label)).toEqual([
      "Ada (ada@example.com) (courses.mooc.fi)",
    ])
  })
})

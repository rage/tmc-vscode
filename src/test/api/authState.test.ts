import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { createAuthState } from "../../api/authState"
import type Langs from "../../api/langs"
import { Logger, LogLevel } from "../../utilities"

function harness(answers: boolean[] = []): {
  authState: ReturnType<typeof createAuthState>
  isAuthenticated: ReturnType<typeof vi.fn>
  setLoggedIn: ReturnType<typeof vi.fn>
  loggedInContext: () => unknown[]
} {
  const remaining = [...answers]
  const isAuthenticated = vi.fn(async () => {
    const answer = remaining.shift()
    return answer === undefined ? Err(new Error("check failed")) : Ok(answer)
  })
  const setLoggedIn = vi.fn()
  const authState = createAuthState(new Ok({ isAuthenticated } as unknown as Langs))
  authState.subscribe(setLoggedIn)

  return {
    authState,
    isAuthenticated,
    setLoggedIn,
    loggedInContext: () =>
      vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter((call) => call[1] === "test-my-code:LoggedIn")
        .map((call) => call[2]),
  }
}

suite("AuthState", function () {
  beforeEach(function () {
    Logger.configure(LogLevel.None)
    vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("records what the check answered", async function () {
    const { authState, setLoggedIn, loggedInContext } = harness([true])

    await authState.refresh()

    expect(authState.loggedIn).toBe(true)
    expect(loggedInContext()).toEqual([true])
    expect(setLoggedIn).toHaveBeenCalledExactlyOnceWith(true)
  })

  // Every reissue is a tree re-render and a `when`-clause re-evaluation for the
  // whole manifest.
  test("an unchanged status is applied once, not once per check", async function () {
    const { authState, setLoggedIn, loggedInContext } = harness([true, true])

    await authState.refresh()
    await authState.refresh()

    expect(loggedInContext()).toEqual([true])
    expect(setLoggedIn).toHaveBeenCalledExactlyOnceWith(true)
  })

  // A failed check says nothing about the session, so treating it as a logout
  // would sign the user out of the UI whenever the CLI hiccups.
  test("a failed check keeps the last answer", async function () {
    const { authState, loggedInContext } = harness([true])

    await authState.refresh()
    const checked = await authState.refresh()

    expect(checked.err).toBe(true)
    expect(authState.loggedIn).toBe(true)
    expect(loggedInContext()).toEqual([true])
  })

  test("checks requested while one runs share it", async function () {
    const { authState, isAuthenticated } = harness([true, false])

    const [first, second] = await Promise.all([authState.refresh(), authState.refresh()])

    expect(isAuthenticated).toHaveBeenCalledTimes(1)
    expect(first.val).toBe(true)
    expect(second.val).toBe(true)
  })

  test("setting the session tells the subscribers", async function () {
    const { authState, setLoggedIn, loggedInContext } = harness([true])

    await authState.refresh()
    await authState.set(false)

    expect(authState.loggedIn).toBe(false)
    expect(loggedInContext()).toEqual([true, false])
    expect(setLoggedIn.mock.calls).toEqual([[true], [false]])
  })
})

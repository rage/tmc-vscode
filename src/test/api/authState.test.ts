import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { createAuthState } from "../../api/authState"
import type Langs from "../../api/langs"
import { Logger, LogLevel } from "../../utilities"

function harness(answers: { tmc?: boolean[]; mooc?: boolean[] } = {}): {
  authState: ReturnType<typeof createAuthState>
  setLoggedIn: ReturnType<typeof vi.fn>
  loggedInContext: () => unknown[]
} {
  const tmcAnswers = [...(answers.tmc ?? [])]
  const moocAnswers = [...(answers.mooc ?? [])]
  const langs = {
    isAuthenticated: vi.fn(async () => {
      const answer = tmcAnswers.shift()
      return answer === undefined ? Err(new Error("tmc check failed")) : Ok(answer)
    }),
    isMoocAuthenticated: vi.fn(async () => {
      const answer = moocAnswers.shift()
      return answer === undefined ? Err(new Error("mooc check failed")) : Ok(answer)
    }),
  } as unknown as Langs
  const setLoggedIn = vi.fn()
  const ui = { treeDP: { setLoggedIn } }

  return {
    authState: createAuthState(new Ok(langs), ui),
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

  test("either backend on its own counts as logged in", async function () {
    const { authState, setLoggedIn, loggedInContext } = harness({ tmc: [false], mooc: [true] })

    await authState.refresh()

    expect(authState.loggedIn).toBe(true)
    expect(loggedInContext()).toEqual([true])
    expect(setLoggedIn).toHaveBeenCalledExactlyOnceWith(true)
  })

  // Every reissue is a tree re-render and a `when`-clause re-evaluation for the
  // whole manifest.
  test("an unchanged status is applied once, not once per check", async function () {
    const { authState, setLoggedIn, loggedInContext } = harness({
      tmc: [true, true],
      mooc: [false, false],
    })

    await authState.refresh()
    await authState.refresh()

    expect(loggedInContext()).toEqual([true])
    expect(setLoggedIn).toHaveBeenCalledExactlyOnceWith(true)
  })

  // A failed check says nothing about the session, so treating it as a logout
  // would sign the user out of the UI whenever the CLI hiccups.
  test("a failed check keeps the answer the backend last gave", async function () {
    const { authState, loggedInContext } = harness({ tmc: [true], mooc: [false, false] })

    await authState.refresh()
    const checked = await authState.refresh()

    expect(checked.tmc.err).toBe(true)
    expect(authState.tmc).toBe(true)
    expect(loggedInContext()).toEqual([true])
  })

  test("clearing drops both sessions and tells the subscribers", async function () {
    const { authState, setLoggedIn, loggedInContext } = harness({ tmc: [true], mooc: [true] })
    const seen: boolean[] = []
    authState.subscribe((loggedIn) => seen.push(loggedIn))

    await authState.refresh()
    await authState.clear()

    expect(authState.loggedIn).toBe(false)
    expect(seen).toEqual([true, false])
    expect(loggedInContext()).toEqual([true, false])
    expect(setLoggedIn.mock.calls).toEqual([[true], [false]])
  })

  // Each check is a cold CLI start against an independent backend, and both are
  // given the same timeout, so running them in sequence doubles the bound the
  // caller asked for.
  test("checks the two backends at once, not one after the other", async function () {
    const events: string[] = []
    // The yield is what makes the order observable: without it each check would
    // run to completion before the other was even called, sequential or not.
    const langs = {
      isAuthenticated: vi.fn(async () => {
        events.push("tmc started")
        await Promise.resolve()
        events.push("tmc answered")
        return Ok(true)
      }),
      isMoocAuthenticated: vi.fn(async () => {
        events.push("mooc started")
        await Promise.resolve()
        events.push("mooc answered")
        return Ok(false)
      }),
    } as unknown as Langs
    const ui = { treeDP: { setLoggedIn: vi.fn() } }

    await createAuthState(new Ok(langs), ui).refresh()

    expect(events).toEqual(["tmc started", "mooc started", "tmc answered", "mooc answered"])
  })

  test("a login event for one backend does not claim the other", async function () {
    const { authState } = harness({ tmc: [false], mooc: [false] })

    await authState.refresh()
    await authState.set("mooc", true)

    expect(authState.mooc).toBe(true)
    expect(authState.tmc).toBe(false)
  })
})

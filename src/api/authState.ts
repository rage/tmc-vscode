import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { BackendKind } from "../shared/shared"
import { Logger } from "../utilities"
import type Langs from "./langs"

/** What one {@link AuthState.refresh} observed, per backend. */
export type AuthCheck = Record<BackendKind, Result<boolean, Error>>

/**
 * The extension's single answer to "is the user logged in".
 *
 * Every consumer reads it from here rather than asking the CLI: a check is a
 * cold process start, and the answers have to agree across the context key, the
 * tree view, the background poll and the actions.
 */
export interface AuthState {
  /** Whether the tmc backend can be authenticated. */
  readonly tmc: boolean
  /** Whether courses.mooc.fi has a usable access token. */
  readonly mooc: boolean
  /**
   * Whether either backend has a session. The two credentials are independent,
   * and this is what gates every logged-in affordance.
   */
  readonly loggedIn: boolean
  /**
   * Asks the CLI about both backends and records what it said.
   *
   * A backend whose check fails keeps its previous answer — a failed check says
   * nothing about the session — so the returned errors are for reporting, not
   * for deciding what the state now is. The two calls run at once, so `timeout`
   * bounds each of them and the call as a whole.
   */
  refresh: (options?: { timeout: number }) => Promise<AuthCheck>
  /** Records what a login or logout event just reported for one backend. */
  set: (backend: BackendKind, authenticated: boolean) => Promise<void>
  /** Forgets both sessions, for a wipe or a sign-out of everything. */
  clear: () => Promise<void>
  /** Called whenever {@link loggedIn} changes, after the change is applied. */
  subscribe: (listener: (loggedIn: boolean) => void) => void
}

/** The part of the tree view {@link createAuthState} keeps in step with the session. */
interface LoggedInView {
  treeDP: { setLoggedIn: (loggedIn: boolean) => void }
}

/**
 * Builds the {@link AuthState} for one activation.
 *
 * It applies `test-my-code:LoggedIn` and the tree view's logged-in half itself,
 * so nothing else may set either.
 */
export function createAuthState(langs: Result<Langs, Error>, ui: LoggedInView): AuthState {
  const authenticated: Record<BackendKind, boolean> = { tmc: false, mooc: false }
  const listeners: ((loggedIn: boolean) => void)[] = []
  let applied: boolean | undefined

  const apply = async (): Promise<void> => {
    const loggedIn = authenticated.tmc || authenticated.mooc
    if (loggedIn === applied) {
      return
    }
    applied = loggedIn
    await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", loggedIn)
    ui.treeDP.setLoggedIn(loggedIn)
    for (const listener of listeners) {
      listener(loggedIn)
    }
  }

  return {
    get tmc(): boolean {
      return authenticated.tmc
    },
    get mooc(): boolean {
      return authenticated.mooc
    },
    get loggedIn(): boolean {
      return authenticated.tmc || authenticated.mooc
    },
    async refresh(options): Promise<AuthCheck> {
      if (langs.err) {
        Logger.warn("Could not check login status")
        await apply()
        return { tmc: Ok(false), mooc: Ok(false) }
      }
      const [tmc, mooc] = await Promise.all([
        langs.val.isAuthenticated(options),
        langs.val.isMoocAuthenticated(options),
      ])
      if (tmc.ok) {
        authenticated.tmc = tmc.val
      }
      if (mooc.ok) {
        authenticated.mooc = mooc.val
      }
      await apply()
      return { tmc, mooc }
    },
    async set(backend, value): Promise<void> {
      authenticated[backend] = value
      await apply()
    },
    async clear(): Promise<void> {
      authenticated.tmc = false
      authenticated.mooc = false
      await apply()
    },
    subscribe(listener): void {
      listeners.push(listener)
    },
  }
}

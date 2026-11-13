import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { BackendKind } from "../../shared/lib"
import { Logger } from "../utilities"
import type Langs from "./langs"

/**
 * The extension's single answer to "is the user logged in".
 *
 * Every consumer reads it from here rather than asking the CLI: a check is a
 * cold process start, and the answers have to agree across the context key, the
 * Courses view, the background poll and the actions.
 */
export interface AuthState {
  /** Whether the user has a session; see `Langs.isAuthenticated`. */
  readonly loggedIn: boolean
  /**
   * Asks the CLI whether the user has a session and records the answer. A check that
   * fails keeps the previous answer, as it says nothing about the session. Calls made
   * while a check runs share it.
   */
  refresh: (options?: { timeout: number }) => Promise<Result<boolean, Error>>
  /** Records what a login or logout just did to the session. */
  set: (loggedIn: boolean) => Promise<void>
  /**
   * A session this run had ended without a logout. Stays set until the next login: a later
   * check finding no session is the same expiry, not a logout.
   */
  readonly isSessionExpired: boolean
  /** Records that the session ended without the user logging out. */
  markSessionExpired: () => void
  /** Called whenever {@link loggedIn} or {@link isSessionExpired} changes, once applied. */
  subscribe: (listener: (loggedIn: boolean) => void) => void
  /**
   * The backends whose refusal of the session the user has been told about: courses.mooc.fi
   * granting no access to programming exercises, or tmc.mooc.fi not accepting the login.
   * Whoever reports one adds its backend, and a fetch that backend serves removes it.
   */
  readonly sessionRefusalsReported: Set<BackendKind>
}

/**
 * Builds the {@link AuthState} for one activation.
 *
 * It applies `test-my-code:LoggedIn` itself, so nothing else may set it.
 */
export function createAuthState(langs: Result<Langs, Error>): AuthState {
  let loggedIn = false
  let isSessionExpired = false
  let applied: boolean | undefined
  let appliedExpiry = false
  let checking: Promise<Result<boolean, Error>> | undefined
  const listeners: ((loggedIn: boolean) => void)[] = []

  const notify = (): void => {
    appliedExpiry = isSessionExpired
    for (const listener of listeners) {
      listener(loggedIn)
    }
  }

  const apply = async (): Promise<void> => {
    if (loggedIn) {
      isSessionExpired = false
    }
    if (loggedIn !== applied) {
      applied = loggedIn
      await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", loggedIn)
      notify()
    } else if (isSessionExpired !== appliedExpiry) {
      notify()
    }
  }

  const check = async (options?: { timeout: number }): Promise<Result<boolean, Error>> => {
    if (langs.err) {
      Logger.warn("Could not check login status")
      await apply()
      return Ok(false)
    }
    const checked = await langs.val.isAuthenticated(options)
    if (checked.ok) {
      loggedIn = checked.val
    }
    await apply()
    return checked
  }

  return {
    get loggedIn(): boolean {
      return loggedIn
    },
    refresh(options): Promise<Result<boolean, Error>> {
      checking ??= check(options).finally(() => {
        checking = undefined
      })
      return checking
    },
    async set(value): Promise<void> {
      loggedIn = value
      await apply()
    },
    get isSessionExpired(): boolean {
      return isSessionExpired
    },
    markSessionExpired(): void {
      if (!isSessionExpired) {
        isSessionExpired = true
        notify()
      }
    },
    subscribe(listener): void {
      listeners.push(listener)
    },
    sessionRefusalsReported: new Set(),
  }
}

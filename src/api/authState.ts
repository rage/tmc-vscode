import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { BackendKind } from "../../shared/lib"
import { Logger } from "../utilities"
import type Langs from "./langs"
import type { Session } from "./langs"

/**
 * The extension's single answer to "is the user logged in". Consumers read it here instead of
 * asking the CLI: a check is a cold process start, and the answers must agree everywhere.
 */
export interface AuthState {
  /** Whether the user has a session; see `Langs.isAuthenticated`. */
  readonly loggedIn: boolean
  /** The session the last check found; `undefined` without one or before any check. */
  readonly session: Session | undefined
  /**
   * Asks the CLI whether the user has a session and records the answer. A failed check keeps
   * the previous answer. Calls made while a check runs share it.
   */
  refresh: (options?: { timeout: number }) => Promise<Result<boolean, Error>>
  /** Records what a login or logout just did to the session. */
  set: (loggedIn: boolean) => Promise<void>
  /**
   * A session this run had ended without a logout. Stays set until the next login: a later
   * check finding no session is the same expiry, and one finding credentials finds the ones the
   * backend refused, which the CLI keeps when it cannot refresh them.
   */
  readonly isSessionExpired: boolean
  /** Records that the session ended without the user logging out. */
  markSessionExpired: () => void
  /** Called whenever {@link loggedIn} or {@link isSessionExpired} changes, once applied. */
  subscribe: (listener: (loggedIn: boolean) => void) => void
  /**
   * Backends whose refusal of the session the user has been told about (courses.mooc.fi
   * granting no access to programming exercises, tmc.mooc.fi rejecting the login). Reporters
   * add their backend; a fetch that backend serves removes it.
   */
  readonly sessionRefusalsReported: Set<BackendKind>
}

/** Builds the {@link AuthState} for one activation; it alone sets `test-my-code:LoggedIn`. */
export function createAuthState(langs: Result<Langs, Error>): AuthState {
  let loggedIn = false
  let session: Session | undefined
  let appliedAccountKey: string | undefined
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

  const accountKey = (): string | undefined =>
    session && JSON.stringify(session.kind === "mooc" ? (session.account ?? null) : "tmc")

  const apply = async (): Promise<void> => {
    if (loggedIn !== applied) {
      applied = loggedIn
      appliedAccountKey = accountKey()
      await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", loggedIn)
      notify()
    } else if (isSessionExpired !== appliedExpiry || accountKey() !== appliedAccountKey) {
      appliedAccountKey = accountKey()
      notify()
    }
  }

  const check = async (options?: { timeout: number }): Promise<Result<boolean, Error>> => {
    if (langs.err) {
      Logger.warn("Could not check login status")
      await apply()
      return Ok(false)
    }
    const checked = await langs.val.getSession(options)
    if (checked.ok) {
      session = checked.val
      loggedIn = session !== undefined
    }
    await apply()
    return checked.map((found) => found !== undefined)
  }

  return {
    get loggedIn(): boolean {
      return loggedIn
    },
    get session(): Session | undefined {
      return session
    },
    refresh(options): Promise<Result<boolean, Error>> {
      checking ??= check(options).finally(() => {
        checking = undefined
      })
      return checking
    },
    async set(value): Promise<void> {
      loggedIn = value
      if (value) {
        isSessionExpired = false
      } else {
        session = undefined
      }
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

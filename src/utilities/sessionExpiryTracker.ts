export type Backend = "tmc" | "mooc"

export interface SessionExpiryTracker {
  /** Call after each background auth check. Warns once if a previously-authenticated backend is now not, until the next login. */
  onAuthChecked: (backend: Backend, authenticated: boolean) => void
  /** Call when an explicit login for `backend` succeeds. */
  onLogin: (backend: Backend) => void
  /** Call on logout. `expected` (user-initiated) never warns and clears the dedup state; unexpected warns once. */
  onLogout: (backend: Backend, expected: boolean) => void
  /**
   * Forgets everything known about `backend` without claiming it has a session.
   * A later `onAuthChecked` with `true` is what re-arms the expiry warning.
   */
  reset: (backend: Backend) => void
}

/**
 * Dedup state so both the reactive login/logout events and a background poll
 * can trigger the same re-login prompt without double-firing or firing for a
 * backend that was never logged in this run.
 */
export function createSessionExpiryTracker(
  initiallyAuthenticated: Readonly<Record<Backend, boolean>>,
  onExpired: (backend: Backend) => void,
): SessionExpiryTracker {
  const hadSession: Record<Backend, boolean> = { ...initiallyAuthenticated }
  const warnedExpired: Record<Backend, boolean> = { tmc: false, mooc: false }

  const warnOnce = (backend: Backend): void => {
    if (!warnedExpired[backend]) {
      onExpired(backend)
      warnedExpired[backend] = true
    }
  }

  return {
    onAuthChecked(backend, authenticated) {
      if (authenticated) {
        hadSession[backend] = true
        warnedExpired[backend] = false
      } else if (hadSession[backend]) {
        warnOnce(backend)
      }
    },
    onLogin(backend) {
      hadSession[backend] = true
      warnedExpired[backend] = false
    },
    onLogout(backend, expected) {
      if (!expected) {
        warnOnce(backend)
      } else {
        // Explicit, intentional logout: a later poll observing "not
        // authenticated" must not treat this as an expired session.
        hadSession[backend] = false
      }
    },
    reset(backend) {
      hadSession[backend] = false
      warnedExpired[backend] = false
    },
  }
}

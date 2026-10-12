/** Decides when the session has expired, as opposed to having been logged out of. */
export interface SessionExpiryTracker {
  /** Call after each check of the session. Warns once when a session this run had is gone, until the next login. */
  onAuthChecked: (authenticated: boolean) => void
  /** Call when a login succeeds. */
  onLogin: () => void
  /** Call when the user logs out, which never warns. */
  onLogout: () => void
}

/**
 * Dedup state so the checks that follow a rejected credential and the background poll can
 * both notice an expiry without warning twice, or warning someone who never had a session.
 */
export function createSessionExpiryTracker(
  initiallyAuthenticated: boolean,
  onExpired: () => void,
): SessionExpiryTracker {
  let hadSession = initiallyAuthenticated
  let hasWarned = false

  return {
    onAuthChecked(authenticated) {
      if (authenticated) {
        hadSession = true
        hasWarned = false
      } else if (hadSession && !hasWarned) {
        onExpired()
        hasWarned = true
      }
    },
    onLogin() {
      hadSession = true
      hasWarned = false
    },
    onLogout() {
      hadSession = false
    },
  }
}

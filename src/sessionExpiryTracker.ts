/** Decides when the session has expired, as opposed to having been logged out of. */
export interface SessionExpiryTracker {
  /**
   * Call after each check of the session. Warns once when a session this run had is gone, until
   * the next login.
   *
   * @param cause The rejection that prompted the check, if one did; it is warned about once, by
   * whichever of this and {@link onSessionLost} sees it first.
   */
  onAuthChecked: (authenticated: boolean, cause?: Error) => void
  /**
   * Call when an operation the user asked for failed on a lost session. Warns once per `cause`.
   *
   * @returns Whether the failure is an expiry; `false` when there was no session to lose, as
   * after a logout.
   */
  onSessionLost: (cause: Error) => boolean
  /** Call when a login succeeds. */
  onLogin: () => void
  /** Call when the user logs out, which never warns. */
  onLogout: () => void
}

/**
 * Dedup state so the checks that follow a rejected credential, the background poll and the
 * operation that hit the rejection can all notice an expiry without warning twice, or warning
 * someone who never had a session.
 */
export function createSessionExpiryTracker(
  initiallyAuthenticated: boolean,
  onExpired: () => void,
): SessionExpiryTracker {
  let hadSession = initiallyAuthenticated
  let hasWarned = false
  const warnedCauses = new WeakSet<Error>()

  function warn(cause: Error | undefined): void {
    if (cause) {
      warnedCauses.add(cause)
    }
    hasWarned = true
    onExpired()
  }

  return {
    onAuthChecked(authenticated, cause) {
      if (authenticated) {
        hadSession = true
        hasWarned = false
      } else if (cause && warnedCauses.has(cause)) {
        hasWarned = true
      } else if (hadSession && !hasWarned) {
        warn(cause)
      }
    },
    onSessionLost(cause) {
      if (!hadSession) {
        return false
      }
      if (!warnedCauses.has(cause)) {
        warn(cause)
      }
      return true
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

/** Decides whether a lost session also takes a notification; see {@link createExpiryNotifier}. */
export interface ExpiryNotifier {
  /** Call on each warning of {@link SessionExpiryTracker}. */
  onExpired: () => void
  /** Call when a login succeeds. */
  onLogin: () => void
}

/**
 * Notifies a lost session at most once until the next login, and only while no TestMyCode screen
 * is in sight, as a screen on view says it with its own Log In and the status bar item always does.
 */
export function createExpiryNotifier(
  isScreenVisible: () => boolean,
  notify: () => void,
): ExpiryNotifier {
  let hasNotified = false
  return {
    onExpired() {
      if (!hasNotified && !isScreenVisible()) {
        hasNotified = true
        notify()
      }
    },
    onLogin() {
      hasNotified = false
    },
  }
}

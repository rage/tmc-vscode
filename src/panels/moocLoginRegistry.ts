// Tracks the single in-flight courses.mooc.fi device-flow login.
//
// At most one login is live at a time (it only runs in the side panel), but
// the CLI's `mooc login` process can poll for ~15 minutes and outlives the
// panel that started it unless interrupted. This registry kills orphaned
// processes on close/navigate-away/reload, and prevents two processes from
// racing on `credentials_mooc.json` when the user retries.
//
// Each attempt gets a monotonic invocation id; work after the long `await` is
// gated on the attempt still being current, so a stale attempt stays silent.

export interface MoocLoginAttempt {
  // Distinguishes retries that reuse the same panel id ("Try again" keeps the
  // MoocLogin panel), so a superseded attempt can be told from its replacement.
  readonly invocationId: number
  readonly panelId: number
  readonly interrupt: () => void
}

export class MoocLoginRegistry {
  private _counter = 0
  private _current: MoocLoginAttempt | undefined

  /**
   * Registers a new attempt, interrupting any attempt already in flight. A
   * fresh `moocLogin` only comes from an explicit re-entry/"Try again", so
   * the old process must die to avoid racing on the credentials file.
   *
   * @returns the new attempt's invocation id.
   */
  public start(panelId: number, interrupt: () => void): number {
    this._current?.interrupt()
    const invocationId = ++this._counter
    this._current = { invocationId, panelId, interrupt }
    return invocationId
  }

  /** Whether `invocationId` is still the active attempt. */
  public isCurrent(invocationId: number): boolean {
    return this._current?.invocationId === invocationId
  }

  /** Clears the registry only if `invocationId` is still current, so a stale attempt can't delete a newer one's entry. */
  public finish(invocationId: number): void {
    if (this._current?.invocationId === invocationId) {
      this._current = undefined
    }
  }

  /** Interrupts and clears the in-flight attempt for `panelId`, if any (explicit user cancel). */
  public cancel(panelId: number): void {
    if (this._current?.panelId === panelId) {
      this._current.interrupt()
      this._current = undefined
    }
  }

  /** Interrupts and clears any in-flight attempt, regardless of panel (side-panel dispose or navigate-away). */
  public cancelAll(): void {
    this._current?.interrupt()
    this._current = undefined
  }
}

// Process-wide mooc login registry (one side panel => at most one live login).
export const moocLoginRegistry = new MoocLoginRegistry()

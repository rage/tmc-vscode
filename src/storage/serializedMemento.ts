import type * as vscode from "vscode"

/**
 * A memento whose updates reach VS Code one at a time, each after the previous one settles.
 *
 * VS Code can drop an update that overlaps another of the extension's, so the extension writes
 * `context.globalState` and `context.workspaceState` only through one of these, created once at
 * activation. `get` and `keys` already reflect an update that is still queued; a failed update
 * rejects its own promise and leaves the queue running.
 */
export class SerializedMemento implements vscode.Memento {
  /** The latest queued value of each key whose update has not settled yet. */
  private readonly _queued = new Map<string, { value: unknown }>()
  private _lastWrite: Promise<unknown> = Promise.resolve()

  public constructor(private readonly _memento: vscode.Memento) {}

  public keys(): readonly string[] {
    const keys = new Set(this._memento.keys())
    for (const [key, { value }] of this._queued) {
      if (value === undefined) {
        keys.delete(key)
      } else {
        keys.add(key)
      }
    }
    return [...keys]
  }

  public get<T>(key: string): T | undefined
  public get<T>(key: string, defaultValue: T): T
  public get<T>(key: string, defaultValue?: T): T | undefined {
    const queued = this._queued.get(key)
    const value = queued ? (queued.value as T | undefined) : this._memento.get<T>(key)
    return value === undefined ? defaultValue : value
  }

  public update(key: string, value: unknown): Promise<void> {
    const queued = { value }
    this._queued.set(key, queued)
    const write = this._lastWrite
      .then(() => this._memento.update(key, value))
      .finally(() => {
        if (this._queued.get(key) === queued) {
          this._queued.delete(key)
        }
      })
    this._lastWrite = write.catch(() => undefined)
    return write
  }
}

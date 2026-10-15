import type * as vscode from "vscode"

const SWITCH_KEY = "courseWorkspaceSwitch"

/** How long after a switch the window it opened still counts as opened by it. */
const SWITCH_TTL_MS = 2 * 60 * 1000

interface RecordedSwitch {
  workspaceFile: string
  switchedAt: number
}

/**
 * Remembers, across the reload, that a window opened a course workspace from another course's
 * or from TestMyCode, so the window it opens need not repeat what the student has just seen.
 */
export class CourseWorkspaceSwitches {
  public constructor(
    private readonly _memento: vscode.Memento,
    private readonly _now: () => number = Date.now,
  ) {}

  public async record(workspaceFile: string): Promise<void> {
    const recorded: RecordedSwitch = { workspaceFile, switchedAt: this._now() }
    await this._memento.update(SWITCH_KEY, recorded)
  }

  /**
   * Whether a switch opened `workspaceFile` moments ago. Forgets that switch, and one too old to
   * count; a switch to another file stays for the window that opens it.
   */
  public async take(workspaceFile: string | undefined): Promise<boolean> {
    const recorded = this._memento.get<RecordedSwitch>(SWITCH_KEY)
    if (!recorded) {
      return false
    }
    const isExpired = this._now() - recorded.switchedAt > SWITCH_TTL_MS
    const isThisWindow = recorded.workspaceFile === workspaceFile
    if (isExpired || isThisWindow) {
      await this._memento.update(SWITCH_KEY, undefined)
    }
    return isThisWindow && !isExpired
  }
}

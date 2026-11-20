import * as path from "path"

import * as fs from "fs-extra"

import { Logger } from "../utilities"

// Not in globalState: VS Code drops an update that overlaps another, and the window that writes
// this cannot queue behind the one it opens.
const SWITCH_FILE = "course-workspace-switch.json"

/** How long after a switch the window it opened still counts as opened by it. */
const SWITCH_TTL_MS = 2 * 60 * 1000

interface RecordedSwitch extends CourseWorkspaceSwitch {
  workspaceFile: string
  switchedAt: number
}

/** What the window that switched leaves to the window it opens. */
export interface CourseWorkspaceSwitch {
  /** The switching window showed the walkthrough, which the switch closed. */
  isWalkthroughOpen: boolean
  /** The AI-off settings the switching window wrote into the workspace file. */
  aiOffSettingsWritten: string[]
}

/**
 * Remembers, across the reload, that a window opened a course workspace from another course's
 * or from TestMyCode, so the window it opens need not repeat what the student has just seen.
 */
export class CourseWorkspaceSwitches {
  private readonly _file: string

  /** @param globalStorageFolder The extension's global storage, shared by every window. */
  public constructor(
    globalStorageFolder: string,
    private readonly _now: () => number = Date.now,
  ) {
    this._file = path.join(globalStorageFolder, SWITCH_FILE)
  }

  /** Records a switch to `workspaceFile`. Never throws: a failure is logged. */
  public async record(workspaceFile: string, state: CourseWorkspaceSwitch): Promise<void> {
    const recorded: RecordedSwitch = {
      workspaceFile,
      switchedAt: this._now(),
      isWalkthroughOpen: state.isWalkthroughOpen,
      aiOffSettingsWritten: state.aiOffSettingsWritten,
    }
    // Without it the new window only repeats what this one showed; the switch goes ahead.
    await fs
      .outputFile(this._file, JSON.stringify(recorded))
      .catch((e) => Logger.warn("Could not record the course workspace switch", e))
  }

  /**
   * The switch that opened `workspaceFile` moments ago, if one did. Forgets that switch, and one
   * too old to count; a switch to another file stays for the window that opens it.
   */
  public async take(workspaceFile: string | undefined): Promise<CourseWorkspaceSwitch | undefined> {
    const recorded = await this._read()
    if (!recorded) {
      return undefined
    }
    const isExpired =
      typeof recorded.switchedAt !== "number" || this._now() - recorded.switchedAt > SWITCH_TTL_MS
    const isThisWindow = recorded.workspaceFile === workspaceFile
    if (isExpired || isThisWindow) {
      await fs
        .remove(this._file)
        .catch((e) => Logger.warn("Could not forget the course workspace switch", e))
    }
    return isThisWindow && !isExpired
      ? {
          isWalkthroughOpen: recorded.isWalkthroughOpen === true,
          aiOffSettingsWritten: Array.isArray(recorded.aiOffSettingsWritten)
            ? recorded.aiOffSettingsWritten
            : [],
        }
      : undefined
  }

  /** The recorded switch; `undefined` for none, or one that cannot be read. */
  private async _read(): Promise<Partial<RecordedSwitch> | undefined> {
    try {
      const recorded: unknown = JSON.parse(await fs.readFile(this._file, "utf8"))
      return typeof recorded === "object" && recorded !== null
        ? (recorded as Partial<RecordedSwitch>)
        : undefined
    } catch {
      return undefined
    }
  }
}

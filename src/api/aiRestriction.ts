import * as _ from "lodash"
import * as vscode from "vscode"

import { AI_OFF_SETTINGS } from "../config/constants"
import type { UserData } from "../config/userdata"
import type { LocalCourseData } from "../shared/shared"
import { match } from "../shared/shared"
import { Logger } from "../utilities"
import type WorkspaceManager from "./workspaceManager"

/** `workspaceState` key: the {@link AI_OFF_SETTINGS} sections this extension wrote into the workspace file. */
const OWNED_SECTIONS_KEY = "aiOffSettingsOwned"

/** Passes that had to write, per minute, before a setting that keeps flipping back is left alone. */
const MAX_WRITING_PASSES_PER_MINUTE = 10

/**
 * Whether the course's teacher has explicitly allowed AI use, the only case in which its
 * workspace keeps AI assistance on. An unknown course is not allowed.
 */
export function isAiAllowed(course: LocalCourseData | undefined): boolean {
  if (!course) {
    return false
  }
  return match(
    course,
    // tmc-server has no AI policy.
    () => false,
    // The seam for the planned mooc course AI policy: true only for the value that allows AI
    // use outright; "limited" and "planning only" are not allowed.
    () => false,
  )
}

/** {@link isAiAllowed} for the open course workspace's course, looked up in `userData` if there is one. */
export function isActiveCourseAiAllowed(
  workspaceManager: Pick<WorkspaceManager, "activeCourse" | "activeCourseBackend">,
  userData: UserData | undefined,
): boolean {
  const slug = workspaceManager.activeCourse
  const backend = workspaceManager.activeCourseBackend
  const course = slug && backend ? userData?.getCourseBySlug(backend, slug) : undefined
  return isAiAllowed(course?.ok ? course.val : undefined)
}

type CourseWorkspaceSettings = Pick<
  WorkspaceManager,
  "activeCourse" | "getStoredWorkspaceSetting" | "replaceWorkspaceSetting"
>

/**
 * Keeps {@link AI_OFF_SETTINGS} in the open course workspace file unless its course allows AI,
 * putting back a section the student or another extension changes, and removes what it wrote
 * once the course allows AI.
 */
export default class AiRestriction implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[]
  private _pass: Promise<void> | undefined
  private _isPassRequested = false
  private _writingPassTimes: number[] = []
  private _hasGivenUp = false
  private _hasLoggedWrite = false

  /**
   * @param ownership The workspace's own `ExtensionContext.workspaceState`.
   * @param isAllowed Decides for the open course at the time of each pass.
   * @param onDidChangeCourses Course data changes, which may change the decision.
   */
  public constructor(
    private readonly _workspace: CourseWorkspaceSettings,
    private readonly _ownership: vscode.Memento,
    private readonly _isAllowed: () => boolean,
    onDidChangeCourses?: vscode.Event<unknown>,
  ) {
    this._disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          this._workspace.activeCourse &&
          Object.keys(AI_OFF_SETTINGS).some((section) => event.affectsConfiguration(section))
        ) {
          void this.apply()
        }
      }),
    ]
    if (onDidChangeCourses) {
      this._disposables.push(onDidChangeCourses(() => void this.apply()))
    }
  }

  /**
   * Writes the settings, or removes the ones this extension wrote when the course allows AI.
   * Writes only what drifted; a call during a pass runs one more pass after it. Never rejects.
   */
  public apply(): Promise<void> {
    if (this._pass) {
      this._isPassRequested = true
      return this._pass
    }
    this._pass = (async (): Promise<void> => {
      try {
        do {
          this._isPassRequested = false
          await this._applyOnce()
        } while (this._isPassRequested)
      } catch (e) {
        Logger.error("Failed to apply the course's AI settings.", e)
      } finally {
        this._pass = undefined
      }
    })()
    return this._pass
  }

  public dispose(): void {
    this._disposables.forEach((x) => x.dispose())
  }

  private async _applyOnce(): Promise<void> {
    if (!this._workspace.activeCourse) {
      return
    }
    if (this._isAllowed()) {
      await this._removeOwnedSettings()
    } else {
      await this._writeSettings()
    }
  }

  private async _writeSettings(): Promise<void> {
    const drifted = Object.entries(AI_OFF_SETTINGS).flatMap(([section, value]) => {
      const stored = this._workspace.getStoredWorkspaceSetting(section)
      const desired =
        _.isPlainObject(value) && _.isPlainObject(stored)
          ? { ...(stored as object), ...(value as object) }
          : value
      // VS Code refuses to write a setting no installed extension declares.
      return _.isEqual(stored, desired) || !isDeclared(section) ? [] : [{ section, desired }]
    })
    if (drifted.length === 0 || !this._mayWrite()) {
      return
    }

    // Claimed before writing: the last section can restart the extension host mid-pass.
    const owned = _.union(this._ownedSections(), _.map(drifted, "section"))
    await this._ownership.update(OWNED_SECTIONS_KEY, owned)
    for (const { section, desired } of drifted) {
      try {
        await this._workspace.replaceWorkspaceSetting(section, desired)
      } catch (e) {
        Logger.warn(`Could not turn off AI assistance through ${section}.`, e)
      }
    }

    const summary = `Turned AI assistance off in the course workspace through ${drifted.length} settings.`
    if (this._hasLoggedWrite) {
      Logger.debug(summary, _.map(drifted, "section"))
    } else {
      this._hasLoggedWrite = true
      Logger.info(summary)
    }
  }

  private async _removeOwnedSettings(): Promise<void> {
    const owned = this._ownedSections()
    if (owned.length === 0) {
      return
    }
    const kept: string[] = []
    for (const section of owned) {
      const stored = this._workspace.getStoredWorkspaceSetting(section)
      const remaining = withoutOwnValue(stored, AI_OFF_SETTINGS[section])
      if (_.isEqual(remaining, stored)) {
        continue
      }
      try {
        await this._workspace.replaceWorkspaceSetting(section, remaining)
      } catch (e) {
        Logger.warn(`Could not remove ${section} from the course workspace.`, e)
        kept.push(section)
      }
    }
    await this._ownership.update(OWNED_SECTIONS_KEY, kept.length > 0 ? kept : undefined)
    Logger.info("The course allows AI, so its workspace no longer turns AI assistance off.")
  }

  /** Counts a pass that has to write, and gives up on a setting something keeps flipping back. */
  private _mayWrite(): boolean {
    if (this._hasGivenUp) {
      return false
    }
    const now = Date.now()
    this._writingPassTimes = [...this._writingPassTimes.filter((t) => now - t < 60_000), now]
    if (this._writingPassTimes.length > MAX_WRITING_PASSES_PER_MINUTE) {
      this._hasGivenUp = true
      Logger.warn(
        "Something keeps turning AI assistance back on in the course workspace; " +
          "no longer turning it off until the window reloads.",
      )
      return false
    }
    return true
  }

  private _ownedSections(): string[] {
    return this._ownership.get<string[]>(OWNED_SECTIONS_KEY) ?? []
  }
}

function isDeclared(section: string): boolean {
  return vscode.workspace.getConfiguration().inspect(section)?.defaultValue !== undefined
}

/**
 * `stored` without what this extension wrote into it: `undefined` for its own value, the
 * student's own entries of a per-language map, and a value the student changed as it is.
 */
function withoutOwnValue(stored: unknown, own: unknown): unknown {
  if (_.isEqual(stored, own)) {
    return undefined
  }
  if (!_.isPlainObject(stored) || !_.isPlainObject(own)) {
    return stored
  }
  const ownEntries = own as Record<string, unknown>
  const remaining = _.omitBy(stored as Record<string, unknown>, (value, key) =>
    _.isEqual(value, ownEntries[key]),
  )
  return _.isEmpty(remaining) ? undefined : remaining
}

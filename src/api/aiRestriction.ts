import * as _ from "lodash"
import * as vscode from "vscode"

import { AI_OFF_SETTINGS, COURSE_LANGUAGE_IDS } from "../config/constants"
import type { UserData } from "../config/userdata"
import type { LocalCourseData } from "../shared/shared"
import { match } from "../shared/shared"
import { Logger } from "../utilities"
import type WorkspaceManager from "./workspaceManager"
import type { SettingInspection, WorkspaceFileProblem } from "./workspaceManager"

/** `workspaceState` key: the {@link AI_OFF_SETTINGS} sections this extension wrote into the workspace file. */
const OWNED_SECTIONS_KEY = "aiOffSettingsOwned"

/** Writes of one setting a minute before it is left alone: {@link MIN_BACKOFF_MS} at first, doubling up to {@link MAX_BACKOFF_MS}. */
const MAX_WRITES_PER_MINUTE = 5
const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 10 * 60_000

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

/** Where a student-editable setting that beats the course workspace file lives. */
export type SettingSource = { kind: "user" } | { kind: "folder"; folder: vscode.Uri }

/** Why the AI restriction is not in force in this window. */
export type AiRestrictionLapse =
  /** No course workspace is open, or its course allows AI, so nothing is turned off. */
  | { kind: "outsideCourseWorkspace" }
  /** VS Code refused to write a setting into the workspace file. */
  | {
      kind: "workspaceFileUnwritable"
      file: vscode.Uri
      problem: WorkspaceFileProblem | undefined
      /** VS Code's own reason for refusing. */
      reason: string
    }
  /** A setting the student can edit keeps a section on over the workspace file. */
  | {
      kind: "settingOverridden"
      section: string
      languageId: string | undefined
      source: SettingSource
    }

type CourseWorkspaceSettings = Pick<
  WorkspaceManager,
  | "activeCourse"
  | "getStoredWorkspaceSetting"
  | "inspectSetting"
  | "replaceWorkspaceSetting"
  | "workspaceFileProblem"
  | "workspaceFileUri"
>

/** One place a section is written: the workspace file's top level, or one `[languageId]` block. */
interface SettingTarget {
  section: string
  languageId: string | undefined
}

function targetKey({ section, languageId }: SettingTarget): string {
  return languageId === undefined ? section : `[${languageId}]${section}`
}

/** How often one target has been written, and how long it is left alone for. */
interface Backoff {
  writeTimes: number[]
  delayMs: number
  retryAt: number
}

/**
 * Keeps {@link AI_OFF_SETTINGS} in force in the open course workspace unless its course allows
 * AI: writes them into its `.code-workspace`, puts back a section the student or another
 * extension changes, overrides per-language user settings with `[languageId]` blocks of its own,
 * and removes what it wrote once the course allows AI.
 */
export default class AiRestriction implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[]
  private _pass: Promise<void> | undefined
  private _isPassRequested = false
  private _isForcedPassRequested = false
  private readonly _backoffs = new Map<string, Backoff>()
  private _retryTimer: ReturnType<typeof setTimeout> | undefined
  private readonly _writeFailures = new Map<string, string>()
  private readonly _knownLanguageIds = new Set<string>()
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
      // Also fires when the student switches a document's language mode.
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (this._workspace.activeCourse && !this._knownLanguageIds.has(document.languageId)) {
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
   * Writes only what drifted, and leaves a setting that keeps flipping back alone for a while.
   * A call during a pass runs one more pass after it. Never rejects.
   */
  public apply(): Promise<void> {
    if (this._pass) {
      this._isPassRequested = true
      return this._pass
    }
    this._pass = (async (): Promise<void> => {
      try {
        do {
          const isForced = this._isForcedPassRequested
          this._isPassRequested = false
          this._isForcedPassRequested = false
          await this._applyOnce(isForced)
        } while (this._isPassRequested)
      } catch (e) {
        Logger.error("Failed to apply the course's AI settings.", e)
      } finally {
        this._pass = undefined
      }
    })()
    return this._pass
  }

  /**
   * Writes every drifted setting now, backoff or not, then says why the restriction is still
   * not in force, or `undefined` when it is.
   *
   * @param resource An exercise folder, whose own settings are then checked too.
   */
  public async enforce(resource?: vscode.Uri): Promise<AiRestrictionLapse | undefined> {
    this._isForcedPassRequested = true
    await this.apply()
    return this._lapse(resource)
  }

  public dispose(): void {
    clearTimeout(this._retryTimer)
    this._disposables.forEach((x) => x.dispose())
  }

  private async _applyOnce(isForced: boolean): Promise<void> {
    if (!this._workspace.activeCourse) {
      return
    }
    if (this._isAllowed()) {
      this._writeFailures.clear()
      await this._removeOwnedSettings()
    } else {
      await this._writeSettings(isForced)
    }
  }

  private async _writeSettings(isForced: boolean): Promise<void> {
    const declared = Object.keys(AI_OFF_SETTINGS).filter((section) => isDeclared(section))
    // Last: turning it on restarts the extension host, which would cut off any write still to come.
    const [restarting, others] = _.partition(declared, (s) => s === "chat.disableAIFeatures")
    const written: SettingTarget[] = []
    for (const section of others) {
      await this._writeIfDrifted({ section, languageId: undefined }, isForced, written)
    }
    // Only once the top level holds: a per-language block is needed only where a language
    // override beats it.
    const overridable = declared.filter(
      (section) => isLanguageOverridable(section) && !this._writeFailures.has(section),
    )
    const languageIds = this._languageIds(overridable)
    for (const section of overridable) {
      for (const languageId of languageIds) {
        await this._writeIfDrifted({ section, languageId }, isForced, written)
      }
    }
    for (const section of restarting) {
      await this._writeIfDrifted({ section, languageId: undefined }, isForced, written)
    }
    this._scheduleRetry()

    if (written.length > 0) {
      const summary = `Turned AI assistance off in the course workspace through ${written.length} settings.`
      if (this._hasLoggedWrite) {
        Logger.debug(
          summary,
          written.map((target) => targetKey(target)),
        )
      } else {
        this._hasLoggedWrite = true
        Logger.info(summary)
      }
    }
  }

  private async _writeIfDrifted(
    target: SettingTarget,
    isForced: boolean,
    written: SettingTarget[],
  ): Promise<void> {
    const key = targetKey(target)
    const desired = this._desiredValue(target)
    if (desired === undefined) {
      this._writeFailures.delete(key)
      return
    }
    if (!isForced && !this._mayWrite(key)) {
      return
    }
    // Claimed before writing: the last section can restart the extension host mid-pass.
    await this._ownership.update(OWNED_SECTIONS_KEY, _.union(this._ownedTargets(), [key]))
    try {
      await this._workspace.replaceWorkspaceSetting(target.section, desired, target.languageId)
      this._writeFailures.delete(key)
      written.push(target)
    } catch (e) {
      Logger.warn(`Could not turn off AI assistance through ${key}.`, e)
      this._writeFailures.set(key, e instanceof Error ? e.message : String(e))
    }
  }

  /** What `target` must be written as, or `undefined` when it already holds. */
  private _desiredValue({ section, languageId }: SettingTarget): unknown {
    const value = AI_OFF_SETTINGS[section]
    if (languageId !== undefined) {
      const effective = this._workspace.inspectSetting(section, languageId)?.effectiveValue
      return holds(effective, value) ? undefined : value
    }
    const stored = this._workspace.getStoredWorkspaceSetting(section)
    const desired =
      _.isPlainObject(value) && _.isPlainObject(stored)
        ? { ...(stored as object), ...(value as object) }
        : value
    return _.isEqual(stored, desired) ? undefined : desired
  }

  /**
   * The course languages, the languages of the open documents, and every language something
   * overrides one of `sections` for: a language override at any scope beats the top level.
   */
  private _languageIds(sections: string[]): string[] {
    const languageIds = _.union(
      COURSE_LANGUAGE_IDS,
      vscode.workspace.textDocuments.map((document) => document.languageId),
      ...sections.map((section) => this._workspace.inspectSetting(section)?.languageIds ?? []),
    )
    languageIds.forEach((languageId) => this._knownLanguageIds.add(languageId))
    return languageIds
  }

  private async _lapse(resource: vscode.Uri | undefined): Promise<AiRestrictionLapse | undefined> {
    if (!this._workspace.activeCourse || this._isAllowed()) {
      return { kind: "outsideCourseWorkspace" }
    }
    const file = this._workspace.workspaceFileUri
    const [failure] = this._writeFailures.values()
    if (file && failure !== undefined) {
      const problem = await this._workspace.workspaceFileProblem()
      return { kind: "workspaceFileUnwritable", file, problem, reason: failure }
    }

    const declared = Object.keys(AI_OFF_SETTINGS).filter((section) => isDeclared(section))
    const languageIds = this._languageIds(
      declared.filter((section) => isLanguageOverridable(section)),
    )
    const targets = declared.flatMap((section) => [
      { section, languageId: undefined },
      ...(isLanguageOverridable(section)
        ? languageIds.map((languageId) => ({ section, languageId }))
        : []),
    ])
    for (const { section, languageId } of targets) {
      const inspection = this._workspace.inspectSetting(section, languageId, resource)
      if (!inspection || holds(inspection.effectiveValue, AI_OFF_SETTINGS[section])) {
        continue
      }
      const source = overridingSource(inspection, AI_OFF_SETTINGS[section], resource)
      if (source) {
        return { kind: "settingOverridden", section, languageId, source }
      }
      // Nothing the student can edit wins: a default, or a policy.
      Logger.debug(`${section} is not off, and nothing the student set turns it on.`)
    }
    return undefined
  }

  private async _removeOwnedSettings(): Promise<void> {
    const owned = this._ownedTargets()
    if (owned.length === 0) {
      return
    }
    const kept: string[] = []
    for (const key of owned) {
      const target = parseTargetKey(key)
      const stored = this._workspace.getStoredWorkspaceSetting(target.section, target.languageId)
      const remaining = withoutOwnValue(stored, AI_OFF_SETTINGS[target.section])
      if (_.isEqual(remaining, stored)) {
        continue
      }
      try {
        await this._workspace.replaceWorkspaceSetting(target.section, remaining, target.languageId)
      } catch (e) {
        Logger.warn(`Could not remove ${key} from the course workspace.`, e)
        kept.push(key)
      }
    }
    await this._ownership.update(OWNED_SECTIONS_KEY, kept.length > 0 ? kept : undefined)
    Logger.info("The course allows AI, so its workspace no longer turns AI assistance off.")
  }

  /**
   * Counts a write of `key`; `false` while a target something keeps flipping back is left
   * alone. Kept per target, so one fought-over setting costs the others nothing.
   */
  private _mayWrite(key: string): boolean {
    const now = Date.now()
    const backoff = this._backoffs.get(key) ?? {
      writeTimes: [],
      delayMs: MIN_BACKOFF_MS,
      retryAt: 0,
    }
    this._backoffs.set(key, backoff)
    if (now < backoff.retryAt) {
      return false
    }
    // A minute of calm since the last backoff forgives it.
    if (now - backoff.retryAt > 60_000) {
      backoff.delayMs = MIN_BACKOFF_MS
    }
    backoff.writeTimes = backoff.writeTimes.filter((t) => now - t < 60_000)
    if (backoff.writeTimes.length < MAX_WRITES_PER_MINUTE) {
      backoff.writeTimes.push(now)
      return true
    }
    backoff.retryAt = now + backoff.delayMs
    Logger.warn(
      `Something keeps turning ${key} back on in the course workspace; ` +
        `turning it off again in ${backoff.delayMs / 1000} s.`,
    )
    backoff.delayMs = Math.min(backoff.delayMs * 2, MAX_BACKOFF_MS)
    backoff.writeTimes = []
    return false
  }

  /** Runs a pass when the earliest backoff ends, which nothing else may trigger. */
  private _scheduleRetry(): void {
    clearTimeout(this._retryTimer)
    const now = Date.now()
    const retryAts = [...this._backoffs.values()].map((b) => b.retryAt).filter((t) => t > now)
    if (retryAts.length > 0) {
      this._retryTimer = setTimeout(() => void this.apply(), Math.min(...retryAts) - now)
    }
  }

  private _ownedTargets(): string[] {
    return this._ownership.get<string[]>(OWNED_SECTIONS_KEY) ?? []
  }
}

function parseTargetKey(key: string): SettingTarget {
  const language = /^\[([^\]]+)\](.+)$/.exec(key)
  return language
    ? { section: language[2] as string, languageId: language[1] }
    : { section: key, languageId: undefined }
}

function isDeclared(section: string): boolean {
  return vscode.workspace.getConfiguration().inspect(section)?.defaultValue !== undefined
}

/**
 * Whether `section` may appear in a `[languageId]` block: every core editor option, and what an
 * extension declares so.
 */
function isLanguageOverridable(section: string): boolean {
  if (section.startsWith("editor.")) {
    return true
  }
  return vscode.extensions.all.some((extension) => {
    const configuration: unknown = extension.packageJSON?.contributes?.configuration
    const declarations = Array.isArray(configuration) ? configuration : [configuration]
    return declarations.some(
      (declaration) =>
        (declaration as { properties?: Record<string, { scope?: string }> } | undefined)
          ?.properties?.[section]?.scope === "language-overridable",
    )
  })
}

/** Whether `effective` turns off what `off` does; a per-language map merges, so only its own entries count. */
function holds(effective: unknown, off: unknown): boolean {
  if (_.isPlainObject(off) && _.isPlainObject(effective)) {
    const entries = effective as Record<string, unknown>
    return Object.entries(off as Record<string, unknown>).every(([key, value]) =>
      _.isEqual(entries[key], value),
    )
  }
  return _.isEqual(effective, off)
}

/**
 * The student-editable scope whose value of a section beats the workspace file's, in VS Code's
 * precedence order, or `undefined` when none holds a value that turns it back on.
 */
function overridingSource(
  inspection: SettingInspection,
  off: unknown,
  resource: vscode.Uri | undefined,
): SettingSource | undefined {
  const folder = resource && vscode.workspace.getWorkspaceFolder(resource)?.uri
  const candidates: [unknown, SettingSource | undefined][] = [
    [inspection.workspaceFolderLanguageValue, folder && { kind: "folder", folder }],
    [inspection.globalLanguageValue, { kind: "user" }],
    [inspection.workspaceFolderValue, folder && { kind: "folder", folder }],
    [inspection.globalValue, { kind: "user" }],
  ]
  return candidates.find(([value]) => value !== undefined && !holds(value, off))?.[1]
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

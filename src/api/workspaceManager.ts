import * as path from "path"

import * as fs from "fs-extra"
import * as _ from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import {
  EXTENSION_ID,
  HIDE_META_FILES,
  SHOW_META_FILES,
  WATCHER_EXCLUDE,
  WORKSPACE_ROOT_FILE_NAME,
  WORKSPACE_ROOT_FILE_TEXT,
  WORKSPACE_ROOT_FOLDER_NAME,
  WORKSPACE_SETTINGS,
  workspaceFileName,
} from "../config/constants"
import type Resources from "../config/resources"
import { EditorKind } from "../config/resources"
import { FileSystemError } from "../errors"
import { Logger } from "../utilities"

export enum ExerciseStatus {
  Closed = "closed",
  Missing = "missing",
  Open = "opened",
}

export interface WorkspaceExercise {
  backend: "tmc" | "mooc"
  courseSlug: string
  exerciseSlug: string
  status: ExerciseStatus
  uri: vscode.Uri
}

/**
 * Writes the durable record of which of a course's exercises are closed.
 *
 * `WorkspaceManager` awaits this before it changes anything the user can see, so
 * an implementation must have completed the write by the time it resolves `Ok`.
 */
export type PersistClosedExercises = (closedExerciseSlugs: string[]) => Promise<Result<void, Error>>

interface ConfigurationProperties {
  default?: unknown
  type?: string
  description?: string
  scope?: string
  enum?: string[]
  enumDescriptions?: string[]
}

/**
 * Creates a course's `.code-workspace` file at `workspaceFilePath`, leaving an
 * existing one untouched.
 *
 * A free function rather than a method because activation writes workspace files
 * before `WorkspaceManager` is constructed.
 */
export async function ensureCourseWorkspaceFile(workspaceFilePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(workspaceFilePath))
  try {
    await fs.writeFile(workspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS), { flag: "wx" })
    Logger.info("Created course workspace file at", workspaceFilePath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      throw e
    }
  }
}

/**
 * Creates the `.tmc` folder every course workspace opens at its root, and the
 * readme inside it.
 *
 * The readme ships with the extension, so an upgrade has to replace an older
 * copy; an unchanged one is left alone rather than rewritten on every startup.
 */
export async function ensureWorkspaceRootFile(workspaceFileFolder: string): Promise<void> {
  const rootFolder = path.join(workspaceFileFolder, WORKSPACE_ROOT_FOLDER_NAME)
  await fs.ensureDir(rootFolder)

  const rootFile = path.join(rootFolder, WORKSPACE_ROOT_FILE_NAME)
  const stored = await fs.readFile(rootFile, "utf-8").catch(() => undefined)
  if (stored !== WORKSPACE_ROOT_FILE_TEXT) {
    await fs.writeFile(rootFile, WORKSPACE_ROOT_FILE_TEXT)
  }
}

/**
 * Class for managing active workspace.
 */
export default class WorkspaceManager implements vscode.Disposable {
  private _exercises: WorkspaceExercise[]
  // The same objects as `_exercises`, keyed by `uri.fsPath`. Replace both together.
  private _exercisesByPath: Map<string, WorkspaceExercise>
  private readonly _resources: Resources
  private readonly _disposables: vscode.Disposable[]

  /**
   * Creates a new instance of the WorkspaceManager class.
   * @param resources Resources instance for constructing the exercise path
   */
  public constructor(resources: Resources, exercises?: WorkspaceExercise[]) {
    this._exercises = exercises ?? []
    this._exercisesByPath = WorkspaceManager._indexByPath(this._exercises)
    this._resources = resources
    this._disposables = [
      vscode.workspace.onDidChangeWorkspaceFolders((e) => this._onDidChangeWorkspaceFolders(e)),
      vscode.workspace.onDidOpenTextDocument((e) => this._onDidOpenTextDocument(e)),
    ]
  }

  /**
   * The open course workspace's course slug and backend, or `undefined` when no
   * course workspace is open.
   *
   * Resolved from the workspace file's own path and accepted only once it
   * reproduces that path through {@link Resources.getWorkspaceFilePath}. Never
   * from `vscode.workspace.name`: that is a display string carrying a
   * " (Workspace)" suffix, and a course slug may itself contain spaces.
   */
  private get _activeCourseWorkspace(): { slug: string; backend: "tmc" | "mooc" } | undefined {
    const workspaceFile = vscode.workspace.workspaceFile
    if (
      !workspaceFile ||
      path.relative(workspaceFile.fsPath, this._resources.workspaceFileFolder) !== ".."
    ) {
      return undefined
    }

    const fileName = path.basename(workspaceFile.fsPath)
    for (const backend of ["tmc", "mooc"] as const) {
      // What the name generator adds to an empty slug is what a tagged file ends with.
      const tag = workspaceFileName("", backend)
      if (fileName.length <= tag.length || !fileName.endsWith(tag)) {
        continue
      }
      const slug = fileName.slice(0, -tag.length)
      if (
        path.relative(this._resources.getWorkspaceFilePath(slug, backend), workspaceFile.fsPath) ===
        ""
      ) {
        return { slug, backend }
      }
    }

    // Workspace files written before backend namespacing carry no tag and are tmc.
    return { slug: path.basename(fileName, path.extname(fileName)), backend: "tmc" }
  }

  /**
   * Currently active course slug based on the active workspace, or `undefined`
   * otherwise.
   */
  public get activeCourse(): string | undefined {
    return this._activeCourseWorkspace?.slug
  }

  /**
   * Backend of the currently active course workspace, or `undefined` otherwise.
   */
  public get activeCourseBackend(): "tmc" | "mooc" | undefined {
    return this._activeCourseWorkspace?.backend
  }

  /**
   * Currently active exercise based on active editor, or `undefined` otherwise.
   */
  public get activeExercise(): WorkspaceExercise | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri
    return uri && this.getExerciseContaining(uri)
  }

  /**
   * Currently active course workspace uri, or `undefined` otherwise.
   */
  private get _workspaceFileUri(): vscode.Uri | undefined {
    const workspaceFile = vscode.workspace.workspaceFile
    if (
      !workspaceFile ||
      path.relative(workspaceFile.fsPath, this._resources.workspaceFileFolder) !== ".."
    ) {
      return undefined
    }
    return workspaceFile
  }

  public async setExercises(exercises: WorkspaceExercise[]): Promise<Result<void, Error>> {
    this._exercises = exercises
    this._exercisesByPath = WorkspaceManager._indexByPath(exercises)
    return this._refreshActiveCourseWorkspace()
  }

  /**
   * The exercise whose own folder is `uri`, and nothing else — a file inside an
   * exercise does not match. File decoration calls this for every row the
   * explorer renders, and decorates only the exercise folders themselves.
   *
   * Use {@link getExerciseContaining} for a path the user pointed at, which may
   * be a file within the exercise.
   */
  public getExerciseByPath(uri: vscode.Uri): WorkspaceExercise | undefined {
    return this._exercisesByPath.get(uri.fsPath)
  }

  /**
   * The exercise `uri` belongs to — its own folder, or any path inside it.
   *
   * `undefined` for a path outside every known exercise, including a course
   * folder and a sibling whose name an exercise name prefixes. Costs the path's
   * depth rather than the exercise count.
   */
  public getExerciseContaining(uri: vscode.Uri): WorkspaceExercise | undefined {
    let candidate = uri.fsPath
    for (;;) {
      const exercise = this._exercisesByPath.get(candidate)
      if (exercise) {
        return exercise
      }
      const parent = path.dirname(candidate)
      if (parent === candidate) {
        return undefined
      }
      candidate = parent
    }
  }

  public getExerciseBySlug(
    backend: "tmc" | "mooc",
    courseSlug: string,
    exerciseSlug: string,
  ): WorkspaceExercise | undefined {
    return this._exercises.find(
      (x) =>
        x.backend === backend && x.courseSlug === courseSlug && x.exerciseSlug === exerciseSlug,
    )
  }

  public getExercises(): WorkspaceExercise[] {
    return this._exercises
  }

  /**
   * A course's exercises. Ported material gives a mooc course the same slug and
   * the same on-disk exercise names as its TMC counterpart, so the backend is
   * part of the key.
   */
  public getExercisesByCourseSlug(
    backend: "tmc" | "mooc",
    courseSlug: string,
  ): WorkspaceExercise[] {
    return this._exercises.filter((x) => x.backend === backend && x.courseSlug === courseSlug)
  }

  public openCourseExercises(
    backend: "tmc" | "mooc",
    courseSlug: string,
    exerciseSlugs: string[],
    persistClosed: PersistClosedExercises,
  ): Promise<Result<WorkspaceExercise[], Error>> {
    return this._setOpen(backend, courseSlug, exerciseSlugs, true, persistClosed)
  }

  public closeCourseExercises(
    backend: "tmc" | "mooc",
    courseSlug: string,
    exerciseSlugs: string[],
    persistClosed: PersistClosedExercises,
  ): Promise<Result<WorkspaceExercise[], Error>> {
    return this._setOpen(backend, courseSlug, exerciseSlugs, false, persistClosed)
  }

  /**
   * Adds extension recommendations to current course workspace.
   */
  public addWorkspaceRecommendation(
    workspace: string,
    backend: "tmc" | "mooc",
    extensions: string[],
  ): void {
    const pathToWorkspace = this._resources.getWorkspaceFilePath(workspace, backend)
    let workspaceData: { extensions?: { recommendations?: string[] } }
    try {
      workspaceData = JSON.parse(fs.readFileSync(pathToWorkspace, "utf-8"))
    } catch (e) {
      // Called from the document-open handler, where a recommendation the
      // student can add by hand is not worth failing the open over.
      Logger.warn(`Could not read workspace file ${pathToWorkspace}.`, e)
      return
    }

    const current = workspaceData.extensions?.recommendations ?? []
    const recommendations = _.union(current, extensions)
    if (_.isEqual(recommendations, current)) {
      return
    }

    fs.writeFileSync(
      pathToWorkspace,
      JSON.stringify({ ...workspaceData, extensions: { recommendations } }, null, 2),
    )
  }

  /**
   * Creates the course's `.code-workspace` file unless it is already there.
   *
   * Synchronous because its callers open the file in the next statement; the
   * activation path uses {@link ensureCourseWorkspaceFile} instead.
   */
  public createWorkspaceFile(courseName: string, backend: "tmc" | "mooc"): void {
    const workspaceFilePath = this._resources.getWorkspaceFilePath(courseName, backend)
    if (!fs.existsSync(workspaceFilePath)) {
      fs.writeFileSync(workspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS))
      Logger.info("Created course workspace file at", workspaceFilePath)
    }
  }

  /**
   * Deletes a course's `.code-workspace` file, so that re-adding the course gets
   * a fresh one instead of a folder list pointing at exercises that are gone.
   *
   * The course's downloaded exercises are left on disk.
   */
  public async deleteWorkspaceFile(
    courseName: string,
    backend: "tmc" | "mooc",
  ): Promise<Result<void, Error>> {
    const workspaceFilePath = this._resources.getWorkspaceFilePath(courseName, backend)
    try {
      await fs.remove(workspaceFilePath)
    } catch (e) {
      return Err(new FileSystemError(e, `Failed to remove ${workspaceFilePath}.`))
    }
    return Ok.EMPTY
  }

  /**
   * Deletes every course's `.code-workspace` file, leaving the `.tmc` root folder
   * each of them opens at its top.
   */
  public async deleteAllWorkspaceFiles(): Promise<Result<void, Error>> {
    const workspaceFileFolder = this._resources.workspaceFileFolder
    try {
      const entries = await fs.readdir(workspaceFileFolder)
      for (const entry of entries) {
        if (entry.endsWith(".code-workspace")) {
          await fs.remove(path.join(workspaceFileFolder, entry))
        }
      }
    } catch (e) {
      return Err(new FileSystemError(e, `Failed to empty ${workspaceFileFolder}.`))
    }
    return Ok.EMPTY
  }

  public dispose(): void {
    this._disposables.forEach((x) => x.dispose())
  }

  public async excludeMetaFilesInWorkspace(hide: boolean): Promise<void> {
    const value = hide ? HIDE_META_FILES : SHOW_META_FILES
    await this.updateWorkspaceSetting("files.exclude", value)
  }

  /**
   * Returns the section for the Workspace setting (i.e. .code-workspace).
   * If section not found in multi-root workspace file, returns User scope setting.
   * @param section A dot-separated identifier.
   */
  public getWorkspaceSettings(section?: string): vscode.WorkspaceConfiguration {
    if (this.activeCourse) {
      return vscode.workspace.getConfiguration(section, this._workspaceFileUri)
    }
    return vscode.workspace.getConfiguration(section)
  }

  public async verifyWorkspaceSettingsIntegrity(): Promise<void> {
    if (!this.activeCourse) {
      return
    }
    Logger.info("TMC Workspace open, verifying workspace settings integrity.")
    const hideMetaFiles = this.getWorkspaceSettings("testMyCode").get<boolean>(
      "hideMetaFiles",
      true,
    )
    await this._updateWorkspaceSettings({
      "files.exclude": hideMetaFiles ? HIDE_META_FILES : SHOW_META_FILES,
      ...this._settingsDeclaredByExtension(),
      // Our watcher would otherwise delete an exercise folder's `.vscode`, and
      // with it per-folder settings such as the exercise's Python interpreter.
      "files.watcherExclude": WATCHER_EXCLUDE,
      "explorer.decorations.colors": false,
      "explorer.decorations.badges": true,
      "problems.decorations.enabled": false,
    })
  }

  /**
   * Updates a section for the TMC Workspace.code-workspace file, if the workspace is open.
   * @param section Configuration name, supports dotted names.
   * @param value The new value
   */
  public async updateWorkspaceSetting(section: string, value: unknown): Promise<void> {
    await this._updateWorkspaceSettings({ [section]: value })
  }

  /**
   * Writes each section into the open course workspace's `.code-workspace`,
   * skipping the ones already holding the value that would be written.
   *
   * Every write VS Code accepts is a configuration-change broadcast each installed
   * extension has to process, and the integrity pass runs on every activation with
   * a course workspace open — so the skip is what keeps that pass free once the
   * file is correct.
   *
   * Object values are merged over what the workspace file already stores, so a
   * setting the student added by hand to the same section survives.
   */
  private async _updateWorkspaceSettings(sections: Record<string, unknown>): Promise<void> {
    const activeCourseWorkspace = this._activeCourseWorkspace
    if (!activeCourseWorkspace) {
      return
    }
    const workspaceConfiguration = vscode.workspace.getConfiguration(
      undefined,
      vscode.Uri.file(
        this._resources.getWorkspaceFilePath(
          activeCourseWorkspace.slug,
          activeCourseWorkspace.backend,
        ),
      ),
    )
    for (const [section, value] of Object.entries(sections)) {
      // `inspect`, not `get`: the effective configuration would materialize
      // every VS Code default into the workspace file as an explicit entry.
      const stored = this.getWorkspaceSettings().inspect<unknown>(section)?.workspaceValue
      const desired = value instanceof Object ? { ...(stored as object), ...value } : value
      if (_.isEqual(stored, desired)) {
        continue
      }
      await workspaceConfiguration.update(section, desired, vscode.ConfigurationTarget.Workspace)
    }
  }

  /**
   * The extension's own boolean settings with the value the workspace file should
   * hold: whatever it already stores, else the user-scope value, else the
   * declared default.
   *
   * Workaround for https://github.com/microsoft/vscode/issues/58038, which is why
   * these are copied into the workspace file at all.
   */
  private _settingsDeclaredByExtension(): Record<string, unknown> {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    const declared: Record<string, ConfigurationProperties> =
      extension?.packageJSON?.contributes?.configuration?.properties ?? {}
    if (Object.keys(declared).length === 0) {
      // A fork or a renamed publisher: nothing to copy, and the rest of the
      // integrity pass still has work to do.
      Logger.warn(`No declared settings found for extension ${EXTENSION_ID}.`)
      return {}
    }

    const desired: Record<string, unknown> = {}
    for (const [key, property] of Object.entries(declared)) {
      if (property.scope === "application" || property.type !== "boolean") {
        continue
      }
      const stored = this.getWorkspaceSettings().inspect<boolean>(key)
      if (stored?.workspaceValue !== undefined) {
        desired[key] = stored.workspaceValue
      } else if (stored?.globalValue !== undefined) {
        desired[key] = stored.globalValue
      } else {
        desired[key] = stored?.defaultValue
      }
    }
    return desired
  }

  /**
   * Refreshes current active course workspace by first making sure that the `.tmc` folder is at
   * the top and then lists all that course's open exercises in alphanumeric order.
   */
  private async _refreshActiveCourseWorkspace(): Promise<Result<void, Error>> {
    const activeCourseWorkspace = this._activeCourseWorkspace
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!activeCourseWorkspace || !workspaceFolders) {
      Logger.warn("Attempted refresh for a non-course workspace.")
      return Ok.EMPTY
    }

    const rootFolder = this._resources.workspaceRootFolder
    const openExercises = this._exercises
      .filter(
        (x) =>
          x.courseSlug === activeCourseWorkspace.slug &&
          x.backend === activeCourseWorkspace.backend &&
          x.status === ExerciseStatus.Open,
      )
      .toSorted((a, b) => a.exerciseSlug.localeCompare(b.exerciseSlug))
      .map((x) => ({ uri: x.uri }))
    const correctStructure = [{ uri: rootFolder }, ...openExercises]
    if (
      _.zip(correctStructure, workspaceFolders).every(([a, b]) => a?.uri.fsPath === b?.uri.fsPath)
    ) {
      Logger.debug("Workspace refresh was a no-op.")
      return Ok.EMPTY
    }

    Logger.info("Refreshing workspace structure in the current workspace")
    if (workspaceFolders[0]?.name !== WORKSPACE_ROOT_FOLDER_NAME) {
      Logger.warn("Fixing incorrect root folder. This may restart the extension.")
    }

    const deleteCount = workspaceFolders.length
    Logger.debug(`Replacing ${deleteCount} workspace folders with ${correctStructure.length}`)
    const success = vscode.workspace.updateWorkspaceFolders(0, deleteCount, ...correctStructure)
    if (!success) {
      Logger.error("Replace operation failed.")
      Logger.debug("Failed with folders:", ...correctStructure)
    }

    return success ? Ok.EMPTY : Err(new Error("Failed to refresh active workspace."))
  }

  /**
   * The one place a course's exercises change between open and closed.
   *
   * Records the resulting closed set through `persistClosed` first and gives up
   * on a failed write, so the student never sees exercises open or close in a way
   * the next {@link setExercises} silently reverts.
   *
   * @returns the exercises the request named — matched, not changed: one already
   * in the requested state is included.
   */
  private async _setOpen(
    backend: "tmc" | "mooc",
    courseSlug: string,
    exerciseSlugs: string[],
    open: boolean,
    persistClosed: PersistClosedExercises,
  ): Promise<Result<WorkspaceExercise[], Error>> {
    const courseExercises = this._exercises.filter(
      (x) => x.backend === backend && x.courseSlug === courseSlug,
    )
    const requested = new Set(exerciseSlugs)
    const closedAfterwards = courseExercises
      .filter((x) => (requested.has(x.exerciseSlug) ? !open : x.status === ExerciseStatus.Closed))
      .map((x) => x.exerciseSlug)

    const persisted = await persistClosed(closedAfterwards)
    if (persisted.err) {
      return persisted
    }

    const matched = courseExercises.filter((x) => requested.has(x.exerciseSlug))
    for (const exercise of matched) {
      exercise.status = open ? ExerciseStatus.Open : ExerciseStatus.Closed
    }

    const refreshed = await this._refreshActiveCourseWorkspace()
    return refreshed.err ? refreshed : Ok(matched)
  }

  private static _indexByPath(exercises: WorkspaceExercise[]): Map<string, WorkspaceExercise> {
    return new Map(exercises.map((x) => [x.uri.fsPath, x]))
  }

  private _onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void {
    const activeCourseWorkspace = this._activeCourseWorkspace

    let incorrectFolderAdded = false
    e.added.forEach((added) => {
      const exercise = this._exercisesByPath.get(added.uri.fsPath)
      if (!exercise) {
        incorrectFolderAdded = true
      } else if (
        exercise.courseSlug === activeCourseWorkspace?.slug &&
        exercise.backend === activeCourseWorkspace?.backend
      ) {
        exercise.status = ExerciseStatus.Open
      }
    })

    e.removed.forEach((removed) => {
      const exercise = this._exercisesByPath.get(removed.uri.fsPath)
      if (exercise) {
        exercise.status = ExerciseStatus.Closed
      }
    })

    if (incorrectFolderAdded) {
      Logger.warn(
        `Folders added that are not part of course ${activeCourseWorkspace?.slug}. These may be removed later.`,
      )
    }
    if (e.added.length > 5) {
      vscode.commands.executeCommand("workbench.files.action.collapseExplorerFolders")
    }
  }

  private _onDidOpenTextDocument(e: vscode.TextDocument): void {
    const activeCourseWorkspace = this._activeCourseWorkspace
    if (!activeCourseWorkspace) {
      return
    }
    const { slug: activeCourse, backend: activeBackend } = activeCourseWorkspace

    // TODO: Check that document is a valid exercise
    const isCode = this._resources.editorKind === EditorKind.Code
    Logger.debug("Text document languageId", e.languageId)
    switch (e.languageId) {
      case "c":
      case "cpp":
      case "objective-c":
      case "objective-cpp":
        if (isCode && !vscode.extensions.getExtension("ms-vscode.cpptools")) {
          this.addWorkspaceRecommendation(activeCourse, activeBackend, ["ms-vscode.cpptools"])
        }
        break
      case "csharp":
        if (isCode && !vscode.extensions.getExtension("ms-dotnettools.csharp")) {
          this.addWorkspaceRecommendation(activeCourse, activeBackend, ["ms-dotnettools.csharp"])
        }
        break
      case "markdown":
        vscode.commands.executeCommand("markdown.showPreview", e.uri)
        break
      case "r":
        if (!vscode.extensions.getExtension("ikuyadeu.r")) {
          this.addWorkspaceRecommendation(activeCourse, activeBackend, ["ikuyadeu.r"])
        }
        break
      case "python":
        if (!vscode.extensions.getExtension("ms-python.python")) {
          if (isCode && !vscode.extensions.getExtension("ms-python.vscode-pylance")) {
            this.addWorkspaceRecommendation(activeCourse, activeBackend, [
              "ms-python.vscode-pylance",
              "ms-python.python",
            ])
          } else {
            this.addWorkspaceRecommendation(activeCourse, activeBackend, ["ms-python.python"])
          }
        }

        break
      case "java":
        if (isCode && !vscode.extensions.getExtension("vscjava.vscode-java-pack")) {
          this.addWorkspaceRecommendation(activeCourse, activeBackend, ["vscjava.vscode-java-pack"])
        }
        break
    }
  }
}

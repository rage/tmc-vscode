import * as vscode from "vscode"

import type { BackendKind } from "../../../shared/lib"
import {
  backendName,
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  SOFT_DEADLINE_PENALTY,
} from "../../../shared/lib"
import type WorkspaceManager from "../../api/workspaceManager"
import { TRUST_COURSE_WORKSPACE_COMMAND } from "../../errors"
import { countOf, formatDeadline } from "../../utilities"
import { downloadFailures } from "../downloadFailures"
import { exerciseOperations } from "../exerciseOperations"
import { pointsText } from "../points"
import { tooltipOf } from "../tooltip"
import { updateablesRegistry } from "../updateablesRegistry"
import type { ExerciseView, PartView } from "./courseViewModel"
import { buildCourseView, onDiskByCourse, shownDeadline } from "./courseViewModel"

/** The id of the TestMyCode view, for `withProgress({ location: { viewId } })` too. */
export const COURSES_VIEW_ID = "tmcView"

/** What the Courses view is drawn from; read afresh on every render. */
export interface CoursesTreeSource {
  getCourses: () => LocalCourseData[]
  onDidChangeCourses: vscode.Event<unknown>
  workspaceManager: Pick<
    WorkspaceManager,
    | "activeCourse"
    | "activeCourseBackend"
    | "getExerciseContaining"
    | "getExercises"
    | "onDidChangeExercises"
  >
}

/** How the items render, fixed for one render of the view. */
interface RenderContext {
  now: Date
  locale: string | undefined
  /** The course's backend could not be reached, so its deadlines may be stale. */
  isOffline: boolean
  /** The course whose workspace is open, which starts expanded. */
  activeCourse: { slug: string; backend: BackendKind } | undefined
}

/** A course, part or exercise row of the Courses view; the view's row commands receive these. */
export type CoursesTreeItem = CourseTreeItem | PartTreeItem | ExerciseTreeItem

/** Any row of the Courses view. */
export type CoursesViewRow = CoursesTreeItem | TrustCourseWorkspaceTreeItem

/** The Courses view's first row while its course workspace is in Restricted Mode. */
export class TrustCourseWorkspaceTreeItem extends vscode.TreeItem {
  public constructor() {
    super("Trust Course Workspace", vscode.TreeItemCollapsibleState.None)
    this.id = "trustCourseWorkspace"
    this.description = "to run tests and submit"
    this.iconPath = new vscode.ThemeIcon("workspace-untrusted")
    this.command = { command: TRUST_COURSE_WORKSPACE_COMMAND, title: "Trust Course Workspace" }
  }
}

/**
 * One of the user's courses in the Courses view.
 *
 * `contextValue` is `course.<backend>` followed by the flags package.json's `viewItem`
 * clauses match on: `.hasNew` (exercises announced as new), `.hasMissing` (exercises not
 * downloaded that can still be submitted), `.hasUpdates` and `.hasCompleted` (passed
 * exercises still open). The order is part of the contract: the inline Download All shows
 * only where `.hasMissing` directly follows the backend, i.e. without `.hasNew`.
 */
export class CourseTreeItem extends vscode.TreeItem {
  public readonly courseId: CourseIdentifier
  public readonly parent: undefined = undefined
  private readonly _tooltipLines: string[]
  private readonly _buildChildren: () => (PartTreeItem | ExerciseTreeItem)[]
  private _children: (PartTreeItem | ExerciseTreeItem)[] | undefined

  public constructor(course: LocalCourseData, parts: PartView[], context: RenderContext) {
    const title = LocalCourseData.getCourseTitle(course)
    const isActive =
      context.activeCourse?.backend === course.kind &&
      context.activeCourse.slug === LocalCourseData.getCourseName(course)
    super(
      title,
      isActive
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    )
    this.courseId = LocalCourseData.getCourseId(course)
    this.id = CourseIdentifier.key(this.courseId)
    const exercises = parts.flatMap((part) => part.exercises)
    const newCount = LocalCourseData.getNewExercises(course).length
    const updateCount = exercises.filter((ex) => ex.isUpdateable).length
    const hasCompleted = exercises.some((ex) => ex.passed && ex.status === "opened")
    const hasMissing = exercises.some((ex) => ex.status === "missing" || ex.status === "new")
    const disabled = LocalCourseData.isDisabled(course)
    const points = pointsText(course.data.awardedPoints, course.data.availablePoints)
    const backend = backendName(course.kind)

    this.iconPath = disabled
      ? new vscode.ThemeIcon("book", new vscode.ThemeColor("disabledForeground"))
      : new vscode.ThemeIcon("book")
    this.contextValue = [
      `course.${course.kind}`,
      ...(newCount > 0 ? ["hasNew"] : []),
      ...(hasMissing ? ["hasMissing"] : []),
      ...(updateCount > 0 ? ["hasUpdates"] : []),
      ...(hasCompleted ? ["hasCompleted"] : []),
    ].join(".")
    const newExercises = countOf(newCount, "new exercise")
    const updates = countOf(updateCount, "exercise update")
    this._tooltipLines = showFacts(this, title, [
      points && {
        description: points.short,
        spoken: points.spoken,
        tooltip: `${points.short} points`,
      },
      // Titles are only unique within one backend, so the backend is always shown.
      { description: backend, spoken: backend, tooltip: backend },
      disabled && {
        description: "disabled",
        spoken: "disabled",
        tooltip: "This course is disabled: its exercises cannot be downloaded or submitted.",
      },
      newCount > 0 && { spoken: newExercises, tooltip: newExercises },
      updateCount > 0 && { spoken: updates, tooltip: updates },
    ])
    this.command = { command: "tmc.courseDetails", title: "Show Course", arguments: [this] }
    this._buildChildren = () =>
      parts.length === 1 && parts[0]?.isUngrouped
        ? exercises.map((ex) => new ExerciseTreeItem(this, this.courseId, ex, context))
        : parts.map((part) => new PartTreeItem(this, part, context))
  }

  /** The course's parts, or its exercises directly when none of them names a part. */
  public get children(): (PartTreeItem | ExerciseTreeItem)[] {
    this._children ??= this._buildChildren()
    return this._children
  }

  public buildTooltip(): vscode.MarkdownString {
    return tooltipOf(this._tooltipLines)
  }
}

/**
 * A part of a course. `contextValue` is `part` followed by `.hasMissing`, `.hasClosed` and
 * `.hasOpened`, for the bulk actions that apply to its exercises.
 */
export class PartTreeItem extends vscode.TreeItem {
  public readonly courseId: CourseIdentifier
  public readonly children: ExerciseTreeItem[]
  private readonly _tooltipLines: string[]

  public constructor(
    public readonly parent: CourseTreeItem,
    part: PartView,
    context: RenderContext,
  ) {
    const label = partLabel(part.name)
    super(
      label,
      part.isDefaultOpen
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    )
    this.courseId = parent.courseId
    this.id = `${parent.id}/${part.key}`
    const passed = part.exercises.filter((ex) => ex.passed).length
    const nextDeadline =
      part.nextDeadline && !context.isOffline
        ? formatDeadline(part.nextDeadline, context.now, context.locale)
        : undefined
    this._tooltipLines = showFacts(this, label, [
      {
        description: `${passed}/${part.exercises.length} passed`,
        spoken: `${passed} of ${part.exercises.length} passed`,
        tooltip: `${passed} of ${part.exercises.length} exercises passed`,
      },
      nextDeadline !== undefined && {
        description: `next deadline ${nextDeadline}`,
        spoken: `next deadline ${nextDeadline}`,
        tooltip: `Next deadline: ${nextDeadline}`,
      },
    ])
    this.iconPath = new vscode.ThemeIcon(
      passed === part.exercises.length ? "pass-filled" : "list-tree",
      passed === part.exercises.length ? new vscode.ThemeColor("testing.iconPassed") : undefined,
    )
    this.contextValue = [
      "part",
      ...(part.exercises.some((ex) => isDownloadable(ex.status)) ? ["hasMissing"] : []),
      ...(part.exercises.some((ex) => ex.status === "closed") ? ["hasClosed"] : []),
      ...(part.exercises.some((ex) => ex.status === "opened") ? ["hasOpened"] : []),
    ].join(".")
    this.children = part.exercises.map(
      (ex) => new ExerciseTreeItem(this, this.courseId, ex, context),
    )
  }

  public buildTooltip(): vscode.MarkdownString {
    return tooltipOf(this._tooltipLines)
  }
}

const STATUS_LABELS: Record<ExerciseView["status"], string> = {
  opened: "open",
  closed: "closed",
  missing: "not downloaded",
  new: "new, not downloaded",
  downloading: "downloading…",
  downloadFailed: "download failed",
  expired: "expired, not downloaded",
}

/**
 * One exercise. `contextValue` is `exercise.<status>` (see `ExerciseStatus`), followed by
 * `.passed` and `.updateable` when they apply.
 */
export class ExerciseTreeItem extends vscode.TreeItem {
  public readonly exerciseId: ExerciseIdentifier
  /** The exercise's folder, while it is on disk. */
  public readonly exerciseUri: vscode.Uri | undefined
  public readonly status: ExerciseView["status"]
  private readonly _tooltipLines: string[]

  public constructor(
    public readonly parent: CourseTreeItem | PartTreeItem,
    public readonly courseId: CourseIdentifier,
    exercise: ExerciseView,
    context: RenderContext,
  ) {
    super(exercise.name, vscode.TreeItemCollapsibleState.None)
    // A mooc exercise's name need not be unique in its course; its id is.
    this.id = `${parent.id}/${ExerciseIdentifier.key(exercise.id)}`
    this.exerciseId = exercise.id
    this.exerciseUri = exercise.onDisk?.uri
    this.status = exercise.status
    this.iconPath = exerciseIcon(exercise)
    this.contextValue = [
      `exercise.${exercise.status}`,
      ...(exercise.passed ? ["passed"] : []),
      ...(exercise.isUpdateable ? ["updateable"] : []),
    ].join(".")
    this.command = { command: "tmc.openExercises", title: "Open", arguments: [this] }

    const { now, locale } = context
    const deadline = shownDeadline(exercise)
    const isDue = !exercise.passed && !exercise.isOutOfTries && deadline !== null && deadline > now
    const points = pointsText(exercise.awardedPoints, exercise.availablePoints)
    const status = STATUS_LABELS[exercise.status]
    const due = isDue && `due ${formatDeadline(deadline, now, locale)}`
    this._tooltipLines = showFacts(this, exercise.name, [
      {
        spoken: exercise.passed ? "passed" : "not passed",
        tooltip: exercise.passed ? "Passed" : "Not passed",
      },
      {
        description: exercise.status === "opened" ? undefined : status,
        spoken: status,
        tooltip: `Status: ${status}`,
      },
      exercise.isUpdateable && {
        description: "update available",
        spoken: "update available",
        tooltip: "An update is available.",
      },
      points && {
        description: `${points.short} points`,
        spoken: points.spoken,
        tooltip: `${points.short} points`,
      },
      exercise.isOutOfTries && {
        description: "no tries left",
        spoken: "no tries left",
        tooltip: "No tries left, so this score is final.",
      },
      due && { description: due, spoken: due },
      exercise.softDeadline &&
        !exercise.isHard && {
          tooltip: `Soft deadline: ${formatDeadline(exercise.softDeadline, now, locale)}. ${SOFT_DEADLINE_PENALTY}`,
        },
      exercise.hardDeadline && {
        tooltip: `Deadline: ${formatDeadline(exercise.hardDeadline, now, locale)}`,
      },
    ])
  }

  public buildTooltip(): vscode.MarkdownString {
    return tooltipOf(this._tooltipLines)
  }
}

/**
 * One fact about a row, worded for each place the row shows it: its description, its
 * accessible name and its hover. A fact without a wording for a place is left out there.
 */
interface RowFact {
  description?: string | undefined
  spoken?: string
  tooltip?: string
}

/**
 * Sets `item`'s description and accessible name from `facts`, in their order.
 *
 * @returns The hover's lines, which the item turns into a tooltip only when hovered.
 */
function showFacts(
  item: vscode.TreeItem,
  label: string,
  facts: readonly (RowFact | false | undefined | null | "")[],
): string[] {
  const shown = facts.filter((fact) => typeof fact === "object" && fact !== null)
  item.description = shown.flatMap((fact) => fact.description ?? []).join(" · ")
  item.accessibilityInformation = {
    label: [label, ...shown.flatMap((fact) => fact.spoken ?? [])].join(", "),
  }
  return [label, ...shown.flatMap((fact) => fact.tooltip ?? [])]
}

/** How long a burst of changes, such as one per downloaded exercise, is gathered into one render. */
const RENDER_DELAY_MS = 50

/** A course with its exercises grouped and resolved, before any tree item is built. */
interface CourseView {
  course: LocalCourseData
  parts: PartView[]
}

/**
 * The Courses view: the user's courses, their parts and exercises, logged in or not, since
 * the exercises on disk stay usable; with none, package.json's `viewsWelcome` explains the
 * empty, logged-out and failed states.
 */
export default class CoursesTree implements vscode.TreeDataProvider<CoursesViewRow> {
  private readonly _changed = new vscode.EventEmitter<undefined>()
  public readonly onDidChangeTreeData = this._changed.event
  private readonly _rendered = new vscode.EventEmitter<void>()
  /**
   * Fires once per burst of changes to anything the view shows, whether or not it is visible,
   * so a screen showing the same courses can follow it.
   */
  public readonly onDidRender = this._rendered.event
  private readonly _view: vscode.TreeView<CoursesViewRow>
  private readonly _disposables: vscode.Disposable[]
  private _source: CoursesTreeSource | undefined
  private _sourceSubscriptions: vscode.Disposable[] = []
  private _isLoggedIn = false
  private _isRestricted = false
  private readonly _unreachableBackends = new Set<BackendKind>()
  private _views: CourseView[] | undefined
  private _roots: CourseTreeItem[] | undefined
  private _pendingRender: ReturnType<typeof setTimeout> | undefined
  /** A render happened while the view was hidden, so VS Code still shows the one before. */
  private _isShownStale = false
  /** {@link drawnRows} of the rows VS Code last fetched or was last told to draw. */
  private _drawnRows: string | undefined
  private _isDisposed = false

  public constructor() {
    this._view = vscode.window.createTreeView(COURSES_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: true,
    })
    this._disposables = [
      this._view,
      this._changed,
      this._rendered,
      downloadFailures.onDidChange(() => this.refresh()),
      exerciseOperations.onDidChange(() => this.refresh()),
      updateablesRegistry.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => void this.revealActiveExercise()),
      this._view.onDidChangeVisibility(() => this._onDidChangeVisibility()),
    ]
  }

  public dispose(): void {
    this._isDisposed = true
    clearTimeout(this._pendingRender)
    this._pendingRender = undefined
    this._sourceSubscriptions.forEach((subscription) => subscription.dispose())
    for (const disposable of this._disposables) {
      disposable.dispose()
    }
  }

  /** Sets what the view is drawn from. Call once activation has it. */
  public setSource(source: CoursesTreeSource): void {
    this._sourceSubscriptions.forEach((subscription) => subscription.dispose())
    this._source = source
    this._sourceSubscriptions = [
      source.onDidChangeCourses(() => this.refresh()),
      source.workspaceManager.onDidChangeExercises(() => this.refresh()),
    ]
    this.refresh()
    void this.revealActiveExercise()
  }

  public setLoggedIn(isLoggedIn: boolean): void {
    if (isLoggedIn !== this._isLoggedIn) {
      this._isLoggedIn = isLoggedIn
      this.refresh()
    }
  }

  /** Records whether this window is a course workspace in Restricted Mode. */
  public setRestricted(isRestricted: boolean): void {
    if (isRestricted !== this._isRestricted) {
      this._isRestricted = isRestricted
      this.refresh()
    }
  }

  /** Whether `backend` answered the last course refresh, as far as this window knows. */
  public isBackendReachable(backend: BackendKind): boolean {
    return !this._unreachableBackends.has(backend)
  }

  /** Records whether `backend` answered the last course refresh. */
  public setBackendReachable(backend: BackendKind, isReachable: boolean): void {
    const wasUnreachable = this._unreachableBackends.has(backend)
    if (isReachable === !wasUnreachable) {
      return
    }
    if (isReachable) {
      this._unreachableBackends.delete(backend)
    } else {
      this._unreachableBackends.add(backend)
    }
    this.refresh()
  }

  /**
   * Re-renders the view. The rows VS Code asks for from now on are current; the badge and
   * the change event follow after {@link RENDER_DELAY_MS}, once per burst of calls.
   */
  public refresh(): void {
    this._views = undefined
    this._roots = undefined
    if (this._isDisposed) {
      return
    }
    this._pendingRender ??= setTimeout(() => this._render(), RENDER_DELAY_MS)
  }

  private _render(): void {
    this._pendingRender = undefined
    const views = this._currentViews()
    const newCount = views.reduce(
      (total, { course }) => total + LocalCourseData.getNewExercises(course).length,
      0,
    )
    const updateCount = views
      .flatMap(({ parts }) => parts.flatMap((part) => part.exercises))
      .filter((exercise) => exercise.isUpdateable).length
    const counts = [
      ...(newCount > 0 ? [countOf(newCount, "new exercise")] : []),
      ...(updateCount > 0 ? [countOf(updateCount, "exercise update")] : []),
    ]
    this._view.badge =
      counts.length > 0 ? { value: newCount + updateCount, tooltip: counts.join(", ") } : undefined
    const unreachable = [...this._unreachableBackends].map((backend) => backendName(backend))
    const restricted = this._isRestricted
      ? "This course workspace is in Restricted Mode: trust it to run tests, submit and share" +
        " exercises."
      : undefined
    let status: string | undefined
    if (views.length === 0) {
      // Nothing to say about courses there are none of.
    } else if (!this._isLoggedIn) {
      status = `Log in to ${backendName("mooc")} to download and submit exercises. The exercises on this computer still open and run their tests.`
    } else if (unreachable.length > 0) {
      status = `${unreachable.join(" and ")} could not be reached. Showing the exercises saved on this computer; deadlines may be out of date.`
    }
    // An empty message hides it; the typings do not admit `undefined`.
    this._view.message = [restricted, status].filter((x) => x !== undefined).join(" ")
    if (this._view.visible) {
      this._redrawIfChanged()
    } else {
      this._isShownStale = true
    }
    this._rendered.fire()
  }

  private _onDidChangeVisibility(): void {
    if (this._view.visible && this._isShownStale) {
      this._isShownStale = false
      this._redrawIfChanged()
    }
    void this.revealActiveExercise()
  }

  /**
   * Asks VS Code to redraw only rows it has not drawn: it forgets every row while it redraws,
   * and a row action clicked meanwhile runs without its row.
   */
  private _redrawIfChanged(): void {
    const rows = drawnRows(this._currentRoots(), this._isRestricted)
    if (rows !== this._drawnRows) {
      this._drawnRows = rows
      this._changed.fire(undefined)
    }
  }

  public getChildren(element?: CoursesViewRow): CoursesViewRow[] {
    if (!element) {
      const roots = this._currentRoots()
      this._drawnRows = drawnRows(roots, this._isRestricted)
      return this._isRestricted ? [new TrustCourseWorkspaceTreeItem(), ...roots] : roots
    }
    return element instanceof ExerciseTreeItem || element instanceof TrustCourseWorkspaceTreeItem
      ? []
      : element.children
  }

  public getTreeItem(element: CoursesViewRow): CoursesViewRow {
    return element
  }

  /** Builds a row's hover only when it is hovered. */
  public resolveTreeItem(_item: vscode.TreeItem, element: CoursesViewRow): CoursesViewRow {
    if (!(element instanceof TrustCourseWorkspaceTreeItem)) {
      element.tooltip ??= element.buildTooltip()
    }
    return element
  }

  public getParent(element: CoursesViewRow): CoursesTreeItem | undefined {
    return element instanceof TrustCourseWorkspaceTreeItem ? undefined : element.parent
  }

  /**
   * Selects the exercise the active editor belongs to, without taking focus. Only while
   * the view is visible: revealing into a hidden view would open the sidebar.
   */
  public async revealActiveExercise(): Promise<void> {
    if (!this._view.visible) {
      return
    }
    const uri = vscode.window.activeTextEditor?.document.uri
    const item = uri && this._exerciseItemContaining(uri)
    if (item) {
      await this._view.reveal(item, { select: true, focus: false })
    }
  }

  /**
   * Opens the view with the row of the exercise `uri` belongs to selected and focused.
   *
   * @returns false when no row shows that exercise.
   */
  public async revealExercise(uri: vscode.Uri): Promise<boolean> {
    const item = this._exerciseItemContaining(uri)
    if (!item) {
      return false
    }
    await this._view.reveal(item, { select: true, focus: true })
    return true
  }

  /**
   * Expands the course's row without taking focus: a click on a course runs its command instead
   * of expanding it, and the student still expects to see its exercises.
   */
  public async expandCourse(courseId: CourseIdentifier): Promise<void> {
    const item = this._currentRoots().find((root) =>
      CourseIdentifier.equals(root.courseId, courseId),
    )
    if (item && this._view.visible) {
      await this._view.reveal(item, { select: true, focus: false, expand: true })
    }
  }

  /** Opens the view with the course's row selected, focused and expanded. */
  public async revealCourse(courseId: CourseIdentifier): Promise<void> {
    const item = this._currentRoots().find((root) =>
      CourseIdentifier.equals(root.courseId, courseId),
    )
    if (item) {
      await this._view.reveal(item, { select: true, focus: true, expand: true })
    } else {
      await vscode.commands.executeCommand(`${COURSES_VIEW_ID}.focus`)
    }
  }

  private _exerciseItemContaining(uri: vscode.Uri): ExerciseTreeItem | undefined {
    const exercise = this._source?.workspaceManager.getExerciseContaining(uri)
    if (!exercise) {
      return undefined
    }
    // Builds only that course's rows; the others stay lazy.
    const courseIndex = this._currentViews().findIndex(({ course }) =>
      CourseIdentifier.equals(LocalCourseData.getCourseId(course), exercise.courseId),
    )
    const root = this._currentRoots()[courseIndex]
    const key = ExerciseIdentifier.key(exercise.id)
    return (
      root && exerciseItems(root).find((item) => ExerciseIdentifier.key(item.exerciseId) === key)
    )
  }

  private _currentViews(): CourseView[] {
    if (!this._views) {
      const onDiskOf = onDiskByCourse(this._source?.workspaceManager.getExercises() ?? [])
      const now = new Date()
      this._views = this._visibleCourses().map((course) => {
        const courseId = LocalCourseData.getCourseId(course)
        const parts = buildCourseView(course, {
          onDisk: onDiskOf(course),
          downloadStatusOf,
          updateable: updateablesRegistry.get(courseId),
          now,
        })
        return { course, parts }
      })
    }
    return this._views
  }

  private _currentRoots(): CourseTreeItem[] {
    if (!this._roots) {
      const workspaceManager = this._source?.workspaceManager
      const now = new Date()
      const slug = workspaceManager?.activeCourse
      const backend = workspaceManager?.activeCourseBackend
      const activeCourse = slug && backend ? { slug, backend } : undefined
      this._roots = this._currentViews().map(
        ({ course, parts }) =>
          new CourseTreeItem(course, parts, {
            now,
            locale: vscode.env.language,
            isOffline: this._unreachableBackends.has(course.kind),
            activeCourse,
          }),
      )
    }
    return this._roots
  }

  private _visibleCourses(): LocalCourseData[] {
    return this._source ? this._source.getCourses() : []
  }
}

/** Whether the exercise is downloading or failed to, as the Courses view and course home show it. */
export function downloadStatusOf(
  id: ExerciseIdentifier,
): "downloading" | "downloadFailed" | undefined {
  if (exerciseOperations.isRunning(id, "downloading")) {
    return "downloading"
  }
  return downloadFailures.has(id) ? "downloadFailed" : undefined
}

/**
 * Everything VS Code draws of `items` and the rows under them, and what their actions act on,
 * below the trust row while `isRestricted`.
 */
function drawnRows(items: readonly CoursesTreeItem[], isRestricted: boolean): string {
  const drawn = (item: CoursesTreeItem): unknown => [
    item.id,
    item.label,
    item.description,
    item.contextValue,
    item.collapsibleState,
    item.iconPath,
    item.accessibilityInformation,
    item.buildTooltip().value,
    item instanceof ExerciseTreeItem
      ? item.exerciseUri?.fsPath
      : item.children.map((child) => drawn(child)),
  ]
  return JSON.stringify([isRestricted, items.map((item) => drawn(item))])
}

/** Every exercise under `item`, in view order. */
export function exerciseItems(item: CoursesTreeItem): ExerciseTreeItem[] {
  return item instanceof ExerciseTreeItem
    ? [item]
    : item.children.flatMap((child) => exerciseItems(child))
}

/** Whether an exercise in `status` can be downloaded: it is not on disk, nor on its way. */
export function isDownloadable(status: ExerciseView["status"]): boolean {
  return (
    status === "missing" || status === "new" || status === "expired" || status === "downloadFailed"
  )
}

function exerciseIcon(exercise: ExerciseView): vscode.ThemeIcon {
  switch (exercise.status) {
    case "downloading":
      return new vscode.ThemeIcon("sync~spin")
    case "downloadFailed":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconErrored"))
    default:
      break
  }
  if (exercise.passed) {
    return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"))
  }
  if (exercise.isOutOfTries) {
    return new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("testing.iconSkipped"))
  }
  switch (exercise.status) {
    case "expired":
      return new vscode.ThemeIcon("lock", new vscode.ThemeColor("disabledForeground"))
    case "new":
      return new vscode.ThemeIcon("cloud-download", new vscode.ThemeColor("testing.iconQueued"))
    case "missing":
      return new vscode.ThemeIcon("cloud-download", new vscode.ThemeColor("testing.iconUnset"))
    default:
      return new vscode.ThemeIcon(
        "circle-large-outline",
        new vscode.ThemeColor("testing.iconUnset"),
      )
  }
}

/** A tmc part's slug prefix as a student reads it: `part01` is "Part 1". */
export function partLabel(name: string): string {
  const number = name.match(/^part0*(\d+)$/i)?.[1]
  return number ? `Part ${number}` : name
}

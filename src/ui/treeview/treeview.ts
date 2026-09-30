import * as vscode from "vscode"

import type WorkspaceManager from "../../api/workspaceManager"
import type { BackendKind, CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { backendName, LocalCourseData } from "../../shared/shared"
import { formatDeadline } from "../../utilities"
import { exerciseStatusRegistry } from "../exerciseStatusRegistry"
import { updateablesRegistry } from "../updateablesRegistry"
import type { ExerciseView, PartView } from "./courseViewModel"
import { buildCourseView, shownDeadline } from "./courseViewModel"

/** The id of the TestMyCode view, for `withProgress({ location: { viewId } })` too. */
export const COURSES_VIEW_ID = "tmcView"

/** What the Courses view is drawn from; read afresh on every render. */
export interface CoursesTreeSource {
  getCourses: () => LocalCourseData[]
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

/** Any row of the Courses view; the view's commands receive these. */
export type CoursesTreeItem = CourseTreeItem | PartTreeItem | ExerciseTreeItem

/**
 * One of the user's courses in the Courses view.
 *
 * `contextValue` is `course.<backend>` followed by the flags package.json's `viewItem`
 * clauses match on: `.hasNew` (exercises the user has not downloaded), `.hasUpdates` and
 * `.hasCompleted` (passed exercises still open).
 */
export class CourseTreeItem extends vscode.TreeItem {
  public readonly courseId: CourseIdentifier
  public readonly parent: undefined = undefined
  /** The course's parts, or its exercises directly when none of them names a part. */
  public readonly children: (PartTreeItem | ExerciseTreeItem)[]

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
    this.id = `${course.kind}:${course.data.id}`
    const exercises = parts.flatMap((part) => part.exercises)
    const newCount = LocalCourseData.getNewExercises(course).length
    const updateCount = exercises.filter((ex) => ex.isUpdateable).length
    const hasCompleted = exercises.some((ex) => ex.passed && ex.status === "opened")
    const { awardedPoints, availablePoints, disabled } = course.data
    const points = availablePoints > 0 ? `${awardedPoints}/${availablePoints}` : undefined
    const backend = backendName(course.kind)

    // Titles are only unique within one backend, so the backend is always shown.
    this.description = [points, backend, disabled ? "disabled" : undefined]
      .filter((part) => part !== undefined)
      .join(" · ")
    this.iconPath = disabled
      ? new vscode.ThemeIcon("book", new vscode.ThemeColor("disabledForeground"))
      : new vscode.ThemeIcon("book")
    this.contextValue = [
      `course.${course.kind}`,
      ...(newCount > 0 ? ["hasNew"] : []),
      ...(updateCount > 0 ? ["hasUpdates"] : []),
      ...(hasCompleted ? ["hasCompleted"] : []),
    ].join(".")
    const tooltip = new vscode.MarkdownString()
    tooltip.appendMarkdown("**").appendText(title).appendMarkdown("**\n\n").appendText(backend)
    for (const line of [
      points && `${points} points`,
      newCount > 0 && countOf(newCount, "new exercise"),
      updateCount > 0 && countOf(updateCount, "exercise update"),
      disabled && "This course is disabled: its exercises cannot be downloaded or submitted.",
    ]) {
      if (line) {
        tooltip.appendMarkdown("\n\n").appendText(line)
      }
    }
    this.tooltip = tooltip
    this.accessibilityInformation = {
      label: [
        title,
        ...(points ? [`${awardedPoints} of ${availablePoints} points`] : []),
        backend,
        ...(disabled ? ["disabled"] : []),
        ...(newCount > 0 ? [countOf(newCount, "new exercise")] : []),
        ...(updateCount > 0 ? [countOf(updateCount, "exercise update")] : []),
      ].join(", "),
    }
    this.children =
      parts.length === 1 && parts[0]?.isUngrouped
        ? exercises.map((ex) => new ExerciseTreeItem(this, this.courseId, ex, context))
        : parts.map((part) => new PartTreeItem(this, part, context))
  }
}

/**
 * A part of a course. `contextValue` is `part` followed by `.hasMissing`, `.hasClosed` and
 * `.hasOpened`, for the bulk actions that apply to its exercises.
 */
export class PartTreeItem extends vscode.TreeItem {
  public readonly courseId: CourseIdentifier
  public readonly children: ExerciseTreeItem[]

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
    this.id = `${parent.id}/${part.name}`
    const passed = part.exercises.filter((ex) => ex.passed).length
    const nextDeadline =
      part.nextDeadline && !context.isOffline
        ? formatDeadline(part.nextDeadline, context.now, context.locale)
        : undefined
    this.description = [
      `${passed}/${part.exercises.length} passed`,
      nextDeadline && `next deadline ${nextDeadline}`,
    ]
      .filter((text) => text !== undefined)
      .join(" · ")
    this.accessibilityInformation = {
      label: [
        label,
        `${passed} of ${part.exercises.length} passed`,
        ...(nextDeadline ? [`next deadline ${nextDeadline}`] : []),
      ].join(", "),
    }
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
    const tooltip = new vscode.MarkdownString()
    tooltip
      .appendMarkdown("**")
      .appendText(label)
      .appendMarkdown("**\n\n")
      .appendText(`${passed} of ${part.exercises.length} exercises passed`)
    if (nextDeadline) {
      tooltip.appendMarkdown("\n\n").appendText(`Next deadline: ${nextDeadline}`)
    }
    this.tooltip = tooltip
    this.children = part.exercises.map(
      (ex) => new ExerciseTreeItem(this, this.courseId, ex, context),
    )
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
  public readonly isPassed: boolean
  public readonly isUpdateable: boolean

  public constructor(
    public readonly parent: CourseTreeItem | PartTreeItem,
    public readonly courseId: CourseIdentifier,
    exercise: ExerciseView,
    context: RenderContext,
  ) {
    super(exercise.name, vscode.TreeItemCollapsibleState.None)
    this.id = `${parent.id}/${exercise.slug}`
    this.exerciseId = exercise.id
    this.exerciseUri = exercise.onDisk?.uri
    this.status = exercise.status
    this.isPassed = exercise.passed
    this.isUpdateable = exercise.isUpdateable

    const deadline = shownDeadline(exercise)
    const isDue = !exercise.passed && deadline !== null && deadline > context.now
    const deadlineText = deadline ? formatDeadline(deadline, context.now, context.locale) : ""
    const points =
      exercise.availablePoints > 0
        ? `${exercise.awardedPoints}/${exercise.availablePoints} points`
        : undefined
    const status = STATUS_LABELS[exercise.status]
    this.description = [
      exercise.status === "opened" ? undefined : status,
      exercise.isUpdateable ? "update available" : undefined,
      points,
      isDue ? `due ${deadlineText}` : undefined,
    ]
      .filter((text) => text !== undefined)
      .join(" · ")
    this.iconPath = exerciseIcon(exercise)
    this.contextValue = [
      `exercise.${exercise.status}`,
      ...(exercise.passed ? ["passed"] : []),
      ...(exercise.isUpdateable ? ["updateable"] : []),
    ].join(".")
    this.accessibilityInformation = {
      label: [
        exercise.name,
        exercise.passed ? "passed" : "not passed",
        status,
        ...(exercise.isUpdateable ? ["update available"] : []),
        ...(points ? [points] : []),
        ...(isDue ? [`due ${deadlineText}`] : []),
      ].join(", "),
    }

    const tooltip = new vscode.MarkdownString()
    tooltip.appendMarkdown("**").appendText(exercise.name).appendMarkdown("**\n\n")
    tooltip.appendText(`${exercise.passed ? "Passed" : "Not passed"} · ${status}`)
    for (const line of [
      points,
      exercise.isUpdateable && "An update is available.",
      exercise.softDeadline &&
        !exercise.isHard &&
        `Soft deadline: ${formatDeadline(exercise.softDeadline, context.now, context.locale)}. Submitted after it, the exercise awards 75% of its points.`,
      exercise.hardDeadline &&
        `Deadline: ${formatDeadline(exercise.hardDeadline, context.now, context.locale)}`,
    ]) {
      if (line) {
        tooltip.appendMarkdown("\n\n").appendText(line)
      }
    }
    this.tooltip = tooltip
  }
}

/**
 * The Courses view: the user's courses, their parts and exercises while logged in, and
 * nothing otherwise, so that package.json's `viewsWelcome` explains the empty, logged-out
 * and failed states.
 */
export default class CoursesTree implements vscode.TreeDataProvider<CoursesTreeItem> {
  private readonly _changed = new vscode.EventEmitter<undefined>()
  public readonly onDidChangeTreeData = this._changed.event
  private readonly _view: vscode.TreeView<CoursesTreeItem>
  private readonly _disposables: vscode.Disposable[]
  private _source: CoursesTreeSource | undefined
  private _sourceSubscription: vscode.Disposable | undefined
  private _isLoggedIn = false
  private readonly _unreachableBackends = new Set<BackendKind>()
  private _roots: CourseTreeItem[] | undefined

  public constructor() {
    this._view = vscode.window.createTreeView(COURSES_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: true,
    })
    this._disposables = [
      this._view,
      this._changed,
      exerciseStatusRegistry.onDidChange(() => this.refresh()),
      updateablesRegistry.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => void this.revealActiveExercise()),
      this._view.onDidChangeVisibility(() => void this.revealActiveExercise()),
    ]
  }

  public dispose(): void {
    this._sourceSubscription?.dispose()
    for (const disposable of this._disposables) {
      disposable.dispose()
    }
  }

  /** Sets what the view is drawn from. Call once activation has it. */
  public setSource(source: CoursesTreeSource): void {
    this._sourceSubscription?.dispose()
    this._source = source
    this._sourceSubscription = source.workspaceManager.onDidChangeExercises(() => this.refresh())
    this.refresh()
    void this.revealActiveExercise()
  }

  public setLoggedIn(isLoggedIn: boolean): void {
    if (isLoggedIn !== this._isLoggedIn) {
      this._isLoggedIn = isLoggedIn
      this.refresh()
    }
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

  /** Re-renders the view; call after the user's courses change. */
  public refresh(): void {
    this._roots = undefined
    const roots = this._currentRoots()
    const newCount = this._visibleCourses().reduce(
      (total, course) => total + LocalCourseData.getNewExercises(course).length,
      0,
    )
    const updateCount = roots
      .flatMap((child) => exerciseItems(child))
      .filter((item) => item.isUpdateable).length
    const counts = [
      ...(newCount > 0 ? [countOf(newCount, "new exercise")] : []),
      ...(updateCount > 0 ? [countOf(updateCount, "exercise update")] : []),
    ]
    this._view.badge =
      counts.length > 0 ? { value: newCount + updateCount, tooltip: counts.join(", ") } : undefined
    const unreachable = [...this._unreachableBackends].map((backend) => backendName(backend))
    // An empty message hides it; the typings do not admit `undefined`.
    this._view.message =
      unreachable.length > 0 && roots.length > 0
        ? `${unreachable.join(" and ")} could not be reached. Showing the exercises saved on this computer; deadlines may be out of date.`
        : ""
    this._changed.fire(undefined)
  }

  public getChildren(element?: CoursesTreeItem): CoursesTreeItem[] {
    if (!element) {
      return this._currentRoots()
    }
    return element instanceof ExerciseTreeItem ? [] : element.children
  }

  public getTreeItem(element: CoursesTreeItem): CoursesTreeItem {
    return element
  }

  public getParent(element: CoursesTreeItem): CoursesTreeItem | undefined {
    return element.parent
  }

  /**
   * Selects the exercise the active editor belongs to, without taking focus. Only while
   * the view is visible: revealing into a hidden view would open the sidebar.
   */
  public async revealActiveExercise(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri
    const exercise = uri && this._source?.workspaceManager.getExerciseContaining(uri)
    if (!exercise || !this._view.visible) {
      return
    }
    const item = this._currentRoots()
      .flatMap((child) => exerciseItems(child))
      .find((candidate) => candidate.exerciseUri?.fsPath === exercise.uri.fsPath)
    if (item) {
      await this._view.reveal(item, { select: true, focus: false })
    }
  }

  private _currentRoots(): CourseTreeItem[] {
    if (!this._roots) {
      const workspaceManager = this._source?.workspaceManager
      const workspaceExercises = workspaceManager?.getExercises() ?? []
      const now = new Date()
      const slug = workspaceManager?.activeCourse
      const backend = workspaceManager?.activeCourseBackend
      const activeCourse = slug && backend ? { slug, backend } : undefined
      this._roots = this._visibleCourses().map((course) => {
        const courseId = LocalCourseData.getCourseId(course)
        const parts = buildCourseView(course, {
          workspaceExercises,
          inFlight: exerciseStatusRegistry.get(courseId),
          updateable: updateablesRegistry.get(courseId),
          now,
        })
        return new CourseTreeItem(course, parts, {
          now,
          locale: vscode.env.language,
          isOffline: this._unreachableBackends.has(course.kind),
          activeCourse,
        })
      })
    }
    return this._roots
  }

  private _visibleCourses(): LocalCourseData[] {
    return this._isLoggedIn && this._source ? this._source.getCourses() : []
  }
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
function partLabel(name: string): string {
  const number = name.match(/^part0*(\d+)$/i)?.[1]
  return number ? `Part ${number}` : name
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

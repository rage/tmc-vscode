import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/shared"
import { backendName, LocalCourseData } from "../../shared/shared"

/** The id of the TestMyCode view, for `withProgress({ location: { viewId } })` too. */
export const COURSES_VIEW_ID = "tmcView"

/**
 * One of the user's courses in the Courses view.
 *
 * The view's context-menu and inline commands receive this item, so they read the course
 * from {@link courseId}. `contextValue` is `course.<backend>`, with `.hasNew` appended while
 * the course has exercises the user has not downloaded; package.json's `viewItem` clauses
 * match on both parts.
 */
export class CourseTreeItem extends vscode.TreeItem {
  public readonly courseId: CourseIdentifier

  public constructor(course: LocalCourseData) {
    const title = LocalCourseData.getCourseTitle(course)
    super(title, vscode.TreeItemCollapsibleState.None)
    this.courseId = LocalCourseData.getCourseId(course)
    const newExercises = LocalCourseData.getNewExercises(course).length
    const { awardedPoints, availablePoints } = course.data
    const points = availablePoints > 0 ? `${awardedPoints}/${availablePoints}` : undefined
    const backend = backendName(course.kind)

    this.id = `${course.kind}:${course.data.id}`
    // Titles are only unique within one backend, so the backend is always shown.
    this.description = points ? `${points} · ${backend}` : backend
    this.iconPath = new vscode.ThemeIcon("book")
    this.contextValue = `course.${course.kind}${newExercises > 0 ? ".hasNew" : ""}`
    this.tooltip = new vscode.MarkdownString(
      [
        `**${title}**`,
        backend,
        ...(points ? [`${points} points`] : []),
        ...(newExercises > 0
          ? [`${newExercises} new ${newExercises === 1 ? "exercise" : "exercises"}`]
          : []),
      ].join("\n\n"),
    )
    this.command = {
      command: "tmc.courseDetails",
      title: "Go To Course Details",
      arguments: [this.courseId],
    }
  }
}

/**
 * The Courses view: the user's courses while logged in, and nothing otherwise, so that
 * package.json's `viewsWelcome` explains the empty, logged-out and failed states.
 */
export default class CoursesTree implements vscode.TreeDataProvider<CourseTreeItem> {
  private readonly _changed = new vscode.EventEmitter<undefined>()
  public readonly onDidChangeTreeData = this._changed.event
  private readonly _view: vscode.TreeView<CourseTreeItem>
  private _courses: (() => LocalCourseData[]) | undefined
  private _isLoggedIn = false

  public constructor() {
    this._view = vscode.window.createTreeView(COURSES_VIEW_ID, { treeDataProvider: this })
  }

  public dispose(): void {
    this._view.dispose()
    this._changed.dispose()
  }

  /** Sets where the courses come from; read on every render. Call once activation has them. */
  public setCourseSource(courses: () => LocalCourseData[]): void {
    this._courses = courses
    this.refresh()
  }

  public setLoggedIn(isLoggedIn: boolean): void {
    if (isLoggedIn !== this._isLoggedIn) {
      this._isLoggedIn = isLoggedIn
      this.refresh()
    }
  }

  /** Re-renders the view; call after the user's courses change. */
  public refresh(): void {
    const newExercises = this._visibleCourses().reduce(
      (total, course) => total + LocalCourseData.getNewExercises(course).length,
      0,
    )
    this._view.badge =
      newExercises > 0
        ? {
            value: newExercises,
            tooltip: `${newExercises} new ${newExercises === 1 ? "exercise" : "exercises"}`,
          }
        : undefined
    this._changed.fire(undefined)
  }

  public getChildren(element?: CourseTreeItem): CourseTreeItem[] {
    if (element) {
      return []
    }
    return this._visibleCourses().map((course) => new CourseTreeItem(course))
  }

  public getTreeItem(element: CourseTreeItem): CourseTreeItem {
    return element
  }

  private _visibleCourses(): LocalCourseData[] {
    return this._isLoggedIn && this._courses ? this._courses() : []
  }
}

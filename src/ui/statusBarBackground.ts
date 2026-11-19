import * as vscode from "vscode"

import type { BackgroundJob, JobScreen } from "./backgroundJobs"
import type { FailedUpdate } from "./failedUpdates"
import { tooltipOf } from "./tooltip"
import { COURSES_VIEW_ID } from "./treeview/treeview"

/** What the background status bar item reads. */
export interface BackgroundSources {
  jobs: { running: readonly BackgroundJob[]; onDidChange: vscode.Event<void> }
  failedUpdates: { all: () => FailedUpdate[]; onDidChange: vscode.Event<void> }
}

/** The Test Results view's own id, which VS Code's testing contributes. */
const TEST_RESULTS_VIEW_ID = "workbench.panel.testResults.view"

/**
 * The one status bar item for what goes on out of sight: a spinner naming the job started last,
 * and how many more run, while any does; otherwise the exercises whose update failed. Clicking it
 * opens the screen that shows the job, or the course home of the first failed update, which says
 * why and offers Try Again. Hidden while there is neither.
 */
export class BackgroundStatusBarItem implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem
  private readonly _subscriptions: vscode.Disposable[]

  public constructor(private readonly _sources: BackgroundSources) {
    this._item = vscode.window.createStatusBarItem(
      "tmc.background",
      vscode.StatusBarAlignment.Left,
      -1,
    )
    this._item.name = "TestMyCode Background Jobs"
    const render = (): void => this.render()
    this._subscriptions = [
      _sources.jobs.onDidChange(render),
      _sources.failedUpdates.onDidChange(render),
    ]
    this.render()
  }

  public render(): void {
    const jobs = this._sources.jobs.running
    const latest = jobs.at(-1)
    if (latest) {
      this._renderJobs(latest, jobs)
      return
    }
    const failed = this._sources.failedUpdates.all()
    const [first] = failed
    if (first) {
      this._renderFailedUpdates(first, failed)
      return
    }
    this._item.hide()
  }

  public dispose(): void {
    vscode.Disposable.from(...this._subscriptions).dispose()
    this._item.dispose()
  }

  private _renderJobs(latest: BackgroundJob, jobs: readonly BackgroundJob[]): void {
    const more = jobs.length > 1 ? ` (+${jobs.length - 1})` : ""
    this._item.text = `$(sync~spin) TestMyCode: ${latest.label}${more}`
    this._item.command = { title: "Show", ...commandFor(latest.screen) }
    const labels = jobs.map((job) => job.label).toReversed()
    this._item.tooltip = tooltipOf(["TestMyCode", ...labels, "Click to show it."])
    this._item.accessibilityInformation = { label: `TestMyCode: ${labels.join(", ")}. Show it` }
    this._item.show()
  }

  private _renderFailedUpdates(first: FailedUpdate, failed: readonly FailedUpdate[]): void {
    const names = failed.map((x) => x.exerciseName).join(", ")
    const subject = failed.length === 1 ? first.exerciseName : `${failed.length} exercises`
    const reasons = [...new Set(failed.map((x) => x.reason))].join(" ")
    this._item.text = `$(warning) Update failed: ${subject}`
    this._item.command = {
      title: "Show Course",
      command: "tmc.courseDetails",
      arguments: [first.courseId],
    }
    this._item.tooltip = new vscode.MarkdownString(
      `**TestMyCode**\n\nCould not update ${names}. ${reasons}\n\nSelect to show the course.`,
    )
    this._item.accessibilityInformation = {
      label: `TestMyCode: could not update ${names}. Show the course`,
    }
    this._item.show()
  }
}

function commandFor(screen: JobScreen): { command: string; arguments?: unknown[] } {
  switch (screen.kind) {
    case "courseHome":
      return { command: "tmc.courseDetails", arguments: [screen.courseId] }
    case "results":
      return { command: "tmc.showExerciseResults", arguments: [screen.exerciseUri] }
    case "coursesView":
      return { command: `${COURSES_VIEW_ID}.focus` }
    case "testResults":
      return { command: `${TEST_RESULTS_VIEW_ID}.focus` }
  }
}

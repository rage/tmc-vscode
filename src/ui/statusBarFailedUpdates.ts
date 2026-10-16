import * as vscode from "vscode"

import type { FailedUpdate } from "./failedUpdates"

/** What the failed-updates status bar item reads. */
export interface FailedUpdatesSource {
  all: () => FailedUpdate[]
  onDidChange: vscode.Event<void>
}

/**
 * The status bar item that names the exercises whose update failed, and checks for updates again
 * when clicked. Hidden while none has failed, so it goes away by itself once the cause is gone.
 */
export class FailedUpdatesStatusBarItem implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem
  private readonly _subscription: vscode.Disposable

  public constructor(private readonly _source: FailedUpdatesSource) {
    this._item = vscode.window.createStatusBarItem(
      "tmc.failedUpdates",
      vscode.StatusBarAlignment.Left,
      -1,
    )
    this._item.name = "TestMyCode Failed Updates"
    this._item.command = "tmc.updateExercises"
    this._subscription = _source.onDidChange(() => this.render())
    this.render()
  }

  public render(): void {
    const failed = this._source.all()
    const [first] = failed
    if (!first) {
      this._item.hide()
      return
    }
    const names = failed.map((x) => x.exerciseName).join(", ")
    const subject = failed.length === 1 ? first.exerciseName : `${failed.length} exercises`
    const reasons = [...new Set(failed.map((x) => x.reason))].join(" ")
    this._item.text = `$(warning) Update failed: ${subject}`
    this._item.tooltip = new vscode.MarkdownString(
      `**TestMyCode**\n\nCould not update ${names}. ${reasons}\n\nSelect to check for updates again.`,
    )
    this._item.accessibilityInformation = {
      label: `TestMyCode: could not update ${names}. Check for updates again`,
    }
    this._item.show()
  }

  public dispose(): void {
    this._subscription.dispose()
    this._item.dispose()
  }
}

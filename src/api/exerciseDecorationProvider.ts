import * as vscode from "vscode"

import type { WorkspaceExercise } from "../api/workspaceManager"
import type WorkspaceManager from "../api/workspaceManager"
import type { UserData } from "../config/userdata"

/**
 * Class that adds decorations like completion icons for exercises.
 */
export default class ExerciseDecorationProvider
  implements vscode.Disposable, vscode.FileDecorationProvider
{
  public onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined>

  private static _passedExercise = new vscode.FileDecoration(
    "⬤",
    "Passed",
    new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
  )

  private static _partiallyCompletedExercise = new vscode.FileDecoration(
    "○",
    "Not passed, some points",
    new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
  )

  private static _outOfTriesExercise = new vscode.FileDecoration(
    "⊘",
    "No tries left, so this score is final.",
    new vscode.ThemeColor("disabledForeground"),
  )

  private static _missingExercise = new vscode.FileDecoration(
    "ⓘ",
    "This exercise is no longer in the course.",
    new vscode.ThemeColor("gitDecoration.ignoredResourceForeground"),
  )

  private static _expiredExercise = new vscode.FileDecoration("✗", "Deadline passed")

  private _eventEmiter: vscode.EventEmitter<vscode.Uri | vscode.Uri[]>

  public constructor(
    private readonly userData: UserData,
    private readonly workspaceManager: WorkspaceManager,
  ) {
    this._eventEmiter = new vscode.EventEmitter()
    this.onDidChangeFileDecorations = this._eventEmiter.event
  }

  public dispose(): void {
    this._eventEmiter.dispose()
  }

  public provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const exercise = this.workspaceManager.getExerciseByPath(uri)
    if (!exercise) {
      return
    }

    const stored = this.userData.getExercise(exercise.id)
    if (stored.err) {
      return ExerciseDecorationProvider._missingExercise
    }
    const apiExercise = stored.val.exercise.data

    if (apiExercise.passed) {
      return ExerciseDecorationProvider._passedExercise
    }
    if ("outOfTries" in apiExercise && apiExercise.outOfTries) {
      return ExerciseDecorationProvider._outOfTriesExercise
    }

    const deadlinePassed = apiExercise.deadline
      ? Date.now() > Date.parse(apiExercise.deadline)
      : undefined
    if (deadlinePassed) {
      return ExerciseDecorationProvider._expiredExercise
    }

    if (apiExercise.awardedPoints > 0) {
      return ExerciseDecorationProvider._partiallyCompletedExercise
    }

    return undefined
  }

  /** Refreshes the decorations of `exercises`; needs prior `registerFileDecorationProvider`. */
  public updateDecorationsForExercises(...exercises: readonly WorkspaceExercise[]): void {
    this._eventEmiter.fire(exercises.map((x) => x.uri))
  }
}

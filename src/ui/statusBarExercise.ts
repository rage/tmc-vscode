import * as vscode from "vscode"

import type Dialog from "../api/dialog"
import type { Item } from "../api/dialog"
import { separator } from "../api/dialog"
import type WorkspaceManager from "../api/workspaceManager"
import { exerciseFor } from "../api/workspaceManager"
import type { UserData } from "../config/userdata"
import { LocalCourseExercise } from "../shared/shared"
import type { ExerciseOperationKind, ExerciseOperations } from "./exerciseOperations"
import { pointsText } from "./points"

/** What the exercise status bar item and its action pick read. */
export interface ExerciseStatusSources {
  workspaceManager: Pick<
    WorkspaceManager,
    "activeExercise" | "getExerciseContaining" | "onDidChangeExercises"
  >
  userData: Pick<UserData, "getExerciseByName" | "getCourseBySlug" | "onDidChangeCourses">
  operations: Pick<ExerciseOperations, "current" | "onDidChange">
}

const activityLabels: Partial<Record<ExerciseOperationKind, string>> = {
  testing: "Testing",
  submitting: "Submitting",
}

/**
 * The status bar item that names the exercise the active editor belongs to, with its points,
 * and opens {@link showExerciseActions} when clicked. Hidden on any other file; shows a
 * spinner while the exercise is being tested or submitted.
 */
export class ExerciseStatusBarItem implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem
  private readonly _subscriptions: vscode.Disposable[]

  public constructor(private readonly _sources: ExerciseStatusSources) {
    this._item = vscode.window.createStatusBarItem(
      "tmc.activeExercise",
      vscode.StatusBarAlignment.Right,
      100,
    )
    this._item.name = "TestMyCode Exercise"
    this._item.command = "tmc.showExerciseActions"
    const render = (): void => this.render()
    this._subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(render),
      _sources.workspaceManager.onDidChangeExercises(render),
      _sources.operations.onDidChange(render),
      _sources.userData.onDidChangeCourses(render),
    ]
    this.render()
  }

  /** Shows the item for the active editor's exercise, or hides it. */
  public render(): void {
    const exercise = this._sources.workspaceManager.activeExercise
    if (!exercise) {
      this._item.hide()
      return
    }
    const slug = exercise.exerciseSlug
    const stored = this._sources.userData.getExerciseByName(
      exercise.backend,
      exercise.courseSlug,
      exercise.exerciseSlug,
    )
    const running = stored && this._sources.operations.current(LocalCourseExercise.getId(stored))
    const activity = running && activityLabels[running]
    const points = stored && pointsText(stored.data.awardedPoints, stored.data.availablePoints)

    if (activity) {
      this._item.text = `$(sync~spin) ${activity} ${slug}…`
      this._item.accessibilityInformation = {
        label: `TestMyCode: ${activity.toLowerCase()} ${slug}`,
      }
    } else {
      this._item.text = points ? `$(beaker) ${slug} · ${points.short}` : `$(beaker) ${slug}`
      this._item.accessibilityInformation = {
        label:
          `TestMyCode exercise ${slug}` +
          (points ? `, ${points.spoken}` : "") +
          ". Show exercise actions",
      }
    }
    this._item.tooltip = new vscode.MarkdownString(
      [
        `**${slug}**`,
        exercise.courseSlug,
        ...(points ? [`${points.short} points${stored?.data.passed ? " · passed" : ""}`] : []),
        "Click for exercise actions.",
      ].join("\n\n"),
    )
    this._item.show()
  }

  public dispose(): void {
    vscode.Disposable.from(...this._subscriptions).dispose()
    this._item.dispose()
  }
}

interface ExerciseAction {
  command: string
  arguments: unknown[]
}

/**
 * Offers the actions for one exercise and runs the one the user picks.
 *
 * @param resource A file or folder of the exercise; the active editor's exercise when omitted.
 * @param isLoggedIn Whether to offer the actions that reach a backend.
 */
export async function showExerciseActions(
  dialog: Dialog,
  sources: Pick<ExerciseStatusSources, "workspaceManager" | "userData">,
  isLoggedIn: boolean,
  resource?: vscode.Uri,
): Promise<void> {
  const exercise = exerciseFor(sources.workspaceManager, resource)
  if (!exercise) {
    return
  }
  const target = [exercise.uri]
  const action = (label: string, command: string): Item<ExerciseAction> => ({
    label,
    value: { command, arguments: target },
  })
  const course = sources.userData.getCourseBySlug(exercise.backend, exercise.courseSlug)
  const picked = await dialog.selectItem(
    { title: exercise.exerciseSlug, placeHolder: "What do you want to do with this exercise?" },
    action("$(beaker) Run Tests", "tmc.testExercise"),
    ...(isLoggedIn
      ? [
          action("$(cloud-upload) Submit Solution", "tmc.submitExercise"),
          action("$(link) Share via Paste", "tmc.pasteExercise"),
          separator("Restore"),
          action("$(history) Download Old Submission…", "tmc.downloadOldSubmission"),
          action("$(discard) Reset Exercise", "tmc.resetExercise"),
          ...(course.ok
            ? [
                separator("Course"),
                action("$(list-tree) Reveal in Courses View", "tmc.revealInCoursesView"),
              ]
            : []),
        ]
      : []),
  )
  if (picked) {
    await vscode.commands.executeCommand(picked.command, ...picked.arguments)
  }
}

import * as vscode from "vscode"

import type WorkspaceManager from "../api/workspaceManager"
import type { WorkspaceExercise } from "../api/workspaceManager"
import type { UserData } from "../config/userdata"
import type { ExerciseActivity, ExerciseActivityKind } from "./statusBarActivity"

/** What the exercise status bar item and its action pick read. */
export interface ExerciseStatusSources {
  workspaceManager: Pick<
    WorkspaceManager,
    "activeExercise" | "getExerciseContaining" | "onDidChangeExercises"
  >
  userData: Pick<UserData, "getExerciseByName" | "getCourseBySlug">
  activity: ExerciseActivity
  /** Fires after the stored courses change, which is when points change. */
  onDidChangeCourses: vscode.Event<unknown>
}

const activityLabels: Record<ExerciseActivityKind, string> = {
  testing: "Testing",
  submitting: "Submitting",
}

function pointsOf(
  sources: ExerciseStatusSources,
  exercise: WorkspaceExercise,
): { awarded: number; available: number; isPassed: boolean } | undefined {
  const stored = sources.userData.getExerciseByName(
    exercise.backend,
    exercise.courseSlug,
    exercise.exerciseSlug,
  )
  return stored
    ? {
        awarded: stored.data.awardedPoints,
        available: stored.data.availablePoints,
        isPassed: stored.data.passed,
      }
    : undefined
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
      _sources.activity.onDidChange(render),
      _sources.onDidChangeCourses(render),
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
    const activity = this._sources.activity.current(exercise.uri)
    const points = pointsOf(this._sources, exercise)
    const pointsText =
      points && points.available > 0 ? `${points.awarded}/${points.available}` : undefined

    if (activity) {
      this._item.text = `$(sync~spin) ${activityLabels[activity]} ${slug}…`
      this._item.accessibilityInformation = {
        label: `TestMyCode: ${activityLabels[activity].toLowerCase()} ${slug}`,
      }
    } else {
      this._item.text = pointsText ? `$(beaker) ${slug} · ${pointsText}` : `$(beaker) ${slug}`
      this._item.accessibilityInformation = {
        label:
          `TestMyCode exercise ${slug}` +
          (points && pointsText ? `, ${points.awarded} of ${points.available} points` : "") +
          ". Show exercise actions",
      }
    }
    this._item.tooltip = new vscode.MarkdownString(
      [
        `**${slug}**`,
        exercise.courseSlug,
        ...(pointsText ? [`${pointsText} points${points?.isPassed ? " · passed" : ""}`] : []),
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

interface ExerciseAction extends vscode.QuickPickItem {
  command?: string
  arguments?: unknown[]
}

function separator(label: string): ExerciseAction {
  return { label, kind: vscode.QuickPickItemKind.Separator }
}

/**
 * Offers the actions for one exercise and runs the one the user picks.
 *
 * @param resource A file or folder of the exercise; the active editor's exercise when omitted.
 * @param isLoggedIn Whether to offer the actions that reach a backend.
 */
export async function showExerciseActions(
  sources: Pick<ExerciseStatusSources, "workspaceManager" | "userData">,
  isLoggedIn: boolean,
  resource?: vscode.Uri,
): Promise<void> {
  const exercise = resource
    ? sources.workspaceManager.getExerciseContaining(resource)
    : sources.workspaceManager.activeExercise
  if (!exercise) {
    return
  }
  const target = [exercise.uri]
  const course = sources.userData.getCourseBySlug(exercise.backend, exercise.courseSlug)
  const actions: ExerciseAction[] = [
    { label: "$(beaker) Run Tests", command: "tmc.testExercise", arguments: target },
    ...(isLoggedIn
      ? [
          {
            label: "$(cloud-upload) Submit Solution",
            command: "tmc.submitExercise",
            arguments: target,
          },
          { label: "$(link) Share via Paste", command: "tmc.pasteExercise", arguments: target },
          separator("Restore"),
          {
            label: "$(history) Download Old Submission…",
            command: "tmc.downloadOldSubmission",
            arguments: target,
          },
          { label: "$(discard) Reset Exercise", command: "tmc.resetExercise", arguments: target },
          ...(course.ok
            ? [
                separator("Course"),
                {
                  label: "$(list-tree) Reveal in Courses View",
                  command: "tmc.revealInCoursesView",
                  arguments: target,
                },
              ]
            : []),
        ]
      : []),
  ]
  const picked = await vscode.window.showQuickPick(actions, {
    title: exercise.exerciseSlug,
    placeHolder: "What do you want to do with this exercise?",
  })
  if (picked?.command) {
    await vscode.commands.executeCommand(picked.command, ...(picked.arguments ?? []))
  }
}

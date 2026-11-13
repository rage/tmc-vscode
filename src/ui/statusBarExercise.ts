import * as vscode from "vscode"

import type { LocalCourseExercise } from "../../shared/lib"
import {
  LocalCourseData,
  modelSolutionUrlOf,
  SUBMIT_REFUSAL_LABELS,
  submitRefusalOf,
  triesLeftText,
} from "../../shared/lib"
import type Dialog from "../api/dialog"
import type { Item } from "../api/dialog"
import { separator } from "../api/dialog"
import type WorkspaceManager from "../api/workspaceManager"
import { exerciseFor } from "../api/workspaceManager"
import type { UserData } from "../config/userdata"
import type { ExerciseOperationKind, ExerciseOperations } from "./exerciseOperations"
import { pointsText } from "./points"
import { tooltipOf } from "./tooltip"

/** What the exercise status bar item and its action pick read. */
export interface ExerciseStatusSources {
  workspaceManager: Pick<
    WorkspaceManager,
    "activeExercise" | "getExerciseContaining" | "onDidChangeExercises"
  >
  userData: Pick<UserData, "getExercise" | "getCourse" | "onDidChangeCourses">
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
    const storedResult = this._sources.userData.getExercise(exercise.id)
    const stored = storedResult.ok ? storedResult.val.exercise : undefined
    const running = this._sources.operations.current(exercise.id)
    const activity = running && activityLabels[running]
    const points = stored && pointsText(stored.data.awardedPoints, stored.data.availablePoints)
    const standing = standingText(stored)
    const shownStanding = standing === "passed" ? undefined : standing

    if (activity) {
      this._item.text = `$(sync~spin) ${activity} ${slug}…`
      this._item.accessibilityInformation = {
        label: `TestMyCode: ${activity.toLowerCase()} ${slug}`,
      }
    } else {
      this._item.text = [`$(beaker) ${slug}`, points?.short, shownStanding]
        .filter(Boolean)
        .join(" · ")
      this._item.accessibilityInformation = {
        label:
          `TestMyCode exercise ${slug}` +
          (points ? `, ${points.spoken}` : "") +
          (shownStanding ? `, ${shownStanding}` : "") +
          ". Show exercise actions",
      }
    }
    this._item.tooltip = tooltipOf([
      slug,
      exercise.courseSlug,
      ...(points ? [`${points.short} points${standing ? ` · ${standing}` : ""}`] : []),
      "Click for exercise actions.",
    ])
    this._item.show()
  }

  public dispose(): void {
    vscode.Disposable.from(...this._subscriptions).dispose()
    this._item.dispose()
  }
}

/**
 * Where the stored exercise stands, e.g. "passed", "1 try left" or "deadline passed"; `undefined`
 * when there is nothing to tell.
 */
function standingText(stored: Readonly<LocalCourseExercise> | undefined): string | undefined {
  if (!stored) {
    return undefined
  }
  if (stored.data.passed) {
    return "passed"
  }
  const refusal = submitRefusalOf(stored, new Date())
  if (refusal) {
    return SUBMIT_REFUSAL_LABELS[refusal]
  }
  return stored.kind === "mooc" ? triesLeftText(stored.data.triesLeft) : undefined
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
  const course = sources.userData.getCourse(exercise.courseId)
  const stored = sources.userData.getExercise(exercise.id)
  const isUnlisted = course.ok && stored.err
  const closedChapter = course.ok
    ? LocalCourseData.getClosedChapterOf(course.val, exercise.id)
    : undefined
  const refusal = stored.ok ? submitRefusalOf(stored.val.exercise, new Date()) : undefined
  const placeHolder = closedChapter
    ? `Its chapter "${closedChapter.name}" has not opened yet: it can't be submitted, but its tests run here`
    : isUnlisted
      ? "Removed from the course: it can no longer be submitted, but its tests still run here"
      : refusal
        ? `Can't be submitted: ${SUBMIT_REFUSAL_LABELS[refusal]}`
        : "What do you want to do with this exercise?"
  const picked = await dialog.selectItem(
    { title: exercise.exerciseSlug, placeHolder },
    action("$(beaker) Run Tests", "tmc.testExercise"),
    ...(isLoggedIn && !isUnlisted
      ? [
          ...(refusal ? [] : [action("$(cloud-upload) Submit Solution", "tmc.submitExercise")]),
          action("$(link) Share Exercise via Paste", "tmc.pasteExercise"),
          separator("Restore"),
          action("$(history) Download Old Submission…", "tmc.downloadOldSubmission"),
          action("$(discard) Reset Exercise", "tmc.resetExercise"),
        ]
      : []),
    separator("Course"),
    action("$(arrow-right) Open Next Exercise", "tmc.openNextExercise"),
    ...(stored.ok && modelSolutionUrlOf(stored.val.exercise)
      ? [action("$(lightbulb) Show Model Solution", "tmc.showModelSolution")]
      : []),
    ...(course.ok
      ? [action("$(list-tree) Reveal in Courses View", "tmc.revealInCoursesView")]
      : []),
  )
  if (picked) {
    await vscode.commands.executeCommand(picked.command, ...picked.arguments)
  }
}

import * as vscode from "vscode"

import { submitRefusalOf } from "../../shared/lib"
import type WorkspaceManager from "../api/workspaceManager"
import type { UserData } from "../config/userdata"

/**
 * Keeps the `when`-clause context `key` equal to `compute()`, re-evaluated on each of
 * `events` and written only when it changes.
 */
export function trackContextKey(
  key: string,
  compute: () => boolean,
  events: vscode.Event<unknown>[],
): vscode.Disposable {
  let applied: boolean | undefined
  const update = (): void => {
    const value = compute()
    if (value !== applied) {
      applied = value
      void vscode.commands.executeCommand("setContext", key, value)
    }
  }
  const subscriptions = events.map((event) => event(update))
  update()
  return vscode.Disposable.from(...subscriptions)
}

/**
 * Keeps `test-my-code:ActiveEditorIsExercise` true exactly while the active editor shows a
 * file inside a known exercise, which is what gates the exercise actions on the editor.
 */
export function trackActiveEditorExercise(
  workspaceManager: Pick<WorkspaceManager, "activeExercise" | "onDidChangeExercises">,
): vscode.Disposable {
  return trackContextKey(
    "test-my-code:ActiveEditorIsExercise",
    () => workspaceManager.activeExercise !== undefined,
    [vscode.window.onDidChangeActiveTextEditor, workspaceManager.onDidChangeExercises],
  )
}

/**
 * Keeps `test-my-code:HasCourses` true exactly while the user has a stored course, which is
 * what completes the walkthrough's "Add a course" step.
 */
export function trackHasCourses(
  userData: Pick<UserData, "getCourses" | "onDidChangeCourses">,
): vscode.Disposable {
  return trackContextKey("test-my-code:HasCourses", () => userData.getCourses().length > 0, [
    userData.onDidChangeCourses,
  ])
}

/**
 * Keeps `test-my-code:HasDownloadedExercises` true exactly while some exercise is on disk,
 * which with an open course workspace completes the walkthrough's download step.
 */
export function trackHasDownloadedExercises(
  workspaceManager: Pick<WorkspaceManager, "getExercises" | "onDidChangeExercises">,
): vscode.Disposable {
  return trackContextKey(
    "test-my-code:HasDownloadedExercises",
    () => workspaceManager.getExercises().length > 0,
    [workspaceManager.onDidChangeExercises],
  )
}

/**
 * Keeps `test-my-code:ActiveExerciseRemoved` true exactly while the active editor's exercise is
 * on disk but not among its course's exercises: removed, or hidden until its chapter opens. That
 * hides the actions that need the backend.
 */
export function trackActiveExerciseRemoved(
  workspaceManager: Pick<WorkspaceManager, "activeExercise" | "onDidChangeExercises">,
  userData: Pick<UserData, "getCourse" | "getExercise" | "onDidChangeCourses">,
): vscode.Disposable {
  return trackContextKey(
    "test-my-code:ActiveExerciseRemoved",
    () => {
      const exercise = workspaceManager.activeExercise
      return (
        exercise !== undefined &&
        userData.getExercise(exercise.id).err &&
        userData.getCourse(exercise.courseId).ok
      )
    },
    [
      vscode.window.onDidChangeActiveTextEditor,
      workspaceManager.onDidChangeExercises,
      userData.onDidChangeCourses,
    ],
  )
}

/**
 * Keeps `test-my-code:ActiveExerciseSubmitRefused` true exactly while the backend would refuse a
 * submission of the active editor's exercise (see `submitRefusalOf`), which hides Submit. Judged
 * when the editor, the exercises or the courses change, so a deadline passing in between shows
 * only then; the submit action checks again.
 */
export function trackActiveExerciseSubmitRefused(
  workspaceManager: Pick<WorkspaceManager, "activeExercise" | "onDidChangeExercises">,
  userData: Pick<UserData, "getExercise" | "onDidChangeCourses">,
): vscode.Disposable {
  return trackContextKey(
    "test-my-code:ActiveExerciseSubmitRefused",
    () => {
      const exercise = workspaceManager.activeExercise
      const stored = exercise && userData.getExercise(exercise.id)
      return (
        stored?.ok === true &&
        submitRefusalOf(stored.val.exercise, new Date(), stored.val.course) !== undefined
      )
    },
    [
      vscode.window.onDidChangeActiveTextEditor,
      workspaceManager.onDidChangeExercises,
      userData.onDidChangeCourses,
    ],
  )
}

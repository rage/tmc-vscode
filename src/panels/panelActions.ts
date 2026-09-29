import type { Result } from "ts-results"
import type * as vscode from "vscode"

import type { OpenedExercises } from "../actions/openExercises"
import type { ReadyActionContext } from "../actions/types"
import { InitializationError } from "../errors"
import type { BackendKind, CourseIdentifier, ExerciseIdentifier } from "../shared/shared"

/**
 * The action- and command-layer entry points the webview message handlers invoke.
 *
 * Declared here and supplied at activation rather than imported: both of those layers
 * import the panel layer, so importing them back would put it inside a runtime import
 * cycle spanning most of the extension. The signatures are checked against the real
 * functions where `registerPanelActions` is called.
 */
export interface PanelActions {
  /** Stops the test run `testRunId`. Does nothing if it already finished. */
  cancelTests: (testRunId: number) => void
  closeExercises: (
    actionContext: ReadyActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<ExerciseIdentifier[], Error>>
  downloadAndOpenExercises: (
    actionContext: ReadyActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<OpenedExercises, Error>>
  downloadExercisesForUi: (
    actionContext: ReadyActionContext,
    mode: "download" | "update",
    courseId: CourseIdentifier,
    ids: ExerciseIdentifier[],
  ) => Promise<void>
  openWorkspace: (
    actionContext: ReadyActionContext,
    courseName: string,
    backend: BackendKind,
  ) => Promise<void>
  pasteExercise: (
    actionContext: ReadyActionContext,
    backend: BackendKind,
    courseSlug: string,
    exerciseName: string,
  ) => Promise<Result<string, Error>>
  /** Rescans the exercises on disk, so exercises the backend dropped stop showing as open. */
  refreshLocalExercises: (actionContext: ReadyActionContext) => Promise<Result<void, Error>>
  removeCourse: (
    actionContext: ReadyActionContext,
    id: CourseIdentifier,
  ) => Promise<Result<void, Error>>
  /** Answers a TMC submission's feedback questions; the URL must be one a result named. */
  sendSubmissionFeedback: (
    actionContext: ReadyActionContext,
    feedbackAnswerUrl: string,
    answers: readonly { questionId: number; answer: string }[],
  ) => Promise<Result<void, Error>>
  submitExercise: (
    extensionContext: vscode.ExtensionContext,
    actionContext: ReadyActionContext,
    exerciseUri: vscode.Uri,
  ) => Promise<Result<void, Error>>
  updateCourse: (
    actionContext: ReadyActionContext,
    courseId: CourseIdentifier,
  ) => Promise<Result<boolean, Error>>
}

let registeredActions: PanelActions | undefined

/** Wires the panel layer to the actions and commands it dispatches to. Called once, at activation. */
export function registerPanelActions(actions: PanelActions): void {
  registeredActions = actions
}

/** The actions {@link registerPanelActions} supplied; throws if activation never did. */
export function panelActions(): PanelActions {
  if (registeredActions === undefined) {
    throw new InitializationError("Panel actions were never registered")
  }
  return registeredActions
}

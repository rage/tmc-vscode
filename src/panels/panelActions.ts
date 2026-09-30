import type { Result } from "ts-results"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { InitializationError } from "../errors"
import type { BackendKind, CourseIdentifier, FeedbackAnswer } from "../shared/shared"

/**
 * The action- and command-layer entry points the webview message handlers invoke.
 *
 * Declared here and supplied at activation rather than imported: both of those layers
 * import the panel layer, so importing them back would put it inside a runtime import
 * cycle spanning most of the extension. The signatures are checked against the real
 * functions where `registerPanelActions` is called.
 */
export interface PanelActions {
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
  /** Waits again for a mooc grading the host stopped waiting for; see `keepWaitingForGrading`. */
  keepWaitingForGrading: (
    context: vscode.ExtensionContext,
    actionContext: ReadyActionContext,
    panelId: number,
  ) => Promise<Result<void, Error>>
  /** Rescans the exercises on disk, so exercises the backend dropped stop showing as open. */
  refreshLocalExercises: (actionContext: ReadyActionContext) => Promise<Result<void, Error>>
  /** Answers the feedback questions of the TMC submission panel `panelId` shows. */
  sendSubmissionFeedback: (
    actionContext: ReadyActionContext,
    panelId: number,
    answers: readonly FeedbackAnswer[],
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

import type { Result } from "ts-results"
import { Err } from "ts-results"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { Logger } from "../utilities"

/**
 * Runs an exercise command's own work against the exercise it targets, supplying the
 * prologue and the failure reporting that every exercise command shares.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 * @param label The operation as a gerund phrase, e.g. "Resetting the exercise". It opens
 * the log line and, as "<label> failed.", is the notification's headline of last resort, so
 * it has to read as a sentence subject.
 * @param body The command's actual work. Return `failure` for anything the user should
 * hear about and `Ok` for a path the user chose, such as dismissing a prompt.
 * @returns What `body` returned, or `Err` when there was no exercise to run it against.
 * A failure has already been reported by the time this resolves.
 */
export async function runForExercise<T>(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
  label: string,
  body: (exercise: WorkspaceExercise) => Promise<Result<T, Error>>,
): Promise<Result<T, Error>> {
  const { dialog } = actionContext
  const { workspaceManager } = actionContext.startup
  Logger.info(label)

  const exercise = resource
    ? workspaceManager.getExerciseContaining(resource)
    : workspaceManager.activeExercise
  if (!exercise) {
    const error = new Error("The active editor is not part of a course exercise.")
    dialog.errorNotification(error.message)
    return Err(error)
  }

  return withOperation(dialog, { failure: `${label} failed.`, backend: exercise.backend }, () =>
    body(exercise),
  )
}

import type { Result } from "ts-results"
import { Err } from "ts-results"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { BottleneckError } from "../errors"
import { Logger } from "../utilities"

/**
 * Builds the `Err` a command body returns for a failure the user should hear about.
 *
 * @param headline The sentence the notification leads with, in the user's vocabulary.
 * @param cause The error behind it, kept as the detail the log records; omit it when the
 * headline is the whole story.
 */
export function failure(headline: string, cause?: Error): Err<Error> {
  return Err(new Error(headline, { cause }))
}

/**
 * Runs an exercise command's own work against the exercise it targets, supplying the
 * prologue and the failure reporting that every exercise command shares.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 * @param label The operation as a gerund phrase, e.g. "Resetting the exercise". It opens
 * the log line and the cancellation notice, so it has to read as a sentence subject, and
 * it is the notification's headline of last resort.
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

  const result = await body(exercise)
  if (result.err) {
    const error = result.val
    // A headline `failure` added hides the error it wraps, so report the cause as the
    // detail — and read a cancellation through the wrapper, or it turns into a popup.
    const cause = error.cause instanceof Error ? error.cause : undefined
    const headline = error.message || `${label} failed.`
    if (cause instanceof BottleneckError || error instanceof BottleneckError) {
      Logger.warn(`${label} was cancelled.`, cause ?? error)
    } else if (cause) {
      dialog.reportError(headline, cause, exercise.backend)
    } else {
      dialog.errorNotification(headline, error)
    }
  }
  return result
}

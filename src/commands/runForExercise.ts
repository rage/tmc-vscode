import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { exerciseFor } from "../api/workspaceManager"
import type { RetryOffer } from "../api/workspaceTrustGate"
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
 * @param options.trustedCommand The command being run, when it runs, submits or shares
 * exercise code: in Restricted Mode `body` does not run, and the command runs again once the
 * user trusts the workspace.
 * @param options.retryOffer What to ask before running the command again once trusted; without
 * it the command runs again unasked.
 * @returns What `body` returned, or `Err` when there was no exercise to run it against.
 * A failure has already been reported by the time this resolves.
 */
export async function runForExercise<T>(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
  label: string,
  body: (exercise: WorkspaceExercise) => Promise<Result<T, Error>>,
  options: {
    trustedCommand?: string
    retryOffer?: (exercise: WorkspaceExercise) => RetryOffer
  } = {},
): Promise<Result<T, Error>> {
  const { dialog } = actionContext
  const { workspaceManager } = actionContext.startup
  Logger.info(label)

  const exercise = exerciseFor(workspaceManager, resource)
  if (!exercise) {
    const error = new Error(
      resource
        ? `${path.basename(resource.fsPath)} is not part of a course exercise.`
        : "Open a file of an exercise first.",
    )
    void dialog.errorNotification(error.message)
    return Err(error)
  }

  const { trustedCommand, retryOffer } = options
  return withOperation(dialog, { failure: `${label} failed.` }, () => {
    const trusted = trustedCommand
      ? checkTrustRetrying(actionContext, trustedCommand, exercise, retryOffer?.(exercise))
      : Ok.EMPTY
    return trusted.err ? Promise.resolve(trusted) : body(exercise)
  })
}

/**
 * `Err(WorkspaceUntrustedError)` in Restricted Mode, where `command` then runs on `exercise`
 * again once the user trusts the workspace, after asking `offer` when given.
 */
export function checkTrustRetrying(
  actionContext: ReadyActionContext,
  command: string,
  exercise: Pick<WorkspaceExercise, "uri">,
  offer?: RetryOffer,
): Result<void, Error> {
  const refused = actionContext.startup.trustGate.refusal(
    () => void vscode.commands.executeCommand(command, exercise.uri),
    offer,
  )
  return refused ? Err(refused) : Ok.EMPTY
}

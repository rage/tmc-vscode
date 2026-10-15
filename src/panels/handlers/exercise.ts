import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ExerciseSubmissionPanel } from "../../../shared/lib"
import * as actions from "../../actions"
import { reportWarnings, withOperation } from "../../api/withOperation"
import { Logger } from "../../utilities"
import type { HandlerMap, PanelHost } from "../router"

const EXERCISE_ACTION_COMMANDS = {
  runTests: "tmc.testExercise",
  submit: "tmc.submitExercise",
  openNextExercise: "tmc.openNextExercise",
} as const

/** The submission screen's messages. */
export const exerciseHandlers = {
  pasteExercise: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<string, Error>> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (!shown) {
        Logger.warn("Ignoring a paste from a panel that is no longer shown")
        return Err(new Error("This exercise is no longer shown."))
      }
      // Silent: the panel that asked shows the failure, remedies included.
      return withOperation(
        actionContext.dialog,
        { failure: "Failed to paste the exercise.", silent: true },
        () => actions.pasteExercise(actionContext, shown.exerciseId),
      )
    },
  },
  keepWaitingForGrading: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      if (!shownExercisePanel(host, message.sourcePanel.id)) {
        return Err(new Error("This submission is no longer shown."))
      }
      const waited = await actions.keepWaitingForGrading(actionContext, message.sourcePanel.id)
      if (waited.err) {
        return waited
      }
      reportWarnings(actionContext.dialog, waited.val.warnings)
      return Ok(undefined)
    },
  },
  sendFeedback: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      if (!shownExercisePanel(host, message.sourcePanel.id)) {
        return Err(new Error("This submission is no longer shown."))
      }
      const sent = await actions.sendSubmissionFeedback(
        actionContext,
        message.sourcePanel.id,
        message.answers,
      )
      if (sent.err) {
        Logger.error("Failed to send the submission feedback", sent.val)
        return sent
      }
      return Ok(undefined)
    },
  },
  exerciseAction: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<void> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      const exercise = shown && actionContext.startup.workspaceManager.getExercise(shown.exerciseId)
      if (!exercise) {
        void actionContext.dialog.errorNotification("This exercise is no longer downloaded.")
        return
      }
      await vscode.commands.executeCommand(EXERCISE_ACTION_COMMANDS[message.action], exercise.uri)
    },
  },
  copyToClipboard: {
    requiresReady: false,
    async handle(message): Promise<Result<undefined, unknown>> {
      try {
        await vscode.env.clipboard.writeText(message.text)
        return Ok(undefined)
      } catch (error) {
        Logger.error("Failed to copy to the clipboard", error)
        return Err(error)
      }
    },
  },
} satisfies Partial<HandlerMap>

/**
 * The submission panel `host` shows, if it is still panel `id`.
 *
 * The host acts on its own copy of the panel rather than one the webview sends: the panel
 * names files it reads and a backend it talks to.
 */
function shownExercisePanel(host: PanelHost, id: number): ExerciseSubmissionPanel | undefined {
  const route = host.route
  return route?.type === "ExerciseSubmission" && route.id === id ? route : undefined
}

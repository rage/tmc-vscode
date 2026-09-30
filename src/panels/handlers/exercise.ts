import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { withOperation } from "../../api/withOperation"
import type { ExerciseSubmissionPanel } from "../../shared/shared"
import { Logger } from "../../utilities"
import { panelActions } from "../panelActions"
import type { HandlerMap, PanelHost } from "../router"

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
        { failure: "Failed to paste the exercise.", backend: shown.backend, silent: true },
        () =>
          panelActions().pasteExercise(
            actionContext,
            shown.backend,
            shown.courseSlug,
            shown.exerciseSlug,
          ),
      )
    },
  },
  keepWaitingForGrading: {
    requiresReady: true,
    async handle(
      message,
      { host, actionContext, extensionContext },
    ): Promise<Result<undefined, Error>> {
      if (!shownExercisePanel(host, message.sourcePanel.id)) {
        return Err(new Error("This submission is no longer shown."))
      }
      const waited = await panelActions().keepWaitingForGrading(
        extensionContext,
        actionContext,
        message.sourcePanel.id,
      )
      return waited.err ? waited : Ok(undefined)
    },
  },
  sendFeedback: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      if (!shownExercisePanel(host, message.sourcePanel.id)) {
        return Err(new Error("This submission is no longer shown."))
      }
      const sent = await panelActions().sendSubmissionFeedback(
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

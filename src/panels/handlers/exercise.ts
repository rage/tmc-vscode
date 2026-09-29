import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { withOperation } from "../../api/withOperation"
import type { ExerciseSubmissionPanel, ExerciseTestsPanel } from "../../shared/shared"
import { LocalCourseData, LocalCourseExercise } from "../../shared/shared"
import { Logger } from "../../utilities"
import { panelActions } from "../panelActions"
import type { HandlerMap, PanelHost } from "../router"

/** The test-results and submission screens' messages. */
export const exerciseHandlers = {
  cancelTests: {
    requiresReady: false,
    handle(message): void {
      panelActions().cancelTests(message.testRunId)
    },
  },
  submitExercise: {
    requiresReady: true,
    async handle(message, { host, actionContext, extensionContext }) {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (shown?.type !== "ExerciseTests") {
        Logger.warn("Ignoring a submit from a test results panel that is no longer shown")
        return Err(new Error("These test results are no longer shown."))
      }
      // The command renders its own ExerciseSubmission panel and reports its own failure, so
      // the reply only says the submit is over.
      await panelActions().submitExercise(extensionContext, actionContext, shown.exerciseUri)
      return Ok(undefined)
    },
  },
  pasteExercise: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<string, Error>> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (!shown) {
        Logger.warn("Ignoring a paste from a panel that is no longer shown")
        return Err(new Error("This exercise is no longer shown."))
      }
      // Silent: the panel that asked is on screen and renders the failure itself.
      return withOperation(
        actionContext.dialog,
        { failure: "Failed to paste the exercise.", backend: shown.course.kind, silent: true },
        () =>
          panelActions().pasteExercise(
            actionContext,
            shown.course.kind,
            LocalCourseData.getCourseName(shown.course),
            LocalCourseExercise.getSlug(shown.exercise),
          ),
      )
    },
  },
  sendFeedback: {
    requiresReady: true,
    async handle(message, { actionContext }): Promise<Result<undefined, Error>> {
      const sent = await panelActions().sendSubmissionFeedback(
        actionContext,
        message.feedbackAnswerUrl,
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
 * The exercise panel `host` shows, if it is still panel `id`.
 *
 * The host acts on its own copy of the exercise rather than one the webview sends: the
 * exercise names files it reads and a backend it talks to.
 */
function shownExercisePanel(
  host: PanelHost,
  id: number,
): ExerciseTestsPanel | ExerciseSubmissionPanel | undefined {
  const route = host.route
  return (route?.type === "ExerciseTests" || route?.type === "ExerciseSubmission") &&
    route.id === id
    ? route
    : undefined
}

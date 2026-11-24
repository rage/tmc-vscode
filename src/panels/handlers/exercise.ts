import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type {
  ExerciseSubmissionPanel,
  RestoreOutcome,
  SubmissionHistoryEntry,
} from "../../../shared/lib"
import { LocalCourseData } from "../../../shared/lib"
import * as actions from "../../actions"
import { reportFailureIn, withOperation } from "../../api/withOperation"
import { Logger, PROSE_LOCALE } from "../../utilities"
import { restoreSubmission } from "../restoreSubmission"
import type { HandlerMap, PanelHost } from "../router"
import { screenFailureSink } from "../screenFailures"

const EXERCISE_ACTION_COMMANDS = {
  runTests: "tmc.testExercise",
  submit: "tmc.submitExercise",
  openNextExercise: "tmc.openNextExercise",
} as const

/** The submission screen's messages. */
export const exerciseHandlers = {
  pasteExercise: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<actions.PasteLink, Error>> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (!shown) {
        Logger.warn("Ignoring a paste from a panel that is no longer shown")
        return Err(new Error("This exercise is no longer shown."))
      }
      // Silent: the panel that asked shows the failure, remedies included.
      return withOperation(
        actionContext.dialog,
        { failure: "Failed to get a link to the exercise.", silent: true },
        () => actions.pasteExercise(actionContext, shown.exerciseId),
      )
    },
  },
  requestSubmissionHistory: {
    requiresReady: true,
    async handle(
      message,
      { host, actionContext },
    ): Promise<Result<SubmissionHistoryEntry[], Error>> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (!shown) {
        return Err(new Error("This exercise is no longer shown."))
      }
      const listed = await withOperation(
        actionContext.dialog,
        { failure: "Failed to fetch old submissions.", silent: true },
        () => actions.listOldSubmissions(actionContext, shown.exerciseId),
      )
      if (listed.err) {
        return listed
      }
      rememberListing(shown.id, listed.val)
      return Ok(actions.submissionHistory(listed.val, new Date(), PROSE_LOCALE))
    },
  },
  restoreSubmission: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<RestoreOutcome, Error>> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (!shown) {
        return Err(new Error("This exercise is no longer shown."))
      }
      const exercise = actionContext.startup.workspaceManager.getExercise(shown.exerciseId)
      if (!exercise) {
        return Err(new Error("This exercise is no longer downloaded. Open it to restore."))
      }
      // The webview names an entry of the host's own listing, never a submission of its choosing.
      const submission = listings
        .get(shown.id)
        ?.find((listed) => actions.oldSubmissionKey(listed) === message.key)
      if (!submission) {
        return Err(new Error("That submission is no longer listed. Refresh the history."))
      }
      return withOperation(
        actionContext.dialog,
        { failure: "Failed to restore the submission.", silent: true },
        () =>
          restoreSubmission(actionContext, exercise, submission, () =>
            host.post({
              type: "restoreConfirmed",
              target: { id: shown.id, type: shown.type },
              key: message.key,
            }),
          ),
      )
    },
  },
  cancelSubmission: {
    requiresReady: true,
    handle(message): void {
      actions.cancelSubmissionUpload(message.sourcePanel.id)
    },
  },
  keepWaitingForGrading: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      const shown = shownExercisePanel(host, message.sourcePanel.id)
      if (!shown) {
        return Err(new Error("This submission is no longer shown."))
      }
      const waited = await actions.keepWaitingForGrading(actionContext, message.sourcePanel.id)
      if (waited.err) {
        return waited
      }
      const shownIn = screenFailureSink(host, shown)
      for (const { headline, error } of waited.val.warnings) {
        reportFailureIn(actionContext.dialog, shownIn, headline, error)
      }
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
      if (!shown) {
        Logger.warn("Ignoring an exercise action from a panel that is no longer shown")
        return
      }
      const { dialog } = actionContext
      const shownIn = screenFailureSink(host, shown)
      if (message.action === "openExercise") {
        const stored = actionContext.startup.userData.getExercise(shown.exerciseId)
        if (stored.err) {
          reportFailureIn(dialog, shownIn, "This exercise is no longer in its course.")
          return
        }
        const courseId = LocalCourseData.getCourseId(stored.val.course)
        await withOperation(dialog, { failure: "Failed to open the exercise.", shownIn }, () =>
          actions.downloadAndOpenExercises(actionContext, [shown.exerciseId], courseId),
        )
        return
      }
      const exercise = actionContext.startup.workspaceManager.getExercise(shown.exerciseId)
      if (!exercise) {
        reportFailureIn(dialog, shownIn, "This exercise is no longer downloaded.")
        return
      }
      if (message.action === "logInToSubmit") {
        const isLoggedIn =
          actionContext.authState.loggedIn ||
          (await vscode.commands.executeCommand("tmc.showMoocLogin")) === "loggedIn"
        if (isLoggedIn) {
          await vscode.commands.executeCommand("tmc.submitExercise", exercise.uri)
        }
        return
      }
      if (message.action === "openNextExercise") {
        // The result is done with, and its split would take the next exercise's file.
        host.closeSidePanel()
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

/** The submissions each panel's History last listed, by panel id; the newest panels only. */
const listings = new Map<number, actions.OldSubmission[]>()

const LISTINGS_KEPT = 10

function rememberListing(panelId: number, submissions: actions.OldSubmission[]): void {
  listings.delete(panelId)
  listings.set(panelId, submissions)
  for (const oldest of listings.keys()) {
    if (listings.size <= LISTINGS_KEPT) {
      break
    }
    listings.delete(oldest)
  }
}

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

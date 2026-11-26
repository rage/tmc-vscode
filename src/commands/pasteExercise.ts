import { Ok } from "ts-results"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { runForExercise } from "./runForExercise"
import { showExerciseResults } from "./showExerciseResults"

/**
 * Opens Get Help in the exercise's results panel and sends the exercise there to its
 * backend, where the link can be copied or opened.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(
    actionContext,
    resource,
    "Pasting the exercise",
    async (exercise) => {
      await showExerciseResults(actionContext, exercise.uri, { name: "getHelp", shouldPaste: true })
      return Ok.EMPTY
    },
    {
      // Checked before the panel opens, so the share can be offered again once trusted.
      trustedCommand: "tmc.pasteExercise",
      retryOffer: (exercise) => ({
        message: `The course workspace is trusted now. Get a link to ${exercise.exerciseSlug} that your teacher or classmates can open?`,
        action: "Get a Link",
        expiredMessage:
          `That offer to send ${exercise.exerciseSlug} has expired, so nothing was sent. ` +
          "Use Get Help again to send your code as it is now.",
      }),
    },
  )
}

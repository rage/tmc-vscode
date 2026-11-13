import * as vscode from "vscode"

import { pasteServiceName } from "../../shared/lib"
import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { Logger, openWebLink } from "../utilities"
import { runForExercise } from "./runForExercise"

/** Shares the exercise via its backend's paste service and copies the link it gets. */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const pasteResult = await runForExercise(
    actionContext,
    resource,
    "Pasting the exercise",
    async (exercise) => {
      const result = await dialog.progressNotification(
        `Sending ${exercise.exerciseSlug} to ${pasteServiceName(exercise.backend)}…`,
        () => actions.pasteExercise(actionContext, exercise.id),
      )
      if (result.ok) {
        return result
      }
      return failure(
        `Failed to send the exercise to ${pasteServiceName(exercise.backend)}.`,
        result.val,
      )
    },
    {
      trustedCommand: "tmc.pasteExercise",
      retryOffer: (exercise) => ({
        message:
          `The course workspace is trusted now. Share ${exercise.exerciseSlug} via ` +
          `${pasteServiceName(exercise.backend)}?`,
        action: "Share",
        expiredMessage:
          `That offer to share ${exercise.exerciseSlug} has expired, so nothing was sent. ` +
          "Share it again to send your code as it is now.",
      }),
    },
  )
  if (pasteResult.err) {
    return
  }

  const { link, isReused } = pasteResult.val
  const isCopied = await Promise.resolve(vscode.env.clipboard.writeText(link)).then(
    () => true,
    (error: unknown) => {
      Logger.warn("Could not copy the paste link", error)
      return false
    },
  )
  const unchanged = isReused ? "Your code is unchanged since the last paste. " : ""
  void dialog.notification(
    isCopied
      ? `${unchanged}Copied ${isReused ? "its" : "the paste"} link to the clipboard: ${link}`
      : `${unchanged}${isReused ? "Its" : "Paste"} link: ${link}`,
    ["Open in Browser", (): void => void openWebLink(link)],
  )
}

import type { ActionContext } from "../actions/types"
import { Logger } from "../utilities"

/**
 * Asks whether to submit the exercise before an operation that throws its
 * current state away, and asks again when the answer is "discard".
 *
 * @param title Quick pick title, naming the command that is asking.
 * @param serverName Backend the exercise would be submitted to.
 * @returns Whether to submit first, or `undefined` when the user dismissed
 * either question — the caller must then do nothing at all.
 */
export async function confirmSubmitBeforeDestructiveAction(
  actionContext: ActionContext,
  title: string,
  serverName: string,
): Promise<boolean | undefined> {
  const { dialog } = actionContext
  const submitFirst = await dialog.selectItem<boolean>(
    {
      title,
      placeHolder: `Do you want to save the current state of the exercise by submitting it to ${serverName}?`,
    },
    ["Submit to server", true],
    ["Discard current state", false],
  )
  if (submitFirst === undefined) {
    Logger.debug("Answer for submitting first not provided, returning early.")
    return undefined
  }
  // Submitting first loses nothing, so only discarding is worth a second question.
  if (submitFirst) {
    return true
  }

  return dialog.selectItem<boolean>(
    { title, placeHolder: "Are you sure?" },
    ["No, save the current exercise state", true],
    ["Yes, discard current state", false],
  )
}

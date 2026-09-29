import type { ActionContext } from "../actions/types"

interface DestructiveActionPrompt {
  /** The question, naming the exercise, e.g. "Reset part01-01?". */
  message: string
  /** What replaces the current code, e.g. "the exercise template". */
  replacement: string
  /** The action's verb for the buttons, e.g. "Reset". */
  verb: string
  /** Backend the exercise would be submitted to. */
  serverName: string
}

/**
 * Asks, in one modal, whether to go ahead with an operation that throws the exercise's
 * current state away, and whether to submit that state first so a copy survives.
 *
 * @returns Whether to submit first, or `undefined` when the user cancelled — the caller
 * must then do nothing at all.
 */
export async function confirmSubmitBeforeDestructiveAction(
  actionContext: ActionContext,
  prompt: DestructiveActionPrompt,
): Promise<boolean | undefined> {
  const { message, replacement, verb, serverName } = prompt
  return actionContext.dialog.choose(
    message,
    {
      detail:
        `Your current code will be replaced by ${replacement}. ` +
        `Submit it to ${serverName} first to keep a copy you can download later.`,
    },
    [`Submit and ${verb}`, true],
    [`${verb} Without Submitting`, false],
  )
}

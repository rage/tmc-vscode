import type { BackendKind } from "../../shared/lib"
import { backendName } from "../../shared/lib"
import { isUnchangedSinceSubmission } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { WorkspaceExercise } from "../api/workspaceManager"

interface DestructiveActionPrompt {
  /** The question, naming the exercise, e.g. "Reset part01-01?". */
  message: string
  /** What replaces the current code, e.g. "the exercise template". */
  replacement: string
  /** The action's verb for the buttons, e.g. "Reset". */
  verb: string
  /** Backend the exercise's current state would be kept on. */
  backend: BackendKind
}

/**
 * Asks, in one modal, whether to go ahead with an operation that throws the exercise's
 * current state away, and whether to keep that state on the backend first so a copy survives:
 * as a submission on tmc, as an ungraded backup on courses.mooc.fi. A state this window has
 * already submitted unchanged is not offered for keeping again.
 *
 * @returns Whether to keep the state first, or `undefined` when the user cancelled — the caller
 * must then do nothing at all.
 */
export async function confirmSubmitBeforeDestructiveAction(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "uri">,
  prompt: DestructiveActionPrompt,
): Promise<boolean | undefined> {
  const { message, replacement, verb, backend } = prompt
  const serverName = backendName(backend)
  if (await isUnchangedSinceSubmission(actionContext, exercise)) {
    const confirmed = await actionContext.dialog.confirm(message, {
      confirmLabel: verb,
      detail: `Your current code, already submitted to ${serverName}, will be replaced by ${replacement}.`,
    })
    return confirmed ? false : undefined
  }
  if (backend === "mooc") {
    return actionContext.dialog.choose(
      message,
      {
        detail:
          `Your current code will be replaced by ${replacement}. ` +
          `Back it up to ${serverName} first to keep a copy you can download later. ` +
          "A backup is not graded.",
      },
      [`Back Up and ${verb}`, true],
      [`${verb} Without Backup`, false],
    )
  }
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

/** What keeping the current state on `backend` is called while it happens. */
export function keepingVerb(backend: BackendKind): string {
  return backend === "mooc" ? "Backing up" : "Submitting"
}

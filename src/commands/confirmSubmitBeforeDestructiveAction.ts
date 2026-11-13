import type { BackendKind } from "../../shared/lib"
import { backendName } from "../../shared/lib"
import { findKeptCopy } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { KeptCopy } from "../api/keptCopies"
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
 * as a submission on tmc, as an ungraded backup on courses.mooc.fi. A state that already has a
 * copy, on the backend or as the template, is not offered for keeping again.
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
  const kept = await findKeptCopy(actionContext, exercise)
  if (kept) {
    const confirmed = await actionContext.dialog.confirm(message, {
      confirmLabel: verb,
      detail: `Your current code, ${keptDescription(kept, serverName)}, will be replaced by ${replacement}.`,
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
          `A backup is not graded, and ${serverName} keeps your newest ${MOOC_BACKUPS_KEPT} backups of each exercise.`,
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

/** How many backups of one exercise courses.mooc.fi keeps per student before dropping the oldest. */
const MOOC_BACKUPS_KEPT = 20

function keptDescription(kept: KeptCopy, serverName: string): string {
  switch (kept) {
    case "submission":
      return `already submitted to ${serverName}`
    case "backup":
      return `already backed up to ${serverName}`
    case "restore":
      return `unchanged since you restored it from ${serverName}`
    case "reset":
      return "unchanged since the exercise was reset"
    case "download":
      return "unchanged since the exercise was downloaded"
  }
}

/** What keeping the current state on `backend` is called while it happens. */
export function keepingVerb(backend: BackendKind): string {
  return backend === "mooc" ? "Backing up" : "Submitting"
}

import { findAccountSwitch, moveExercisesAside } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { submissionViews } from "../ui/submissionViews"
import { Logger } from "../utilities"

/**
 * After a login, checks whether the exercises on disk belong to the account that logged in.
 * When another account's are there, closes that account's submissions and offers to move its
 * exercises aside; otherwise records the account as theirs.
 */
export async function handOverExercises(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { accountHandover, keptCopies, resources } = actionContext.startup
  const accountSwitch = await findAccountSwitch(actionContext)
  if (accountSwitch.err) {
    Logger.warn("Could not tell which account logged in", accountSwitch.val)
    return
  }
  const accountId = accountSwitch.val
  if (accountId === undefined) {
    return
  }
  submissionViews.clear()
  // The paste links and fingerprints are the other account's.
  await keptCopies.clear()
  const isMovedAside = await dialog.choose(
    "The exercises on this computer belong to another courses.mooc.fi account.",
    {
      detail:
        `Move them out of ${resources.projectsDirectory ?? "the exercises folder"} so you ` +
        "don't see or submit that student's work as your own. Nothing is deleted.",
    },
    ["Move Them Aside", true],
    ["Keep Them Here", false],
  )
  if (isMovedAside === undefined) {
    return
  }
  if (isMovedAside) {
    const moved = await withOperation(
      dialog,
      { failure: "Failed to move the exercises aside." },
      () => moveExercisesAside(actionContext),
    )
    if (moved.err) {
      return
    }
    void dialog.notification(`Moved the other account's exercises to ${moved.val}.`)
  }
  await accountHandover.setExercisesAccountId(accountId)
}

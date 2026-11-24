import * as fs from "fs"
import * as path from "path"

import * as vscode from "vscode"

import { bringBackMovedExercises, findAccountSwitch, moveExercisesAside } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { NotificationButton } from "../api/dialog"
import { withOperation } from "../api/withOperation"
import { submissionViews } from "../ui/submissionViews"
import { Logger } from "../utilities"

function openFolderButton(folder: string): NotificationButton {
  return [
    "Open Folder",
    (): void => void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(folder)),
  ]
}

/**
 * After a login, checks whether the exercises on disk belong to the account that logged in.
 * When only other accounts' are there, closes their submissions and offers to move their
 * exercises aside; otherwise records the account as theirs. Then brings back the account's own
 * exercises that an earlier login moved aside.
 */
export async function handOverExercises(actionContext: ReadyActionContext): Promise<void> {
  const accountSwitch = await findAccountSwitch(actionContext)
  if (accountSwitch.err) {
    Logger.warn("Could not tell which account logged in", accountSwitch.val)
    return
  }
  if (accountSwitch.val === undefined) {
    return
  }
  const { accountId, isSwitch } = accountSwitch.val
  checkedAccountId = accountId
  if (isSwitch && !(await offerToMoveAside(actionContext, accountId))) {
    return
  }
  await bringBackOwnExercises(actionContext, accountId)
}

/** The account {@link handOverExercises} last checked the exercises against in this window. */
let checkedAccountId: string | undefined

/**
 * Runs {@link handOverExercises} when `accountId` is not the account last checked, as when
 * another window logged in as someone else or courses.mooc.fi named the account only later.
 */
export async function handOverExercisesOnAccountChange(
  actionContext: ReadyActionContext,
  accountId: string,
): Promise<void> {
  if (accountId === checkedAccountId) {
    return
  }
  checkedAccountId = accountId
  await handOverExercises(actionContext)
}

/**
 * Asks whether to move another account's exercises aside, and records the outcome.
 *
 * @returns Whether the exercises folder is now `accountId`'s alone.
 */
async function offerToMoveAside(
  actionContext: ReadyActionContext,
  accountId: string,
): Promise<boolean> {
  const { dialog } = actionContext
  const { accountHandover, keptCopies, resources } = actionContext.startup
  submissionViews.clear()
  // The paste links and fingerprints are the other account's.
  await keptCopies.clear()
  const isMovedAside = await dialog.choose(
    "The exercises on this computer were downloaded by another MOOC.fi account.",
    {
      detail:
        `Move them out of ${resources.projectsDirectory ?? "the exercises folder"} so you ` +
        "don't see or submit that student's work as your own. They come back when that " +
        "account logs in here again, and nothing is deleted. Keep them only if they are your " +
        "own work.",
    },
    ["Move Them Aside", true],
    ["Keep Them Here", false],
  )
  if (isMovedAside === undefined) {
    return false
  }
  if (!isMovedAside) {
    await accountHandover.addExercisesAccountId(accountId)
    return false
  }
  const previousOwners = accountHandover.exercisesAccountIds
  const moved = await withOperation(
    dialog,
    { failure: "Failed to move the exercises aside." },
    () => moveExercisesAside(actionContext),
  )
  if (moved.err) {
    return false
  }
  await accountHandover.recordMovedAside({ folder: moved.val, accountIds: previousOwners })
  await accountHandover.setExercisesAccountIds([accountId])
  void dialog.notification(
    `Moved the other account's exercises to ${moved.val}. They come back when that account ` +
      "logs in here again.",
    openFolderButton(moved.val),
  )
  return true
}

/** Moves back the newest of `accountId`'s exercises that were moved aside, if any remain. */
async function bringBackOwnExercises(
  actionContext: ReadyActionContext,
  accountId: string,
): Promise<void> {
  const { dialog } = actionContext
  const { accountHandover } = actionContext.startup
  const own = accountHandover.movedAside.filter((moved) => moved.accountIds.includes(accountId))
  for (const { folder } of own) {
    // Forgotten only when gone from a reachable place, not when its drive is just missing.
    if (!(await pathExists(folder)) && (await pathExists(path.dirname(folder)))) {
      await accountHandover.forgetMovedAside(folder)
    }
  }
  const present = await Promise.all(
    own.map(async (moved) => (await pathExists(moved.folder)) && moved),
  )
  const newest = present.findLast((moved) => moved !== false)
  if (!newest) {
    return
  }
  const brought = await withOperation(
    dialog,
    { failure: "Failed to bring back your exercises." },
    () => bringBackMovedExercises(actionContext, newest.folder),
  )
  if (brought.err) {
    return
  }
  if (!brought.val) {
    void dialog.notification(
      `Your exercises from an earlier login are still in ${newest.folder}: the exercises ` +
        "folder already has other files in it.",
      openFolderButton(newest.folder),
    )
    return
  }
  await accountHandover.forgetMovedAside(newest.folder)
  await accountHandover.setExercisesAccountIds(newest.accountIds)
  void dialog.notification("Brought back your exercises that another login moved aside.")
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file)
    return true
  } catch {
    return false
  }
}

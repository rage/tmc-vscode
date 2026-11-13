import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { ReadyActionContext } from "./types"

/**
 * Compares the account logged in with the accounts the exercises on disk belong to.
 *
 * @returns The logged-in account, `isSwitch` when the exercises on disk are only other
 *   accounts'; otherwise having recorded the account as the exercises' owner when there were
 *   none. `undefined` when courses.mooc.fi could not name the account; errs when the CLI cannot
 *   be asked.
 */
export async function findAccountSwitch(
  actionContext: ReadyActionContext,
): Promise<Result<{ accountId: string; isSwitch: boolean } | undefined, Error>> {
  const { accountHandover, langs, workspaceManager } = actionContext.startup
  const account = await langs.getMoocAccountId()
  if (account.err || account.val === undefined) {
    return account.map(() => undefined)
  }
  const accountId = account.val
  const owners = accountHandover.exercisesAccountIds
  if (owners.includes(accountId)) {
    return Ok({ accountId, isSwitch: false })
  }
  if (owners.length > 0 && workspaceManager.getExercises().length > 0) {
    return Ok({ accountId, isSwitch: true })
  }
  await accountHandover.setExercisesAccountIds([accountId])
  return Ok({ accountId, isSwitch: false })
}

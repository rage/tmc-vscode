import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { ReadyActionContext } from "./types"

/**
 * Compares the account logged in with the one the exercises on disk belong to.
 *
 * @returns The logged-in account's id when it is another account's exercises on disk;
 *   `undefined` otherwise, having recorded the account as the exercises' owner when it can be
 *   told. Errs when the CLI cannot be asked.
 */
export async function findAccountSwitch(
  actionContext: ReadyActionContext,
): Promise<Result<string | undefined, Error>> {
  const { accountHandover, langs, workspaceManager } = actionContext.startup
  const account = await langs.getMoocAccountId()
  if (account.err || account.val === undefined) {
    return account.map(() => undefined)
  }
  const accountId = account.val
  const previous = accountHandover.exercisesAccountId
  if (
    previous !== undefined &&
    previous !== accountId &&
    workspaceManager.getExercises().length > 0
  ) {
    return Ok(accountId)
  }
  await accountHandover.setExercisesAccountId(accountId)
  return Ok(undefined)
}

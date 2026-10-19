import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { WorkspaceUntrustedError } from "../errors"
import type { ReadyActionContext } from "./types"

/**
 * `Err(WorkspaceUntrustedError)` while the window is in Restricted Mode, where nothing may run,
 * submit or share exercise code. Retries nothing once trusted: that is for the command the user
 * ran to arrange, through `WorkspaceTrustGate.refusal`.
 */
export function checkWorkspaceTrust(
  actionContext: ReadyActionContext,
): Result<void, WorkspaceUntrustedError> {
  const refused = actionContext.startup.trustGate.refusal()
  return refused ? Err(refused) : Ok.EMPTY
}

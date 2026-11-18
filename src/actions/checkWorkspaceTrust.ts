import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { WorkspaceUntrustedError } from "../errors"
import type { ReadyActionContext } from "./types"

/**
 * `Err(WorkspaceUntrustedError)` while the window is in Restricted Mode, where nothing may run,
 * submit or share exercise code. Does not retry once trusted; see `WorkspaceTrustGate.refusal`.
 */
export function checkWorkspaceTrust(
  actionContext: ReadyActionContext,
): Result<void, WorkspaceUntrustedError> {
  const refused = actionContext.startup.trustGate.refusal()
  return refused ? Err(refused) : Ok.EMPTY
}

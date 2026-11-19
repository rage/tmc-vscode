import type { Result } from "ts-results"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { checkWorkspaceTrust } from "./checkWorkspaceTrust"
import type { ReadyActionContext } from "./types"

/**
 * Removes language-specific meta files from an exercise's directory. Errs with
 * `WorkspaceUntrustedError` in Restricted Mode: cleaning runs the exercise's build tool.
 */
export async function cleanExercise(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const trusted = checkWorkspaceTrust(actionContext)
  if (trusted.err) {
    return trusted
  }
  const { langs } = actionContext.startup
  return langs.clean(exercise.uri.fsPath)
}

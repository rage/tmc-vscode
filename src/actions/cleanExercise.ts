import type { Result } from "ts-results"

import type { WorkspaceExercise } from "../api/workspaceManager"
import type { ReadyActionContext } from "./types"

/** Removes language-specific meta files from an exercise's directory. */
export async function cleanExercise(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const { langs } = actionContext.startup
  return langs.clean(exercise.uri.fsPath)
}

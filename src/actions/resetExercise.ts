import type { Result } from "ts-results"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type { ExerciseIdentifier } from "../shared/shared"
import { runSingleFlight } from "../utilities"
import type { ReadyActionContext } from "./types"

/**
 * Resets an exercise to its initial state on disk, optionally submitting it first.
 *
 * Rejects as a `BottleneckError` while a submit, paste, reset or restore of the same
 * exercise is already in flight — all of them share one key because each overwrites or
 * reads the directory the others act on.
 */
export async function resetExercise(
  actionContext: ReadyActionContext,
  id: ExerciseIdentifier,
  exercise: WorkspaceExercise,
  submitFirst: boolean,
): Promise<Result<void, Error>> {
  const { langs } = actionContext.startup
  return runSingleFlight(
    {
      key: `submit:${exercise.uri.fsPath}`,
      maxHoldMs: CLI_PROCESS_TIMEOUT + 30_000,
      busyMessage: "A submission for this exercise is already in progress.",
    },
    () => langs.resetExercise(id, exercise.uri.fsPath, submitFirst),
  )
}

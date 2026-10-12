import type { Result } from "ts-results"

import type { WorkspaceExercise } from "../api/workspaceManager"
import type { ExerciseIdentifier } from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import type { ReadyActionContext } from "./types"

/**
 * Resets an exercise to its initial state on disk, optionally submitting it first.
 *
 * Rejects as a `BottleneckError` while another operation on the exercise is in flight.
 */
export async function resetExercise(
  actionContext: ReadyActionContext,
  id: ExerciseIdentifier,
  exercise: WorkspaceExercise,
  submitFirst: boolean,
): Promise<Result<void, Error>> {
  const { langs } = actionContext.startup
  return exerciseOperations.run(id, "resetting", () =>
    langs.resetExercise(id, exercise.uri.fsPath, submitFirst),
  )
}

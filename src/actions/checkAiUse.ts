import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { WorkspaceExercise } from "../api/workspaceManager"
import type { ReadyActionContext } from "./types"

/**
 * `Err(AiUseRefusedError)` while `exercise` may not be submitted, tested or pasted because AI
 * assistance may be on; see `AiUseGate.refusal`. Also errs when its course is not stored.
 */
export async function checkAiUse(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "backend" | "courseSlug" | "uri">,
): Promise<Result<void, Error>> {
  const { aiUseGate, userData } = actionContext.startup
  const course = userData.getCourseBySlug(exercise.backend, exercise.courseSlug)
  if (course.err) {
    return course
  }
  const refused = await aiUseGate.refusal(course.val, exercise.uri)
  return refused ? Err(refused) : Ok.EMPTY
}

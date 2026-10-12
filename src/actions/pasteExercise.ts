import type { Result } from "ts-results"
import { Err } from "ts-results"

import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type { BackendKind } from "../shared/shared"
import { LocalCourseExercise } from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import { checkAiUse } from "./checkAiUse"
import type { ReadyActionContext } from "./types"

/**
 * Sends an exercise to a backend's paste service and answers with the link to it.
 *
 * Nothing is reported here: the caller shows the failure, once, in the place the user
 * asked from. A paste that comes back without a link is an error rather than an empty
 * `Ok`, so no caller has to check for one. Errs with `AiUseRefusedError` while AI assistance
 * may be on.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  backend: BackendKind,
  courseSlug: string,
  exerciseName: string,
): Promise<Result<string, Error>> {
  const { langs, userData, workspaceManager } = actionContext.startup

  const stored = userData.getExerciseByName(backend, courseSlug, exerciseName)
  const exercise = workspaceManager.getExerciseBySlug(backend, courseSlug, exerciseName)
  if (!stored || !exercise) {
    return Err(new Error("Failed to resolve exercise id"))
  }
  const exerciseId = LocalCourseExercise.getId(stored)
  // Refused like a submit, which a mooc paste also is.
  const allowed = await checkAiUse(actionContext, { backend, courseSlug, uri: exercise.uri })
  if (allowed.err) {
    return allowed
  }
  const exercisePath = exercise.uri.fsPath

  return exerciseOperations.run(exerciseId, "pasting", CLI_PROCESS_TIMEOUT + 30_000, async () => {
    const pasteResult = await langs.paste(exerciseId, exercisePath)
    if (pasteResult.err) {
      return pasteResult
    }
    if (pasteResult.val === "") {
      return new Err(new Error("The server did not answer with a paste link."))
    }
    return pasteResult
  })
}

import type { Result } from "ts-results"
import { Err } from "ts-results"

import type Langs from "../api/langs"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type { UserData } from "../config/userdata"
import type { BackendKind } from "../shared/shared"
import { ExerciseIdentifier } from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import { checkAiUse } from "./checkAiUse"
import type { ReadyActionContext } from "./types"

/** Sends the exercise directory `exercisePath` to one backend's paste service. */
type ExercisePaster = (exercisePath: string) => Promise<Result<string, Error>>

/**
 * Builds the paste call for `backend`, with the exercise it pastes, or `undefined` when that
 * backend has no exercise by this name.
 */
function pasterFor(
  langs: Langs,
  userData: UserData,
  backend: BackendKind,
  courseSlug: string,
  exerciseName: string,
): { exerciseId: ExerciseIdentifier; paste: ExercisePaster } | undefined {
  if (backend === "tmc") {
    const exerciseId = userData.getTmcExerciseByName(courseSlug, exerciseName)?.id
    return exerciseId
      ? {
          exerciseId: ExerciseIdentifier.from(exerciseId),
          paste: (exercisePath) => langs.submitTmcExerciseToPaste(exerciseId, exercisePath),
        }
      : undefined
  }
  const exerciseId = userData.getMoocExerciseByName(courseSlug, exerciseName)?.id
  return exerciseId
    ? {
        exerciseId: ExerciseIdentifier.from(exerciseId),
        paste: (exercisePath) => langs.submitMoocExerciseToPaste(exerciseId, exercisePath),
      }
    : undefined
}

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

  const paster = pasterFor(langs, userData, backend, courseSlug, exerciseName)
  const exercise = workspaceManager.getExerciseBySlug(backend, courseSlug, exerciseName)
  if (!paster || !exercise) {
    return Err(new Error("Failed to resolve exercise id"))
  }
  // Refused like a submit, which a mooc paste also is.
  const allowed = await checkAiUse(actionContext, { backend, courseSlug, uri: exercise.uri })
  if (allowed.err) {
    return allowed
  }
  const exercisePath = exercise.uri.fsPath

  return exerciseOperations.run(
    paster.exerciseId,
    "pasting",
    CLI_PROCESS_TIMEOUT + 30_000,
    async () => {
      const pasteResult = await paster.paste(exercisePath)
      if (pasteResult.err) {
        return pasteResult
      }
      if (pasteResult.val === "") {
        return new Err(new Error("The server did not answer with a paste link."))
      }
      return pasteResult
    },
  )
}

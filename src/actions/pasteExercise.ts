import type { Result } from "ts-results"
import { Err } from "ts-results"

import type Langs from "../api/langs"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type { UserData } from "../config/userdata"
import type { BackendKind } from "../shared/shared"
import { runSingleFlight } from "../utilities"
import type { ReadyActionContext } from "./types"

/** Sends the exercise directory `exercisePath` to one backend's paste service. */
type ExercisePaster = (exercisePath: string) => Promise<Result<string, Error>>

/**
 * Builds the paste call for `backend`, or `undefined` when that backend has no exercise
 * by this name.
 */
function pasterFor(
  langs: Langs,
  userData: UserData,
  backend: BackendKind,
  courseSlug: string,
  exerciseName: string,
): ExercisePaster | undefined {
  if (backend === "tmc") {
    const exerciseId = userData.getTmcExerciseByName(courseSlug, exerciseName)?.id
    return exerciseId
      ? (exercisePath): Promise<Result<string, Error>> =>
          langs.submitTmcExerciseToPaste(exerciseId, exercisePath)
      : undefined
  }
  const exerciseId = userData.getMoocExerciseByName(courseSlug, exerciseName)?.id
  return exerciseId
    ? (exercisePath): Promise<Result<string, Error>> =>
        langs.submitMoocExerciseToPaste(exerciseId, exercisePath)
    : undefined
}

/**
 * Sends an exercise to a backend's paste service and answers with the link to it.
 *
 * Nothing is reported here: the caller shows the failure, once, in the place the user
 * asked from. A paste that comes back without a link is an error rather than an empty
 * `Ok`, so no caller has to check for one.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  backend: BackendKind,
  courseSlug: string,
  exerciseName: string,
): Promise<Result<string, Error>> {
  const { dialog } = actionContext
  const { langs, userData, workspaceManager } = actionContext.startup

  const paste = pasterFor(langs, userData, backend, courseSlug, exerciseName)
  const exercisePath = workspaceManager.getExerciseBySlug(backend, courseSlug, exerciseName)?.uri
    .fsPath
  if (!paste || !exercisePath) {
    return Err(new Error("Failed to resolve exercise id"))
  }

  // key shared with the submit actions, which must not overlap a paste of the same exercise
  return runSingleFlight(
    {
      key: `submit:${exercisePath}`,
      maxHoldMs: CLI_PROCESS_TIMEOUT + 30_000,
      busyMessage: "A submission for this exercise is already in progress.",
      onBusy: (message) => dialog.notification(message),
    },
    async () => {
      const pasteResult = await paste(exercisePath)
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

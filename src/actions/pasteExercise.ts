import type { Result } from "ts-results"
import { Err } from "ts-results"

import type { ExerciseIdentifier } from "../../shared/lib"
import { exerciseOperations } from "../ui/exerciseOperations"
import { saveExerciseDocuments } from "../window/exerciseDocuments"
import { checkAiUse } from "./checkAiUse"
import { checkWorkspaceTrust } from "./checkWorkspaceTrust"
import type { ReadyActionContext } from "./types"

/**
 * Sends an exercise to a backend's paste service and answers with the link to it.
 *
 * Nothing is reported here: the caller shows the failure, once, in the place the user
 * asked from. A paste that comes back without a link is an error rather than an empty
 * `Ok`, so no caller has to check for one. Errs with `AiUseRefusedError` while AI assistance
 * may be on, and with `WorkspaceUntrustedError` in Restricted Mode.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  exerciseId: ExerciseIdentifier,
): Promise<Result<string, Error>> {
  const { langs, workspaceManager } = actionContext.startup

  const exercise = workspaceManager.getExercise(exerciseId)
  if (!exercise) {
    return Err(new Error("The exercise is not downloaded."))
  }
  const trusted = checkWorkspaceTrust(actionContext)
  if (trusted.err) {
    return trusted
  }
  // Refused like a submit, which a mooc paste also is.
  const allowed = await checkAiUse(actionContext, exercise)
  if (allowed.err) {
    return allowed
  }

  return exerciseOperations.run(exerciseId, "pasting", async () => {
    const saved = await saveExerciseDocuments(exercise)
    if (saved.err) {
      return saved
    }
    const pasteResult = await langs.paste(exerciseId, exercise.uri.fsPath)
    if (pasteResult.err) {
      return pasteResult
    }
    if (pasteResult.val === "") {
      return new Err(new Error("The server did not answer with a paste link."))
    }
    return pasteResult
  })
}

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { ExerciseIdentifier } from "../../shared/lib"
import { exerciseOperations } from "../ui/exerciseOperations"
import { saveExerciseDocuments } from "../window/exerciseDocuments"
import { checkAiUse } from "./checkAiUse"
import { checkWorkspaceTrust } from "./checkWorkspaceTrust"
import { fingerprintStudentFiles } from "./keptCopies"
import type { ReadyActionContext } from "./types"

/** A paste link, and whether it is an earlier paste's, reused because the code is unchanged. */
export interface PasteLink {
  link: string
  isReused: boolean
}

/**
 * Sends an exercise to a backend's paste service and answers with the link to it, or with the
 * last paste's link when the student files are what that paste sent.
 *
 * Nothing is reported here: the caller shows the failure, once, in the place the user
 * asked from. A paste that comes back without a link is an error rather than an empty
 * `Ok`, so no caller has to check for one. Errs with `AiUseRefusedError` while AI assistance
 * may be on, and with `WorkspaceUntrustedError` in Restricted Mode.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  exerciseId: ExerciseIdentifier,
): Promise<Result<PasteLink, Error>> {
  const { keptCopies, langs, workspaceManager } = actionContext.startup

  const exercise = workspaceManager.getExercise(exerciseId)
  if (!exercise) {
    return Err(new Error("The exercise is not downloaded."))
  }
  const trusted = checkWorkspaceTrust(actionContext)
  if (trusted.err) {
    return trusted
  }
  const allowed = await checkAiUse(actionContext, exercise)
  if (allowed.err) {
    return allowed
  }

  return exerciseOperations.run(
    exerciseId,
    "pasting",
    async (): Promise<Result<PasteLink, Error>> => {
      const saved = await saveExerciseDocuments(exercise)
      if (saved.err) {
        return saved
      }
      const fingerprint = await fingerprintStudentFiles(actionContext, exercise)
      const earlierLink = keptCopies.pasteLink(exerciseId, fingerprint)
      if (earlierLink !== undefined) {
        return Ok({ link: earlierLink, isReused: true })
      }
      const pasteResult = await langs.paste(exerciseId, exercise.uri.fsPath)
      if (pasteResult.err) {
        return pasteResult
      }
      const link = pasteResult.val
      if (link === "") {
        return new Err(new Error("The server did not answer with a paste link."))
      }
      if (fingerprint !== undefined) {
        await keptCopies.recordPaste(exerciseId, { fingerprint, link })
      }
      return Ok({ link, isReused: false })
    },
  )
}

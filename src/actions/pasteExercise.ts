import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { ExerciseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import { CourseAccessLostError } from "../errors"
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
 * Sends an exercise to its backend's paste service and returns the link, or the last paste's
 * link when the student files are unchanged since it.
 *
 * Reports nothing: the caller shows the failure where the user asked from. A paste without a
 * link is an `Err`, never an empty `Ok`. Errs with `AiUseRefusedError` while AI assistance may
 * be on, `WorkspaceUntrustedError` in Restricted Mode, and `CourseAccessLostError` while the
 * backend refuses the course.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  exerciseId: ExerciseIdentifier,
): Promise<Result<PasteLink, Error>> {
  const { keptCopies, langs, userData, workspaceManager } = actionContext.startup

  const exercise = workspaceManager.getExercise(exerciseId)
  if (!exercise) {
    return Err(new Error("The exercise is not downloaded."))
  }
  const course = userData.getCourse(exercise.courseId)
  switch (course.ok ? LocalCourseData.getAccessLoss(course.val) : undefined) {
    case "forbidden":
      return Err(
        new CourseAccessLostError(
          `You no longer have access to this course, so ${exercise.exerciseSlug} cannot be sent for help.`,
        ),
      )
    case "notFound":
      return Err(
        new CourseAccessLostError(
          `This course no longer exists, so ${exercise.exerciseSlug} cannot be sent for help.`,
        ),
      )
  }
  if (course.ok && LocalCourseData.isMoocExam(course.val)) {
    return Err(new Error("Get Help is not available in an exam."))
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

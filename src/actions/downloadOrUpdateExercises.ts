import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { ExerciseDownloadProgress, ExerciseDownloads } from "../api/langs"
import type { OperationWarning, Warned } from "../api/withOperation"
import { ExerciseUpdateError, presentationFor } from "../errors"
import type { BackendKind, CourseIdentifier } from "../shared/shared"
import {
  backendName,
  ExerciseIdentifier,
  LocalCourseExercise,
  match,
  partition,
} from "../shared/shared"
import { downloadFailures } from "../ui/downloadFailures"
import type { ExerciseClaim } from "../ui/exerciseOperations"
import { exerciseOperations } from "../ui/exerciseOperations"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

/** What one backend's download came back with. */
interface DownloadLeg {
  backend: BackendKind
  result: Result<ExerciseDownloads, Error>
}

interface DownloadResults {
  successful: ExerciseIdentifier[]
  failed: ExerciseIdentifier[]
}

/**
 * Downloads given exercises and opens them in the course workspace.
 *
 * Fails as a whole only with a `BottleneckError`, downloading nothing, while any of the
 * exercises is busy with another operation. Every other failure lands in `failed`, with one
 * warning naming the exercises; a cancelled download returns what had completed.
 *
 * @param exerciseIds Exercises to download.
 * @param courseId Course the exercises belong to, when they all share one. Passed
 *   to the mooc bulk download so it can fetch just that course's slides instead of
 *   scanning every enrolled course. Omit when the exercises span multiple courses.
 */
export async function downloadOrUpdateExercises(
  actionContext: ReadyActionContext,
  exerciseIds: ExerciseIdentifier[],
  courseId?: CourseIdentifier,
): Promise<Result<DownloadResults & Warned, Error>> {
  Logger.info("Downloading exercises", exerciseIds)
  if (exerciseIds.length === 0) {
    return Ok({ successful: [], failed: [], warnings: [] })
  }
  const claim = exerciseOperations.claim(exerciseIds, "downloading")
  if (claim.err) {
    return claim
  }
  try {
    return Ok(await download(actionContext, exerciseIds, courseId, claim.val))
  } finally {
    claim.val.releaseAll()
  }
}

async function download(
  actionContext: ReadyActionContext,
  exerciseIds: ExerciseIdentifier[],
  courseId: CourseIdentifier | undefined,
  claim: ExerciseClaim,
): Promise<DownloadResults & Warned> {
  const { dialog, settings } = actionContext
  const { langs } = actionContext.startup

  const succeeded = new Set<string>()
  const downloadTemplate = !settings.getDownloadOldSubmission()
  const byBackend = partition(exerciseIds)
  const tmcIds = byBackend.tmc.map((id) => id.tmcExerciseId)
  const moocIds = byBackend.mooc.map((id) => id.moocExerciseId)
  const moocCourseId =
    courseId &&
    match(
      courseId,
      () => undefined,
      (mooc) => mooc.moocCourseId,
    )

  let cancelled = false
  const legs = await dialog.progressNotification(
    "Downloading exercises…",
    async (progress, token) => {
      // Cancelling kills the CLI download process; already-written exercises stay downloaded.
      let interruptDownload: (() => void) | undefined
      token.onCancellationRequested(() => {
        cancelled = true
        interruptDownload?.()
      })
      // A leg that was still starting up when the user cancelled gets killed as
      // soon as the CLI hands back its handle.
      const registerInterrupt = (interrupt: () => void): void => {
        if (cancelled) {
          interrupt()
          return
        }
        interruptDownload = interrupt
      }

      // Each backend reports its own completion fraction, so counting finished
      // exercises is the only measure that keeps rising across both.
      const onDownloaded = (downloaded: ExerciseDownloadProgress): void => {
        succeeded.add(ExerciseIdentifier.key(downloaded.id))
        progress.report({
          fraction: succeeded.size / exerciseIds.length,
          message: downloaded.message,
        })
        downloadFailures.record([], [downloaded.id])
        claim.release(downloaded.id)
      }

      // One backend after the other, so a cancel stops the second before it starts.
      const finished: DownloadLeg[] = []
      const runLeg = async (
        backend: BackendKind,
        count: number,
        run: () => Promise<Result<ExerciseDownloads, Error>>,
      ): Promise<void> => {
        if (count > 0 && !cancelled) {
          finished.push({ backend, result: await run() })
          interruptDownload = undefined
        }
      }
      await runLeg("tmc", tmcIds.length, () =>
        langs.downloadTmcExercises(tmcIds, downloadTemplate, onDownloaded, registerInterrupt),
      )
      await runLeg("mooc", moocIds.length, () =>
        langs.downloadMoocExercises(moocIds, moocCourseId, onDownloaded, registerInterrupt),
      )
      return finished
    },
    { cancellable: true },
  )
  const failedLegs: Error[] = []
  const exerciseReasons: string[][] = []
  for (const { backend, result } of legs) {
    if (result.err) {
      if (!cancelled) {
        Logger.error(`Failed to download exercises from ${backendName(backend)}`, result.val)
      }
      failedLegs.push(result.val)
      continue
    }
    const { downloaded, skipped, failed } = result.val
    if (skipped.length > 0) {
      Logger.warn(`${skipped.length} downloads were skipped.`)
    }
    for (const { id } of [...downloaded, ...skipped]) {
      succeeded.add(ExerciseIdentifier.key(id))
    }
    for (const [{ id }, reasons] of failed) {
      Logger.error(`Failed to download exercise ${exerciseName(actionContext, id)}: ${reasons}`)
      succeeded.delete(ExerciseIdentifier.key(id))
      exerciseReasons.push(reasons)
    }
  }

  const results = sortResults(exerciseIds, succeeded)
  downloadFailures.record(results.failed, results.successful)
  if (cancelled) {
    // The user chose to stop; what completed is the answer, not an error.
    Logger.info("Exercise download cancelled by the user")
    return { ...results, warnings: [] }
  }
  const warnings: OperationWarning[] = []
  if (results.failed.length > 0) {
    const names = results.failed.map((id) => exerciseName(actionContext, id))
    warnings.push({
      headline: `Failed to download ${describeExercises(names)}.`,
      error: failureCause(failedLegs, exerciseReasons),
    })
  }
  return { ...results, warnings }
}

/**
 * The one error a failed download is reported with.
 *
 * A backend that failed as a whole is the cause worth naming, preferring one whose
 * presentation carries a remedy (e.g. "Log in"); otherwise the per-exercise reasons.
 */
function failureCause(failedLegs: Error[], exerciseReasons: string[][]): Error {
  const leg = failedLegs.find((error) => presentationFor(error).actions.length > 0) ?? failedLegs[0]
  if (leg) {
    return leg
  }
  const reasons = [...new Set(exerciseReasons.flat().filter((reason) => reason !== ""))]
  return new ExerciseUpdateError(
    reasons.length > 0 ? reasons.join("; ") : "tmc-langs did not report them as downloaded",
  )
}

/** The name the student knows `exerciseId` by, or its id if no stored course has it. */
function exerciseName(actionContext: ReadyActionContext, exerciseId: ExerciseIdentifier): string {
  const stored = actionContext.startup.userData.getExercise(exerciseId)
  return stored.ok
    ? LocalCourseExercise.getSlug(stored.val.exercise)
    : ExerciseIdentifier.toString(exerciseId)
}

const LISTED_EXERCISE_LIMIT = 5

function describeExercises(names: string[]): string {
  const listed = names.slice(0, LISTED_EXERCISE_LIMIT).join(", ")
  const rest = names.length - LISTED_EXERCISE_LIMIT
  if (names.length === 1) {
    return `the exercise ${listed}`
  }
  return `${names.length} exercises: ${listed}${rest > 0 ? ` and ${rest} more` : ""}`
}

function sortResults(exerciseIds: ExerciseIdentifier[], succeeded: Set<string>): DownloadResults {
  const successful: ExerciseIdentifier[] = []
  const failed: ExerciseIdentifier[] = []
  for (const id of exerciseIds) {
    if (succeeded.has(ExerciseIdentifier.key(id))) {
      successful.push(id)
    } else {
      failed.push(id)
    }
  }
  return { successful, failed }
}

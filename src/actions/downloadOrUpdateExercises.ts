import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { BackendKind, CourseIdentifier } from "../../shared/lib"
import { backendName, ExerciseIdentifier, makeMoocKind, match, partition } from "../../shared/lib"
import type Langs from "../api/langs"
import type { ExerciseDownload, ExerciseDownloadProgress, ExerciseDownloads } from "../api/langs"
import type { OperationWarning, Warned } from "../api/withOperation"
import { ExerciseUpdateError, presentationFor } from "../errors"
import { downloadFailures } from "../ui/downloadFailures"
import type { ExerciseClaim } from "../ui/exerciseOperations"
import { exerciseOperations } from "../ui/exerciseOperations"
import { Logger } from "../utilities"
import { describeExercises, exerciseName } from "./exerciseNames"
import type { ReadyActionContext } from "./types"

/** What one backend's download came back with. */
interface DownloadLeg {
  backend: BackendKind
  result: Result<ExerciseDownloads, Error>
}

interface DownloadOptions {
  isUpdate?: boolean
  isUnrequested?: boolean
}

interface DownloadResults {
  successful: ExerciseIdentifier[]
  failed: ExerciseIdentifier[]
  /** Why the `failed` exercises failed; `undefined` when none did or the user cancelled. */
  failureCause?: Error | undefined
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
 * @param options `isUpdate` for exercises already on disk, which the warning then says were
 *   not updated; `isUnrequested` for a download the user did not ask for, such as an
 *   automatic update, whose progress shows in the status bar, not in a cancellable
 *   notification, and whose failed exercises get no warning: the caller reports
 *   `failureCause` where it can be withdrawn once the cause is gone.
 */
export async function downloadOrUpdateExercises(
  actionContext: ReadyActionContext,
  exerciseIds: ExerciseIdentifier[],
  courseId?: CourseIdentifier,
  options: DownloadOptions = {},
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
    return Ok(await download(actionContext, exerciseIds, courseId, claim.val, options))
  } finally {
    claim.val.releaseAll()
  }
}

async function download(
  actionContext: ReadyActionContext,
  exerciseIds: ExerciseIdentifier[],
  courseId: CourseIdentifier | undefined,
  claim: ExerciseClaim,
  options: DownloadOptions,
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
  const unrestored: ExerciseIdentifier[] = []
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
      await runLeg("mooc", moocIds.length, async () => {
        const alreadyLocal = downloadTemplate ? undefined : await localMoocExerciseIds(langs)
        const downloads = await langs.downloadMoocExercises(
          moocIds,
          moocCourseId,
          onDownloaded,
          registerInterrupt,
        )
        if (alreadyLocal && downloads.ok && !cancelled) {
          const fresh = downloads.val.downloaded.filter(
            ({ id }) => !alreadyLocal.has(ExerciseIdentifier.toString(id)),
          )
          unrestored.push(...(await restoreLatestSubmissions(langs, fresh)))
        }
        return downloads
      })
      return finished
    },
    options.isUnrequested
      ? { location: vscode.ProgressLocation.Window }
      : { cancellable: true, location: vscode.ProgressLocation.Notification },
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
  if (unrestored.length > 0) {
    const names = unrestored.map((id) => exerciseName(actionContext, id))
    warnings.push({
      headline: `Downloaded the template of ${describeExercises(names)}: the latest submission could not be restored. Use Download Old Submission to get it.`,
      error: new ExerciseUpdateError("restoring the latest submission failed"),
    })
  }
  if (results.failed.length === 0) {
    return { ...results, warnings }
  }
  const cause = failureCause(failedLegs, exerciseReasons)
  if (!options.isUnrequested) {
    const names = results.failed.map((id) => exerciseName(actionContext, id))
    warnings.push({
      headline: `Failed to ${options.isUpdate ? "update" : "download"} ${describeExercises(names)}.`,
      error: cause,
    })
  }
  return { ...results, failureCause: cause, warnings }
}

/**
 * The mooc exercises already in the projects directory, by id, or `undefined` when they cannot
 * be listed: a download then must not put a submission over what may be the student's work.
 */
async function localMoocExerciseIds(langs: Langs): Promise<Set<string> | undefined> {
  const local = await langs.listLocalExercises()
  if (local.err) {
    Logger.error("Could not list local exercises; downloading templates only", local.val)
    return undefined
  }
  return new Set(
    local.val.flatMap((exercise) => (exercise.backend === "mooc" ? [exercise["exercise-id"]] : [])),
  )
}

/**
 * Puts each newly downloaded mooc exercise's latest submission over its template, as the tmc
 * download does itself for `testMyCode.downloadOldSubmission`.
 *
 * @returns The exercises left at their template because the restore failed.
 */
async function restoreLatestSubmissions(
  langs: Langs,
  downloads: ExerciseDownload[],
): Promise<ExerciseIdentifier[]> {
  const unrestored: ExerciseIdentifier[] = []
  for (const { id, path } of downloads) {
    const listed = await langs.getOldSubmissions(id)
    if (listed.err) {
      Logger.error(
        `Could not list the submissions of ${ExerciseIdentifier.toString(id)}`,
        listed.val,
      )
      unrestored.push(id)
      continue
    }
    // `get-exercise-submissions` lists newest first.
    const latest = match(
      listed.val,
      () => undefined,
      ({ exerciseId, submissions }) =>
        submissions[0] && makeMoocKind({ exerciseId, submissionId: submissions[0].id }),
    )
    if (!latest) {
      continue
    }
    const restored = await langs.restoreSubmission(latest, path, false)
    if (restored.err) {
      Logger.error(
        `Could not restore the latest submission of ${ExerciseIdentifier.toString(id)}`,
        restored.val,
      )
      unrestored.push(id)
    }
  }
  return unrestored
}

/** tmc-langs' reasons for an exercise whose package on the server cannot be unpacked. */
const BROKEN_PACKAGE_REASON = /archive|\bzip\b|project directory/i

/**
 * The one error a failed download is reported with.
 *
 * A backend that failed as a whole is the cause worth naming, preferring one whose
 * presentation carries a remedy (e.g. "Log In"); otherwise the per-exercise reasons, in plain
 * words, with tmc-langs' own as the details the log gets.
 */
function failureCause(failedLegs: Error[], exerciseReasons: string[][]): Error {
  const leg = failedLegs.find((error) => presentationFor(error).actions.length > 0) ?? failedLegs[0]
  if (leg) {
    return leg
  }
  const reasons = [...new Set(exerciseReasons.flat().filter((reason) => reason !== ""))]
  const details =
    reasons.length > 0 ? reasons.join("; ") : "tmc-langs did not report them as downloaded"
  if (reasons.length > 0 && reasons.every((reason) => BROKEN_PACKAGE_REASON.test(reason))) {
    return new ExerciseUpdateError(
      "The exercise on the server is not a valid exercise package; the course staff need to fix it.",
      details,
    )
  }
  return new ExerciseUpdateError("Show Logs has the details.", details)
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

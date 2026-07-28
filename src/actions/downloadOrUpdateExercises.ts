import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { ExerciseUpdateError, InitializationError } from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier, ExtensionToWebview } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, match } from "../shared/shared"
import type { ExerciseStatus } from "../ui/types"
import { Logger } from "../utilities"
import type { ActionContext } from "./types"

interface DownloadResults {
  successful: ExerciseIdentifier[]
  failed: ExerciseIdentifier[]
}

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param exerciseIds Exercises to download.
 * @param courseId Course the exercises belong to, when they all share one. Passed
 *   to the mooc bulk download so it can fetch just that course's slides instead of
 *   scanning every enrolled course. Omit when the exercises span multiple courses
 *   (e.g. the aggregate update flow).
 * @returns Exercise ids for successful downloads.
 */
export async function downloadOrUpdateExercises(
  actionContext: ActionContext,
  exerciseIds: ExerciseIdentifier[],
  courseId?: CourseIdentifier,
): Promise<Result<DownloadResults, Error>> {
  const { dialog, settings, langs, userData } = actionContext
  if (langs.err) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info("Downloading exercises", exerciseIds)

  if (exerciseIds.length === 0) {
    return Ok({ successful: [], failed: [] })
  }

  // When exerciseIds span multiple courses (no shared `courseId`), resolve
  // each exercise's own course so its status broadcast can be scoped correctly.
  const resolveCourseId = (exerciseId: ExerciseIdentifier): CourseIdentifier | undefined => {
    if (courseId) {
      return courseId
    }
    if (userData.err) {
      return undefined
    }
    const wanted = ExerciseIdentifier.unwrap(exerciseId)
    for (const course of userData.val.getCourses()) {
      if (LocalCourseData.getExercises(course).some((x) => x.data.id === wanted)) {
        return LocalCourseData.getCourseId(course)
      }
    }
    return undefined
  }

  TmcPanel.postMessage(
    ...exerciseIds
      .map((x) => wrapToMessage(x, "downloading", resolveCourseId(x)))
      .filter((x): x is ExtensionToWebview => x !== undefined),
  )
  const statuses = new Map<number | string, ExerciseStatus>(
    exerciseIds.map((x) => [ExerciseIdentifier.unwrap(x), "downloadFailed"]),
  )

  // A mooc CourseIdentifier's `instanceId` holds the course UUID, which is the
  // `--course-id` the bulk download resolves against.
  const moocCourseId = courseId
    ? match(
        courseId,
        () => undefined,
        (mooc) => mooc.instanceId,
      )
    : undefined

  const downloadTemplate = !settings.getDownloadOldSubmission()
  let cancelled = false
  const downloadResult = await dialog.progressNotification(
    "Downloading exercises...",
    (progress, token) => {
      // Cancelling kills the CLI download process; already-written exercises stay downloaded.
      let interruptDownload: (() => void) | undefined
      token.onCancellationRequested(() => {
        cancelled = true
        interruptDownload?.()
      })
      return langs.val.downloadExercises(
        exerciseIds,
        downloadTemplate,
        (download) => {
          progress.report(download)
          statuses.set(ExerciseIdentifier.unwrap(download.id), "closed")
          const message = wrapToMessage(download.id, "closed", resolveCourseId(download.id))
          if (message) {
            TmcPanel.postMessage(message)
          }
        },
        moocCourseId,
        (interrupt) => {
          interruptDownload = interrupt
        },
      )
    },
    { cancellable: true },
  )
  if (cancelled) {
    // The user chose to stop; report what completed instead of erroring.
    postMessages(statuses, resolveCourseId)
    Logger.info("Exercise download cancelled by the user")
    return Ok(sortResults(statuses))
  }

  const {
    tmc: { downloaded: tmcDownloaded, failed: tmcFailed, skipped: tmcSkipped },
    mooc: {
      downloaded: moocDownloaded,
      failed: moocFailed,
      skipped: moocSkipped,
      not_attempted: moocNotAttempted,
      stopped_for_auth: moocStoppedForAuth,
    },
    tmcError,
    moocError,
  } = downloadResult
  // Both backends were attempted independently; surface each one's failure separately.
  if (tmcError) {
    dialog.errorNotification("Failed to download exercises from tmc.mooc.fi.", tmcError)
  }
  if (moocError) {
    dialog.errorNotification("Failed to download exercises from courses.mooc.fi.", moocError)
  } else if (moocStoppedForAuth) {
    // Successful response, but the batch stopped early on auth failure; say how far it got.
    const moocRequested =
      moocDownloaded.length +
      moocSkipped.length +
      (moocFailed?.length ?? 0) +
      moocNotAttempted.length
    const moocCompleted = moocDownloaded.length + moocSkipped.length
    dialog.errorNotification(
      `Downloaded ${moocCompleted} of ${moocRequested} exercises from courses.mooc.fi, then` +
        ` your session expired — the rest will be available once you log in again.`,
    )
  }
  if (tmcSkipped.length > 0) {
    Logger.warn(`${tmcSkipped.length} downloads were skipped.`)
  }
  if (moocSkipped.length > 0) {
    Logger.warn(`${moocSkipped.length} downloads were skipped.`)
  }
  tmcDownloaded.forEach((x) => statuses.set(x.id, "closed"))
  moocDownloaded.forEach((x) => statuses.set(x["exercise-id"], "closed"))
  tmcSkipped.forEach((x) => statuses.set(x.id, "closed"))
  moocSkipped.forEach((x) => statuses.set(x["exercise-id"], "closed"))
  tmcFailed?.forEach(([exercise, reason]) => {
    Logger.error(`Failed to download exercise ${exercise["exercise-slug"]}: ${reason}`)
    statuses.set(exercise.id, "downloadFailed")
  })
  moocFailed?.forEach(([exercise, reason]) => {
    Logger.error(`Failed to download exercise ${exercise["exercise-id"]}: ${reason}`)
    statuses.set(exercise["exercise-id"], "downloadFailed")
  })
  moocNotAttempted.forEach((x) => {
    Logger.warn(
      `Did not attempt to download exercise ${x["exercise-id"]}: the batch stopped early` +
        ` after a mooc auth failure.`,
    )
    statuses.set(x["exercise-id"], "downloadFailed")
  })
  postMessages(statuses, resolveCourseId)
  if (tmcFailed && tmcFailed.length > 0) {
    const failedDownloads = tmcFailed.map(([f]) => f["exercise-slug"])
    dialog.errorNotification(
      "Failed to update exercises.",
      new ExerciseUpdateError(failedDownloads.join(", ")),
    )
  }
  if (moocFailed && moocFailed.length > 0) {
    const failedDownloads = moocFailed.map(([f]) => f["exercise-id"])
    dialog.errorNotification(
      "Failed to update exercises.",
      new ExerciseUpdateError(failedDownloads.join(", ")),
    )
  }

  return Ok(sortResults(statuses))
}

function postMessages(
  statuses: Map<number | string, ExerciseStatus>,
  resolveCourseId: (exerciseId: ExerciseIdentifier) => CourseIdentifier | undefined,
): void {
  TmcPanel.postMessage(
    ...Array.from(statuses.entries())
      .map(([id, s]) => {
        const exerciseId = ExerciseIdentifier.from(id)
        return wrapToMessage(exerciseId, s, resolveCourseId(exerciseId))
      })
      .filter((x): x is ExtensionToWebview => x !== undefined),
  )
}

function wrapToMessage(
  exerciseId: ExerciseIdentifier,
  status: ExerciseStatus,
  courseId: CourseIdentifier | undefined,
): ExtensionToWebview | undefined {
  // Drop the message rather than broadcast it unscoped when no course resolves.
  if (!courseId) {
    return undefined
  }
  return {
    type: "exerciseStatusChange",
    target: {
      type: "CourseDetails",
    },
    courseId,
    exerciseId,
    status,
  }
}

function sortResults(statuses: Map<number | string, ExerciseStatus>): DownloadResults {
  const successful: ExerciseIdentifier[] = []
  const failed: ExerciseIdentifier[] = []
  statuses.forEach((status, id) => {
    if (status !== "downloadFailed") {
      successful.push(ExerciseIdentifier.from(id))
    } else {
      failed.push(ExerciseIdentifier.from(id))
    }
  })
  return { successful, failed }
}

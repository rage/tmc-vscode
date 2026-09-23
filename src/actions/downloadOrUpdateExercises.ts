import type { FractionProgress } from "../api/dialog"
import type Langs from "../api/langs"
import { ExerciseUpdateError } from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier, ExerciseStatus, ExtensionToWebview } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, match } from "../shared/shared"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

type ExerciseDownloadResult = Awaited<ReturnType<Langs["downloadExercises"]>>

interface DownloadResults {
  successful: ExerciseIdentifier[]
  failed: ExerciseIdentifier[]
}

/**
 * Downloads given exercises and opens them in the course workspace.
 *
 * Never fails as a whole: a failed backend or exercise is reported here and lands in
 * `failed`, and a cancelled download returns what had completed.
 *
 * @param exerciseIds Exercises to download.
 * @param courseId Course the exercises belong to, when they all share one. Passed
 *   to the mooc bulk download so it can fetch just that course's slides instead of
 *   scanning every enrolled course. Omit when the exercises span multiple courses
 *   (e.g. the aggregate update flow).
 */
export async function downloadOrUpdateExercises(
  actionContext: ReadyActionContext,
  exerciseIds: ExerciseIdentifier[],
  courseId?: CourseIdentifier,
): Promise<DownloadResults> {
  const { dialog, settings } = actionContext
  const { langs, userData } = actionContext.startup
  Logger.info("Downloading exercises", exerciseIds)

  if (exerciseIds.length === 0) {
    return { successful: [], failed: [] }
  }

  // When exerciseIds span multiple courses (no shared `courseId`), resolve
  // each exercise's own course so its status broadcast can be scoped correctly.
  const resolveCourseId = (exerciseId: ExerciseIdentifier): CourseIdentifier | undefined => {
    if (courseId) {
      return courseId
    }
    const wanted = ExerciseIdentifier.unwrap(exerciseId)
    for (const course of userData.getCourses()) {
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
  const tmcExerciseIds = exerciseIds.filter((x) => x.kind === "tmc")
  const moocExerciseIds = exerciseIds.filter((x) => x.kind === "mooc")
  let cancelled = false
  const downloadResult = await dialog.progressNotification(
    "Downloading exercises...",
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
      let completed = 0
      const onDownloaded = (download: FractionProgress & { id: ExerciseIdentifier }): void => {
        const id = ExerciseIdentifier.unwrap(download.id)
        const previousStatus = statuses.get(id)
        if (previousStatus !== undefined && previousStatus !== "closed") {
          completed += 1
        }
        statuses.set(id, "closed")
        progress.report({ fraction: completed / exerciseIds.length, message: download.message })
        const message = wrapToMessage(download.id, "closed", resolveCourseId(download.id))
        if (message) {
          TmcPanel.postMessage(message)
        }
      }

      // One call per backend, awaited in turn: a single mixed call would spawn
      // the second backend's process even after the user cancelled the first.
      const runLeg = async (
        ids: ExerciseIdentifier[],
        legMoocCourseId: string | undefined,
      ): Promise<ExerciseDownloadResult | undefined> => {
        if (ids.length === 0 || cancelled) {
          return undefined
        }
        const legResult = await langs.downloadExercises(
          ids,
          downloadTemplate,
          onDownloaded,
          legMoocCourseId,
          registerInterrupt,
        )
        interruptDownload = undefined
        return legResult
      }

      const tmcLeg = await runLeg(tmcExerciseIds, undefined)
      const moocLeg = await runLeg(moocExerciseIds, moocCourseId)

      return {
        tmc: tmcLeg?.tmc ?? { downloaded: [], failed: [], skipped: [] },
        mooc: moocLeg?.mooc ?? { downloaded: [], failed: [], skipped: [] },
        tmcError: tmcLeg?.tmcError,
        moocError: moocLeg?.moocError,
      }
    },
    { cancellable: true },
  )
  if (cancelled) {
    // The user chose to stop; report what completed instead of erroring.
    postMessages(statuses, resolveCourseId)
    Logger.info("Exercise download cancelled by the user")
    return sortResults(statuses)
  }

  const {
    tmc: { downloaded: tmcDownloaded, failed: tmcFailed, skipped: tmcSkipped },
    mooc: { downloaded: moocDownloaded, failed: moocFailed, skipped: moocSkipped },
    tmcError,
    moocError,
  } = downloadResult
  // Both backends were attempted independently; surface each one's failure separately.
  if (tmcError) {
    dialog.reportError("Failed to download exercises from tmc.mooc.fi.", tmcError, "tmc")
  }
  if (moocError) {
    dialog.reportError("Failed to download exercises from courses.mooc.fi.", moocError, "mooc")
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
  postMessages(statuses, resolveCourseId)
  if (tmcFailed && tmcFailed.length > 0) {
    const failedDownloads = tmcFailed.map(([f]) => f["exercise-slug"])
    dialog.reportError(
      "Failed to update exercises.",
      new ExerciseUpdateError(failedDownloads.join(", ")),
      "tmc",
    )
  }
  if (moocFailed && moocFailed.length > 0) {
    const failedDownloads = moocFailed.map(([f]) => f["exercise-id"])
    dialog.reportError(
      "Failed to update exercises.",
      new ExerciseUpdateError(failedDownloads.join(", ")),
      "mooc",
    )
  }

  return sortResults(statuses)
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

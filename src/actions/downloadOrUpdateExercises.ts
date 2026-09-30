import type { FractionProgress } from "../api/dialog"
import type Langs from "../api/langs"
import { ExerciseUpdateError, presentationFor } from "../errors"
import type { BackendKind, CourseIdentifier, ExerciseStatus } from "../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  match,
} from "../shared/shared"
import { exerciseStatusRegistry } from "../ui/exerciseStatusRegistry"
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
 * Never fails as a whole: every failure is reported here, in one notification naming the
 * exercises, and lands in `failed`; a cancelled download returns what had completed.
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

  const statuses = new Map<number | string, ExerciseStatus>(
    exerciseIds.map((x) => [ExerciseIdentifier.unwrap(x), "downloadFailed"]),
  )
  postStatuses(
    new Map(exerciseIds.map((x) => [ExerciseIdentifier.unwrap(x), "downloading"])),
    resolveCourseId,
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
      let completed = 0
      const onDownloaded = (download: FractionProgress & { id: ExerciseIdentifier }): void => {
        const id = ExerciseIdentifier.unwrap(download.id)
        const previousStatus = statuses.get(id)
        if (previousStatus !== undefined && previousStatus !== "closed") {
          completed += 1
        }
        statuses.set(id, "closed")
        progress.report({ fraction: completed / exerciseIds.length, message: download.message })
        const exerciseCourseId = resolveCourseId(download.id)
        if (exerciseCourseId) {
          exerciseStatusRegistry.record(exerciseCourseId, [[download.id, "closed"]])
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
    postStatuses(statuses, resolveCourseId)
    Logger.info("Exercise download cancelled by the user")
    return sortResults(statuses)
  }

  const {
    tmc: { downloaded: tmcDownloaded, failed: tmcFailed, skipped: tmcSkipped },
    mooc: { downloaded: moocDownloaded, failed: moocFailed, skipped: moocSkipped },
    tmcError,
    moocError,
  } = downloadResult
  if (tmcError) {
    Logger.error("Failed to download exercises from tmc.mooc.fi", tmcError)
  }
  if (moocError) {
    Logger.error("Failed to download exercises from courses.mooc.fi", moocError)
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
  postStatuses(statuses, resolveCourseId)

  const results = sortResults(statuses)
  if (results.failed.length > 0) {
    const names = results.failed.map((id) => exerciseName(actionContext, id))
    const [cause, backend] = failureCause(
      [
        [tmcError, "tmc"],
        [moocError, "mooc"],
      ],
      [...(tmcFailed ?? []), ...(moocFailed ?? [])].map(([, reasons]) => reasons),
    )
    dialog.reportError(`Failed to download ${describeExercises(names)}.`, cause, backend)
  }
  return results
}

/**
 * The one error a failed download is reported with.
 *
 * A backend that failed as a whole is the cause worth naming, preferring one whose
 * presentation carries a remedy (e.g. "Log in"); otherwise the per-exercise reasons.
 */
function failureCause(
  legErrors: [Error | undefined, BackendKind][],
  exerciseReasons: string[][],
): [Error, BackendKind | undefined] {
  const failedLegs = legErrors.filter((leg): leg is [Error, BackendKind] => leg[0] !== undefined)
  const leg =
    failedLegs.find(([error, backend]) => presentationFor(error, backend).actions.length > 0) ??
    failedLegs[0]
  if (leg) {
    return leg
  }
  const reasons = [...new Set(exerciseReasons.flat().filter((reason) => reason !== ""))]
  return [
    new ExerciseUpdateError(
      reasons.length > 0 ? reasons.join("; ") : "tmc-langs did not report them as downloaded",
    ),
    undefined,
  ]
}

/** Records `statuses` per course: an exercise list can span courses. */
function postStatuses(
  statuses: Map<number | string, ExerciseStatus>,
  resolveCourseId: (exerciseId: ExerciseIdentifier) => CourseIdentifier | undefined,
): void {
  const byCourse = new Map<string, [CourseIdentifier, [ExerciseIdentifier, ExerciseStatus][]]>()
  for (const [id, status] of statuses) {
    const exerciseId = ExerciseIdentifier.from(id)
    const courseId = resolveCourseId(exerciseId)
    // Dropped rather than recorded unscoped when no course resolves.
    if (!courseId) {
      continue
    }
    const key = CourseIdentifierNs.key(courseId)
    const entry = byCourse.get(key) ?? [courseId, []]
    entry[1].push([exerciseId, status])
    byCourse.set(key, entry)
  }
  for (const [courseId, courseStatuses] of byCourse.values()) {
    exerciseStatusRegistry.record(courseId, courseStatuses)
  }
}

/** The name the student knows `exerciseId` by, or its id if no stored course has it. */
function exerciseName(actionContext: ReadyActionContext, exerciseId: ExerciseIdentifier): string {
  const wanted = ExerciseIdentifier.unwrap(exerciseId)
  for (const course of actionContext.startup.userData.getCourses()) {
    const exercise = LocalCourseData.getExercises(course).find((x) => x.data.id === wanted)
    if (exercise) {
      return LocalCourseExercise.getSlug(exercise)
    }
  }
  return String(wanted)
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

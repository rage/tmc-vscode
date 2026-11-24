import { Ok } from "ts-results"

import {
  backendName,
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
} from "../../shared/lib"
import { checkForExerciseUpdates, downloadExerciseUpdates } from "../actions"
import { describeExercises, exerciseName } from "../actions/exerciseNames"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { isSessionLost } from "../errors"
import { backgroundJobs } from "../ui/backgroundJobs"
import { recentUpdates } from "../ui/recentUpdates"
import { shownCourseHome } from "../ui/shownCourseHome"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { Logger, PROSE_LOCALE } from "../utilities"
import { showCourseHomeButton } from "./showCourseHome"

/**
 * Downloads pending exercise updates, or offers to.
 *
 * `"silent"` is for runs the user did not ask for — activation, the background poll,
 * the refresh after a submit. It suppresses the "up to date" toast and the failure
 * notification but deliberately not the offer of updates found, which reaches a user who
 * has turned automatic updates off, once per update. `"promptless"` is `"silent"` without
 * that offer too. A run the user asked for skips the CLI's cached answer.
 *
 * @param isRequested The user asked for the run although its mode is not `"loud"`, as a course
 * home's Refresh does, whose screen shows what the run finds: the cached answer is skipped too.
 */
export async function updateExercises(
  actionContext: ReadyActionContext,
  mode?: "silent" | "promptless" | "loud",
  isRequested = mode === "loud" || mode === undefined,
): Promise<void> {
  const { dialog, settings } = actionContext
  const { userData } = actionContext.startup
  const silent = mode === "silent" || mode === "promptless"
  Logger.info("Checking for exercise updates")

  const updateablesResult = await withOperation(
    dialog,
    { failure: "Failed to check for exercise updates.", silent },
    async () =>
      Ok(
        await backgroundJobs.run(
          { label: "Checking for updates", screen: { kind: "coursesView" } },
          () => checkForExerciseUpdates(actionContext, { forceRefresh: isRequested }),
        ),
      ),
  )
  if (updateablesResult.err) {
    return
  }

  const { outdated, removed, failures, unchecked } = updateablesResult.val
  const knownBefore = new Set(
    userData
      .getCourses()
      .flatMap((course) => updateablesRegistry.get(LocalCourseData.getCourseId(course)))
      .map((id) => ExerciseIdentifier.key(id)),
  )
  const uncheckedCourses = userData
    .getCourses()
    .filter((course) =>
      unchecked.some((id) => CourseIdentifier.equals(id, LocalCourseData.getCourseId(course))),
    )
  // What a failed backend's courses, or an unchecked course, last showed is still the best answer.
  updateablesRegistry.setMany(
    userData
      .getCourses()
      .filter((course) => failures.every(({ backend }) => backend !== course.kind))
      .filter((course) => !uncheckedCourses.includes(course))
      .map((course) => {
        const courseId = LocalCourseData.getCourseId(course)
        return [
          courseId,
          outdated
            .filter((x) => CourseIdentifier.equals(x.courseId, courseId))
            .map((x) => x.exerciseId),
        ]
      }),
  )
  for (const backend of ["tmc", "mooc"] as const) {
    if (failures.every((failure) => failure.backend !== backend)) {
      updateablesRegistry.setRemoved(backend, [
        ...removed.filter((id) => id.kind === backend),
        ...uncheckedCourses
          .filter((course) => course.kind === backend)
          .flatMap((course) => LocalCourseData.getExercises(course))
          .map((exercise) => LocalCourseExercise.getId(exercise))
          .filter((id) => updateablesRegistry.isRemoved(id)),
      ])
    }
  }
  const [firstFailure] = failures
  if (!silent && firstFailure) {
    // One notification however many sites failed; the log has each one's error.
    for (const { backend, error } of failures.slice(1)) {
      Logger.error(`Failed to check ${backendName(backend)} for exercise updates.`, error)
    }
    void dialog.reportError("Failed to check for exercise updates.", firstFailure.error)
  }

  const updateable = outdated.filter((x) => {
    const course = userData.getCourse(x.courseId)
    return (
      course.ok &&
      !LocalCourseData.isDisabled(course.val) &&
      LocalCourseData.getAccessLoss(course.val) === undefined
    )
  })
  if (updateable.length > 0 && settings.getAutomaticallyUpdateExercises()) {
    // The student did not pick these exercises to update, even when they asked for a refresh.
    await downloadUpdates(actionContext, updateable, { isUnrequested: silent, isAnnounced: true })
    return
  }

  // A postponed reminder holds back only the prompt, and only one the user did not ask for.
  const now = Date.now()
  const exercisesToUpdate = silent
    ? updateable.filter((x) => {
        const course = userData.getCourse(x.courseId)
        return course.ok && course.val.data.notifyAfter <= now
      })
    : updateable

  if (exercisesToUpdate.length === 0 || mode === "promptless") {
    // New exercises are not up to date with the course; their own offer speaks for them.
    const hasNewExercises = userData
      .getCourses()
      .some((course) => LocalCourseData.getNewExercises(course).length > 0)
    if (!silent && failures.length === 0 && !hasNewExercises) {
      dialog.statusMessage(allClear(uncheckedCourses))
    }
    return
  }
  // A background check offers each update once: the course home and the Courses view's badge
  // keep showing it.
  offerUpdates(
    actionContext,
    silent
      ? exercisesToUpdate.filter((x) => !knownBefore.has(ExerciseIdentifier.key(x.exerciseId)))
      : exercisesToUpdate,
  )
}

/**
 * Offers to show the course home of the courses with `updates`, unless it is on screen showing
 * one of them already, where its update banner says it.
 */
function offerUpdates(actionContext: ReadyActionContext, updates: readonly ExerciseUpdate[]): void {
  const { userData } = actionContext.startup
  if (updates.some((x) => shownCourseHome.isShowing(x.courseId))) {
    return
  }
  const [first] = updates
  if (!first) {
    return
  }
  const courseKeys = new Set(updates.map((x) => CourseIdentifier.key(x.courseId)))
  const course = userData.getCourse(first.courseId)
  const ofCourse =
    courseKeys.size === 1 && course.ok ? ` of ${LocalCourseData.getCourseTitle(course.val)}` : ""
  const message =
    updates.length === 1
      ? `1 exercise${ofCourse} has an update.`
      : `${updates.length} exercises${ofCourse} have updates.`
  void actionContext.dialog.notification(message, showCourseHomeButton(first.courseId))
}

interface ExerciseUpdate {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
}

/**
 * Downloads `updates`, leaving a trace of what it updated in each course's home. While that is
 * not on screen, an update the student picked says so in the status bar, and an automatic one
 * offers to show it.
 *
 * @param options.isUnrequested See `downloadExerciseUpdates`.
 * @param options.isAnnounced Whether to announce the update as an automatic one, which the
 *   student did not pick; implied by `isUnrequested`.
 */
export async function downloadUpdates(
  actionContext: ReadyActionContext,
  updates: readonly ExerciseUpdate[],
  options: { isUnrequested?: boolean; isAnnounced?: boolean } = {},
): Promise<void> {
  const isUnrequested = options.isUnrequested ?? false
  const result = await withOperation(
    actionContext.dialog,
    {
      failure: "Failed to update exercises.",
      silent: isUnrequested,
      isBackground: options.isAnnounced === true,
    },
    async () => {
      const downloaded = await downloadExerciseUpdates(actionContext, updates, isUnrequested)
      // The failed-update status bar item and course home notice say which failed, and clear
      // once a later update succeeds, which a notification could not. A lost session still
      // warns: that warning is what offers Log In.
      return downloaded.map(({ updated, warnings }) => ({
        updated,
        warnings: warnings.filter(
          (warning) => !warning.failedExercises || isSessionLost(warning.error),
        ),
      }))
    },
  )
  if (result.err || result.val.updated.length === 0) {
    return
  }
  const { updated } = result.val
  const isRequested = !isUnrequested && !options.isAnnounced
  const updatedKeys = new Set(updated.map((id) => ExerciseIdentifier.key(id)))
  const byCourse = new Map<string, { courseId: CourseIdentifier; names: string[] }>()
  for (const { courseId, exerciseId } of updates) {
    if (!updatedKeys.has(ExerciseIdentifier.key(exerciseId))) {
      continue
    }
    const entry = byCourse.get(CourseIdentifier.key(courseId)) ?? { courseId, names: [] }
    entry.names.push(exerciseName(actionContext, exerciseId))
    byCourse.set(CourseIdentifier.key(courseId), entry)
  }
  const unseen = [...byCourse.values()].filter(({ courseId, names }) => {
    recentUpdates.add(courseId, names)
    return !shownCourseHome.isShowing(courseId)
  })
  const [first] = unseen
  if (first && isRequested) {
    actionContext.dialog.statusMessage(
      `Updated ${describeExercises(unseen.flatMap((entry) => entry.names))}.`,
    )
  } else if (first) {
    const names = unseen.flatMap((entry) => entry.names)
    void actionContext.dialog.notification(
      `Updated ${describeExercises(names)} to the latest version.`,
      showCourseHomeButton(first.courseId),
    )
  }
}

/** The all-clear of a check that found nothing to update, naming the courses it could not check. */
function allClear(uncheckedCourses: readonly LocalCourseData[]): string {
  if (uncheckedCourses.length === 0) {
    return "All exercises are up to date."
  }
  const titles = new Intl.ListFormat(PROSE_LOCALE).format(
    uncheckedCourses.map((course) => LocalCourseData.getCourseTitle(course)),
  )
  const verb = uncheckedCourses.length === 1 ? "is" : "are"
  return `${titles} ${verb} no longer available. Your other exercises are up to date.`
}

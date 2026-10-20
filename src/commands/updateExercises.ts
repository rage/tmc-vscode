import { Ok } from "ts-results"

import {
  backendName,
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
} from "../../shared/lib"
import { checkForExerciseUpdates, downloadExerciseUpdates } from "../actions"
import { describeExercises, exerciseName } from "../actions/exerciseNames"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { recentUpdates } from "../ui/recentUpdates"
import { shownCourseHome } from "../ui/shownCourseHome"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { Logger } from "../utilities"
import { showCourseHomeButton } from "./showCourseHome"

/**
 * Downloads pending exercise updates, or offers to.
 *
 * `"silent"` is for runs the user did not ask for — activation, the background poll,
 * the refresh after a submit. It suppresses the "up to date" toast and the failure
 * notification but deliberately not the offer of updates found, which reaches a user who
 * has turned automatic updates off, once per update. `"promptless"` is `"silent"` without
 * that offer too. A run the user asked for skips the CLI's cached answer.
 */
export async function updateExercises(
  actionContext: ReadyActionContext,
  mode?: "silent" | "promptless" | "loud",
): Promise<void> {
  const { dialog, settings } = actionContext
  const { userData } = actionContext.startup
  const silent = mode === "silent" || mode === "promptless"
  Logger.info("Checking for exercise updates")

  const updateablesResult = await withOperation(
    dialog,
    { failure: "Failed to check for exercise updates.", silent },
    async () => Ok(await checkForExerciseUpdates(actionContext, { forceRefresh: !silent })),
  )
  if (updateablesResult.err) {
    return
  }

  const { outdated, failures } = updateablesResult.val
  const knownBefore = new Set(
    userData
      .getCourses()
      .flatMap((course) => updateablesRegistry.get(LocalCourseData.getCourseId(course)))
      .map((id) => ExerciseIdentifier.key(id)),
  )
  // What a failed backend's courses last showed is still the best answer for them.
  updateablesRegistry.setMany(
    userData
      .getCourses()
      .filter((course) => failures.every(({ backend }) => backend !== course.kind))
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
  const [firstFailure] = failures
  if (!silent && firstFailure) {
    // One notification however many sites failed; the log has each one's error.
    const sites = failures.map(({ backend }) => backendName(backend)).join(" and ")
    for (const { backend, error } of failures.slice(1)) {
      Logger.error(`Failed to check ${backendName(backend)} for exercise updates.`, error)
    }
    void dialog.reportError(`Failed to check ${sites} for exercise updates.`, firstFailure.error)
  }

  const updateable = outdated.filter((x) => {
    const course = userData.getCourse(x.courseId)
    return course.ok && !LocalCourseData.isDisabled(course.val)
  })
  if (updateable.length > 0 && settings.getAutomaticallyUpdateExercises()) {
    await downloadUpdates(actionContext, updateable, silent)
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
    if (!silent && failures.length === 0) {
      dialog.statusMessage("All exercises are up to date.")
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
 * Downloads `updates`. A requested update says in the status bar which exercises it updated. An
 * automatic one leaves its trace in the course home, and offers to show it when it is not on
 * screen.
 *
 * @param isUnrequested See `downloadExerciseUpdates`.
 */
export async function downloadUpdates(
  actionContext: ReadyActionContext,
  updates: readonly ExerciseUpdate[],
  isUnrequested = false,
): Promise<void> {
  const result = await withOperation(
    actionContext.dialog,
    { failure: "Failed to update exercises." },
    () => downloadExerciseUpdates(actionContext, updates, isUnrequested),
  )
  if (result.err || result.val.updated.length === 0) {
    return
  }
  const { updated } = result.val
  if (!isUnrequested) {
    const names = updated.map((id) => exerciseName(actionContext, id))
    actionContext.dialog.statusMessage(`Updated ${describeExercises(names)}.`)
    return
  }
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
  if (first) {
    const names = unseen.flatMap((entry) => entry.names)
    void actionContext.dialog.notification(
      `Updated ${describeExercises(names)} to the latest version.`,
      showCourseHomeButton(first.courseId),
    )
  }
}

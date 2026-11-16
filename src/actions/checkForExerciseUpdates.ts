import type { BackendKind } from "../../shared/lib"
import {
  backendName,
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
} from "../../shared/lib"
import type { UncheckedCourse } from "../api/langs"
import { InsufficientScopeError } from "../errors"
import { Logger } from "../utilities"
import { recordCourseAccessLoss } from "./courseAccess"
import type { ReadyActionContext } from "./types"
import type { MoocEnrollments } from "./updateCourse"
import { accessLossOf, fetchMoocEnrollments } from "./updateCourse"

interface Options {
  forceRefresh?: boolean
}

interface OutdatedExercise {
  courseId: CourseIdentifier
  exerciseName: string
  exerciseId: ExerciseIdentifier
}

/** What {@link checkForExerciseUpdates} found. */
export interface ExerciseUpdateCheck {
  outdated: OutdatedExercise[]
  /** Downloaded exercises their backend no longer has; one in a chapter not open yet is not. */
  removed: ExerciseIdentifier[]
  /**
   * The backends holding the user's courses whose check failed. `outdated` says nothing
   * about their exercises.
   */
  failures: { backend: BackendKind; error: Error }[]
  /**
   * The courses their backend refused to serve. `outdated` and `removed` say nothing about their
   * exercises.
   */
  unchecked: CourseIdentifier[]
}

/**
 * Lists the exercises in the user's courses that have updates or were removed. Only backends
 * holding some of the user's courses are asked, and one whose check fails is named in
 * `failures` rather than failing the whole check.
 *
 * A course the backend refused is marked with its access loss like a refused refresh, unless the
 * refusal is the session's: that one is named in `failures`.
 */
export async function checkForExerciseUpdates(
  actionContext: ReadyActionContext,
  options?: Options,
): Promise<ExerciseUpdateCheck> {
  const { langs, userData } = actionContext.startup
  const forceRefresh = options?.forceRefresh ?? false
  Logger.info("Checking for exercise updates, forced update:", forceRefresh)

  const courses = userData.getCourses()
  const backends = [...new Set(courses.map((course) => course.kind))]
  const checks = await Promise.all(
    backends.map(async (backend) => ({
      backend,
      result: await langs.checkExerciseUpdates(backend, { forceRefresh }),
    })),
  )
  const updateable = new Set<string>()
  // The CLI cannot tell an exercise hidden until its chapter opens from a removed one.
  const isClosed = (id: ExerciseIdentifier): boolean =>
    courses.some((course) => LocalCourseData.getClosedChapterOf(course, id) !== undefined)
  const removed: ExerciseIdentifier[] = []
  const failures: ExerciseUpdateCheck["failures"] = []
  const unchecked: UncheckedCourse[] = []
  for (const { backend, result } of checks) {
    if (result.ok) {
      result.val.updated.forEach((id) => updateable.add(ExerciseIdentifier.key(id)))
      removed.push(...result.val.removed.filter((id) => !isClosed(id)))
      unchecked.push(...(result.val.uncheckedCourses ?? []))
    } else {
      Logger.warn(
        `Skipping the ${backendName(backend)} exercise update check; it failed:`,
        result.val,
      )
      failures.push({ backend, error: result.val })
    }
  }

  if (await recordUncheckedCourses(actionContext, unchecked)) {
    const error = new InsufficientScopeError(
      `${backendName("mooc")} refused to serve your courses.`,
    )
    Logger.warn(error.message)
    failures.push({ backend: "mooc", error })
  }

  const outdated = courses.flatMap((course) => {
    const courseId = LocalCourseData.getCourseId(course)
    return LocalCourseData.getExercises(course)
      .filter((x) => updateable.has(ExerciseIdentifier.key(LocalCourseExercise.getId(x))))
      .map((x) => ({
        courseId,
        exerciseId: LocalCourseExercise.getId(x),
        exerciseName: LocalCourseExercise.getSlug(x),
      }))
  })
  Logger.info(
    `Update check found ${outdated.length} outdated and ${removed.length} removed exercises`,
  )
  return { outdated, removed, failures, unchecked: unchecked.map((x) => x.courseId) }
}

/**
 * Marks each course in `unchecked` with the access loss its refusal shows, the way a refused
 * refresh does. Returns whether the refusals are the session's instead.
 *
 * Every mooc course refused with an insufficient scope is taken as a session without the scope,
 * the likeliest cause by far, rather than as every course lost at once.
 */
async function recordUncheckedCourses(
  actionContext: ReadyActionContext,
  unchecked: readonly UncheckedCourse[],
): Promise<boolean> {
  const { langs, userData } = actionContext.startup
  const scopeRefusalCount = unchecked.filter(
    ({ refusal }) => refusal instanceof InsufficientScopeError,
  ).length
  if (scopeRefusalCount === 0) {
    await recordAccessLosses(actionContext, unchecked, undefined)
    return false
  }
  const moocCourseCount = userData.getCourses().filter((course) => course.kind === "mooc").length
  if (scopeRefusalCount >= moocCourseCount) {
    return true
  }
  const enrollments = await fetchMoocEnrollments(langs)
  await recordAccessLosses(actionContext, unchecked, enrollments)
  return enrollments.err
}

async function recordAccessLosses(
  actionContext: ReadyActionContext,
  unchecked: readonly UncheckedCourse[],
  enrollments: MoocEnrollments | undefined,
): Promise<void> {
  for (const { courseId, refusal } of unchecked) {
    const reason = accessLossOf(refusal, enrollments)
    const course = actionContext.startup.userData.getCourse(courseId)
    if (!reason || course.err) {
      continue
    }
    const recorded = await recordCourseAccessLoss(actionContext, course.val, reason)
    if (recorded.err) {
      Logger.error(
        `Failed to record that ${CourseIdentifier.toString(courseId)} is lost.`,
        recorded.val,
      )
    }
  }
}

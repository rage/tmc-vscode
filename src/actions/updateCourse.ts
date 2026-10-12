import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { BackendKind, CourseIdentifier, Enum } from "../../shared/lib"
import { backendName, LocalCourseData, makeMoocKind, makeTmcKind, match } from "../../shared/lib"
import type Langs from "../api/langs"
import type { OperationWarning, Warned } from "../api/withOperation"
import {
  ConnectionError,
  ForbiddenError,
  InsufficientScopeError,
  ServerError,
  TmcLoginNotAcceptedError,
} from "../errors"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../storage/data"
import { Logger } from "../utilities"
import { toStoredMoocCourse, toStoredTmcCourse } from "../utilities/apiData"
import type { ReadyActionContext } from "./types"

/**
 * A course to fetch. `previous` is the stored course a refresh replaces, whose user-side
 * fields carry over; an add has none. A tmc course's data does not name the organization
 * it was picked from, so the caller does.
 */
export type CourseSource = Enum<
  { courseId: number; organization: string; previous?: TmcLocalCourseData | undefined },
  { courseId: string; previous?: MoocLocalCourseData | undefined }
>

/** Fetches a course from its backend, in the form it is stored in. */
export async function fetchStoredCourse(
  langs: Langs,
  source: CourseSource,
  options?: { forceRefresh?: boolean },
): Promise<Result<LocalCourseData, Error>> {
  return match(
    source,
    async (tmc) =>
      (await langs.getTmcCourseData(tmc.courseId, options)).map((data) =>
        makeTmcKind(toStoredTmcCourse(data, tmc.organization, tmc.previous)),
      ),
    async (mooc) =>
      (await langs.getMoocCourseData(mooc.courseId, options)).map((data) =>
        makeMoocKind(toStoredMoocCourse(data, mooc.previous)),
      ),
  )
}

/**
 * The warning that `backend` refuses the user's session, or none until it serves them again.
 *
 * `updateCourse` runs once per course and from a half-hourly background poll, so an
 * unguarded warning would repeat for every course on every refresh.
 */
function sessionRefusalWarnings(
  { authState }: ReadyActionContext,
  backend: BackendKind,
  error: Error,
): OperationWarning[] {
  if (authState.sessionRefusalsReported.has(backend)) {
    return []
  }
  authState.sessionRefusalsReported.add(backend)
  return [{ headline: "Failed to update course data.", error }]
}

/** What {@link updateCourse} did. */
export interface CourseUpdate extends Warned {
  /** Whether the backend's data was received and stored. */
  isUpdated: boolean
}

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * Local exercises are **not** rescanned; the caller runs `refreshLocalExercises` once it has
 * updated every course it means to, so a rescan does not repeat per course.
 *
 * @param courseId ID of the course to update.
 */
export async function updateCourse(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<Result<CourseUpdate, Error>> {
  const { exerciseDecorationProvider, langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Updating course")

  const storedCourse = userData.getCourse(courseId)
  if (storedCourse.err) {
    return storedCourse
  }
  const courseData = storedCourse.val
  const updateResult = await fetchStoredCourse(
    langs,
    match(
      courseData,
      (tmc) => makeTmcKind({ courseId: tmc.id, organization: tmc.organization, previous: tmc }),
      (mooc) => makeMoocKind({ courseId: mooc.id, previous: mooc }),
    ),
    { forceRefresh: true },
  )
  if (updateResult.err) {
    if (
      updateResult.val instanceof InsufficientScopeError ||
      updateResult.val instanceof TmcLoginNotAcceptedError
    ) {
      // Says nothing about the course, so nothing stored about it is touched.
      Logger.warn(`${backendName(courseId.kind)} refused the session.`, updateResult.val)
      return Ok({
        isUpdated: false,
        warnings: sessionRefusalWarnings(actionContext, courseId.kind, updateResult.val),
      })
    }
    if (updateResult.val instanceof ForbiddenError) {
      if (courseData.kind === "tmc" && !courseData.data.disabled) {
        Logger.warn(`Failed to access information for course. Marking as disabled.`)
        courseData.data.disabled = true
        const disableResult = await userData.replaceCourse(courseData)
        if (disableResult.err) {
          return disableResult
        }
      } else {
        Logger.warn(`ForbiddenError above probably caused by course still being disabled`)
      }
      return Ok({ isUpdated: false, warnings: [] })
    } else if (
      updateResult.val instanceof ConnectionError ||
      updateResult.val instanceof ServerError
    ) {
      Logger.warn(`Failed to fetch data from ${backendName(courseId.kind)}, data not updated.`)
      actionContext.coursesTree.setBackendReachable(courseId.kind, false)
      return Ok({ isUpdated: false, warnings: [] })
    }
    return updateResult
  }

  actionContext.coursesTree.setBackendReachable(courseId.kind, true)
  // A refusal reported before has ended, so the next one is worth telling the user about.
  actionContext.authState.sessionRefusalsReported.delete(courseId.kind)

  const course = updateResult.val
  const stored = await userData.replaceCourse(course)
  if (stored.err) {
    return stored
  }
  const courseName = LocalCourseData.getCourseName(course)
  if (
    courseName === workspaceManager.activeCourse &&
    course.kind === workspaceManager.activeCourseBackend
  ) {
    exerciseDecorationProvider.updateDecorationsForExercises(
      ...workspaceManager.getExercisesByCourseSlug(course.kind, courseName),
    )
  }

  return Ok({ isUpdated: true, warnings: [] })
}

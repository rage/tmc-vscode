import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { ConnectionError, ForbiddenError, InsufficientScopeError, ServerError } from "../errors"
import type { CombinedCourseData, MoocCourse, TmcExerciseSlide } from "../shared/langsSchema"
import type { BackendKind, Enum } from "../shared/shared"
import {
  backendName,
  CourseIdentifier,
  LocalCourseData,
  makeMoocKind,
  makeTmcKind,
  match,
} from "../shared/shared"
import { Logger } from "../utilities"
import { toStoredMoocCourse, toStoredTmcCourse } from "../utilities/apiData"
import type { ReadyActionContext } from "./types"

/**
 * The stored course and the refetched data are looked up by the same id, so this
 * only guards the narrowing the projections need.
 */
function mismatchedBackend(courseId: CourseIdentifier, expected: BackendKind): Error {
  return new Error(
    `Expected stored course ${CourseIdentifier.toString(courseId)} to be a ${expected} course`,
  )
}

/**
 * Tells the user their session has to be renewed, and stays quiet until one is.
 *
 * `updateCourse` runs once per course and from a half-hourly background poll, so an
 * unguarded dialog would repeat for every course on every refresh.
 */
function reportInsufficientScope(
  { authState, dialog }: ReadyActionContext,
  error: InsufficientScopeError,
): void {
  if (authState.insufficientScopeReported) {
    return
  }
  authState.insufficientScopeReported = true
  dialog.reportError("Failed to update course data.", error)
}

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * Local exercises are **not** rescanned; the caller runs `refreshLocalExercises` once it has
 * updated every course it means to, so a rescan does not repeat per course.
 *
 * @param courseId ID of the course to update.
 * @returns Boolean value representing whether the data from server was successfully received.
 */
export async function updateCourse(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<Result<boolean, Error>> {
  const { exerciseDecorationProvider, langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Updating course")

  const storedCourse = userData.getCourse(courseId)
  if (storedCourse.err) {
    return storedCourse
  }
  const courseData = storedCourse.val
  const updateResult: Result<
    Enum<CombinedCourseData, [MoocCourse, TmcExerciseSlide[]]>,
    Error
  > = await match(
    courseId,
    (tmcId) =>
      langs
        .getTmcCourseData(tmcId.courseId, { forceRefresh: true })
        .then((res) => res.map((x) => makeTmcKind(x))),
    (moocId) =>
      langs
        .getMoocCourseData(moocId.instanceId, { forceRefresh: true })
        .then((res) => res.map((x) => makeMoocKind(x))),
  )
  if (updateResult.err) {
    if (updateResult.val instanceof InsufficientScopeError) {
      // Says nothing about the course, so nothing stored about it is touched.
      Logger.warn("The current session does not grant access to programming exercises.")
      reportInsufficientScope(actionContext, updateResult.val)
      return Ok(false)
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
      return Ok(false)
    } else if (
      updateResult.val instanceof ConnectionError ||
      updateResult.val instanceof ServerError
    ) {
      Logger.warn(`Failed to fetch data from ${backendName(courseId.kind)}, data not updated.`)
      actionContext.coursesTree.setBackendReachable(courseId.kind, false)
      return Ok(false)
    }
    return updateResult
  }

  actionContext.coursesTree.setBackendReachable(courseId.kind, true)

  const refreshed = await match(
    updateResult.val,
    async (tmc): Promise<Result<LocalCourseData, Error>> => {
      if (courseData.kind !== "tmc") {
        return Err(mismatchedBackend(courseId, "tmc"))
      }
      const next = toStoredTmcCourse(tmc, courseData.data.organization, courseData.data)
      return Ok(makeTmcKind(next))
    },
    async ([moocCourse, slides]): Promise<Result<LocalCourseData, Error>> => {
      // The fetch the session was refused before has now gone through, so the next
      // lapse is worth telling the user about again.
      actionContext.authState.insufficientScopeReported = false
      if (courseData.kind !== "mooc") {
        return Err(mismatchedBackend(courseId, "mooc"))
      }
      // Non-fatal: on a failed fetch, previous local progress is carried over
      // per exercise id so a refresh never wipes known points or passed flags.
      const progressRes = await langs.getMoocCourseProgress(courseData.data.id, {
        forceRefresh: true,
      })
      if (progressRes.err) {
        Logger.warn("Failed to fetch mooc course progress", progressRes.val)
      }
      const next = toStoredMoocCourse(
        moocCourse,
        slides,
        progressRes.ok ? progressRes.val : undefined,
        courseData.data,
      )
      return Ok(makeMoocKind(next))
    },
  )
  if (refreshed.err) {
    return refreshed
  }
  const course = refreshed.val
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

  return Ok(true)
}

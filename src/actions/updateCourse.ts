import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type Dialog from "../api/dialog"
import { ConnectionError, ForbiddenError, InsufficientScopeError } from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import type { CombinedCourseData, MoocCourse, TmcExerciseSlide } from "../shared/langsSchema"
import type { BackendKind, Enum, ExerciseIdentifier, LocalCourseExercise } from "../shared/shared"
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

const postCourseStatusMessage = (
  id: CourseIdentifier,
  disabled: boolean,
  exerciseIds: ExerciseIdentifier[],
): void => {
  TmcPanel.postMessage(
    {
      type: "setNewExercises",
      target: {
        type: "MyCourses",
      },
      courseId: id,
      exerciseIds,
    },
    {
      type: "setCourseDisabledStatus",
      target: {
        type: "CourseDetails",
      },
      courseId: id,
      disabled,
    },
  )
}

interface RefreshedCourse {
  course: LocalCourseData
  exercises: LocalCourseExercise[]
}

/**
 * The stored course and the refetched data are looked up by the same id, so this
 * only guards the narrowing the projections need.
 */
function mismatchedBackend(courseId: CourseIdentifier, expected: BackendKind): Error {
  return new Error(
    `Expected stored course ${CourseIdentifier.toString(courseId)} to be a ${expected} course`,
  )
}

let insufficientScopeReported = false

/**
 * Tells the user their session has to be renewed, and stays quiet until one is.
 *
 * `updateCourse` runs once per course and from a half-hourly background poll, so an
 * unguarded dialog would repeat for every course on every refresh.
 */
function reportInsufficientScope(dialog: Dialog, error: InsufficientScopeError): void {
  if (insufficientScopeReported) {
    return
  }
  insufficientScopeReported = true
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
  const { dialog } = actionContext
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
      reportInsufficientScope(dialog, updateResult.val)
      return Ok(false)
    }
    if (updateResult.val instanceof ForbiddenError) {
      const courseIdent = LocalCourseData.getCourseId(courseData)
      if (!courseData.data.disabled) {
        Logger.warn(`Failed to access information for course. Marking as disabled.`)
        courseData.data.disabled = true
        const disableResult = await userData.updateCourse(courseData)
        if (disableResult.err) {
          return disableResult
        }
      } else {
        Logger.warn(`ForbiddenError above probably caused by course still being disabled`)
      }
      postCourseStatusMessage(courseIdent, true, [])
      return Ok(false)
    } else if (updateResult.val instanceof ConnectionError) {
      Logger.warn(`Failed to fetch data from ${backendName(courseId.kind)}, data not updated.`)
      return Ok(false)
    }
    return updateResult
  }

  // `updateExercises` finds the new exercises by diffing against the stored list,
  // so the course is stored with its old list and the fresh one goes in after.
  const refreshed = await match(
    updateResult.val,
    async (tmc): Promise<Result<RefreshedCourse, Error>> => {
      if (courseData.kind !== "tmc") {
        return Err(mismatchedBackend(courseId, "tmc"))
      }
      const next = toStoredTmcCourse(tmc, courseData.data.organization, courseData.data)
      return Ok({
        course: makeTmcKind({ ...next, exercises: courseData.data.exercises }),
        exercises: next.exercises.map((x) => makeTmcKind(x)),
      })
    },
    async ([moocCourse, slides]): Promise<Result<RefreshedCourse, Error>> => {
      // The fetch the session was refused before has now gone through, so the next
      // lapse is worth telling the user about again.
      insufficientScopeReported = false
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
      return Ok({
        course: makeMoocKind({ ...next, exercises: courseData.data.exercises }),
        exercises: next.exercises.map((x) => makeMoocKind(x)),
      })
    },
  )
  if (refreshed.err) {
    return refreshed
  }
  const stored = await userData.updateCourse(refreshed.val.course)
  if (stored.err) {
    return stored
  }
  const updateExercisesResult = await userData.updateExercises(courseId, refreshed.val.exercises)
  if (updateExercisesResult.err) {
    return updateExercisesResult
  }

  // `updateExercises` mutated this same stored object, so it is already current.
  const course = refreshed.val.course
  const courseName = LocalCourseData.getCourseName(course)
  if (
    courseName === workspaceManager.activeCourse &&
    course.kind === workspaceManager.activeCourseBackend
  ) {
    exerciseDecorationProvider.updateDecorationsForExercises(
      ...workspaceManager.getExercisesByCourseSlug(course.kind, courseName),
    )
  }

  postCourseStatusMessage(
    LocalCourseData.getCourseId(course),
    course.data.disabled,
    LocalCourseData.getNewExercises(course),
  )

  return Ok(true)
}

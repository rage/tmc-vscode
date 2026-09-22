import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type Dialog from "../api/dialog"
import {
  ConnectionError,
  ForbiddenError,
  InitializationError,
  InsufficientScopeError,
} from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import type { CombinedCourseData, MoocCourse, TmcExerciseSlide } from "../shared/langsSchema"
import type { CourseIdentifier, Enum, ExerciseIdentifier } from "../shared/shared"
import { backendName, LocalCourseData, makeMoocKind, makeTmcKind, match } from "../shared/shared"
import { Logger } from "../utilities"
import {
  combineMoocApiExerciseData,
  combineTmcApiExerciseData,
  sumCoursePoints,
  sumTmcApiCoursePoints,
} from "../utilities/apiData"
import type { ActionContext } from "./types"

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
  actionContext: ActionContext,
  courseId: CourseIdentifier,
): Promise<Result<boolean, Error>> {
  const { dialog, exerciseDecorationProvider, langs, userData, workspaceManager } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok && exerciseDecorationProvider.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info("Updating course")

  const storedCourse = userData.val.getCourse(courseId)
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
      langs.val
        .getTmcCourseData(tmcId.courseId, { forceRefresh: true })
        .then((res) => res.map((x) => makeTmcKind(x))),
    (moocId) =>
      langs.val
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
        const disableResult = await userData.val.updateCourse(courseData)
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

  const updateExercisesResult = await match(
    updateResult.val,
    async (tmc) => {
      const { details, exercises, settings } = tmc
      const { availablePoints, awardedPoints } = sumTmcApiCoursePoints(exercises)

      courseData.data = {
        ...courseData.data,
        availablePoints,
        awardedPoints,
        description: details.description || "",
        disabled: settings.disabled_status !== "enabled",
        materialUrl: settings.material_url,
        perhapsExamMode: settings.hide_submission_results,
      }
      const stored = await userData.val.updateCourse(courseData)
      if (stored.err) {
        return stored
      }

      return await userData.val.updateExercises(
        courseId,
        combineTmcApiExerciseData(details.exercises, exercises).map((x) => makeTmcKind(x)),
      )
    },
    async (mooc) => {
      // The fetch the session was refused before has now gone through, so the next
      // lapse is worth telling the user about again.
      insufficientScopeReported = false
      const [moocCourse, slides] = mooc
      // The update result and the stored course are looked up from the same
      // `courseId`, so this holds by construction; assert it to narrow the stored
      // data off its tmc|mooc union before the mooc-shaped reads and writes below.
      if (courseData.kind !== "mooc") {
        return Err(
          new Error(`Expected stored course ${moocCourse.id} to be a mooc course but it was tmc`),
        )
      }
      // Non-fatal: on a failed fetch, previous local progress is carried over
      // per exercise id so a refresh never wipes known points or passed flags.
      const progressRes = await langs.val.getMoocCourseProgress(courseData.data.id, {
        forceRefresh: true,
      })
      if (progressRes.err) {
        Logger.warn("Failed to fetch mooc course progress", progressRes.val)
      }
      const previousExercises = courseData.data.exercises
      const localExercises = combineMoocApiExerciseData(
        slides,
        progressRes.ok ? progressRes.val : undefined,
        previousExercises,
      )

      const { availablePoints, awardedPoints } = sumCoursePoints(localExercises)
      courseData.data = {
        ...courseData.data,
        availablePoints,
        awardedPoints,
        // Refresh the metadata the backend can change, mirroring what the tmc arm
        // does. `materialUrl` and `perhapsExamMode` have no mooc equivalent (see
        // `zMoocCourse`), so there is genuinely nothing to do for them here.
        //
        // mooc has no disabled state either, so this clears rather than refreshes:
        // a flag left in stored data would otherwise never be lifted.
        disabled: false,
        //
        // `name` (the slug) is deliberately NOT refreshed: it is the workspace
        // folder name and the key for closed-exercise settings and exercise
        // lookups, so adopting a renamed slug here would desync those from disk
        // without the accompanying move.
        description: moocCourse.description,
        title: moocCourse.name,
        organization: moocCourse.organization_name,
      }
      const stored = await userData.val.updateCourse(courseData)
      if (stored.err) {
        return stored
      }

      return await userData.val.updateExercises(
        courseId,
        localExercises.map((x) => makeMoocKind(x)),
      )
    },
  )
  if (updateExercisesResult.err) {
    return updateExercisesResult
  }

  const courseName = LocalCourseData.getCourseName(courseData)
  if (
    courseName === workspaceManager.val.activeCourse &&
    courseData.kind === workspaceManager.val.activeCourseBackend
  ) {
    exerciseDecorationProvider.val.updateDecorationsForExercises(
      ...workspaceManager.val.getExercisesByCourseSlug(courseData.kind, courseName),
    )
  }

  // Reading the course back would hand out this same object: `userData` stores the
  // value given to `updateCourse`, and `updateExercises` mutates it in place.
  postCourseStatusMessage(
    LocalCourseData.getCourseId(courseData),
    courseData.data.disabled,
    LocalCourseData.getNewExercises(courseData),
  )

  return Ok(true)
}

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { ConnectionError, ForbiddenError, InitializationError } from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import type { CombinedCourseData, CourseInstance, TmcExerciseSlide } from "../shared/langsSchema"
import type { CourseIdentifier, Enum, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData, makeMoocKind, makeTmcKind, match } from "../shared/shared"
import { Logger } from "../utilities"
import {
  combineMoocApiExerciseData,
  combineTmcApiExerciseData,
  sumMoocCoursePoints,
} from "../utilities/apiData"
import { refreshLocalExercises } from "./refreshLocalExercises"
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

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * @param courseId ID of the course to update.
 * @returns Boolean value representing whether the data from server was successfully received.
 */
export async function updateCourse(
  actionContext: ActionContext,
  courseId: CourseIdentifier,
): Promise<Result<boolean, Error>> {
  const { exerciseDecorationProvider, langs, userData, workspaceManager } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok && exerciseDecorationProvider.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info("Updating course")

  const courseData = userData.val.getCourse(courseId)
  const updateResult: Result<
    Enum<CombinedCourseData, [CourseInstance, TmcExerciseSlide[]]>,
    Error
  > = await match(
    courseId,
    (tmcId) =>
      langs.val
        .getTmcCourseData(tmcId.courseId, { forceRefresh: true })
        .then((res) => res.map((x) => makeTmcKind(x))),
    (moocId) =>
      langs.val
        .getMoocCourseInstanceData(moocId.instanceId, { forceRefresh: true })
        .then((res) => res.map((x) => makeMoocKind(x))),
  )
  if (updateResult.err) {
    if (updateResult.val instanceof ForbiddenError) {
      const course = userData.val.getCourse(courseId)
      const courseIdent = LocalCourseData.getCourseId(course)
      if (!courseData.data.disabled) {
        Logger.warn(`Failed to access information for course. Marking as disabled.`)
        course.data.disabled = true
        await userData.val.updateCourse(course)
        postCourseStatusMessage(courseIdent, true, [])
      } else {
        Logger.warn(`ForbiddenError above probably caused by course still being disabled`)
        postCourseStatusMessage(courseIdent, true, [])
      }
      return Ok(false)
    } else if (updateResult.val instanceof ConnectionError) {
      Logger.warn("Failed to fetch data from TMC servers, data not updated.")
      return Ok(false)
    }
    return updateResult
  }

  const updateExercisesResult = await match(
    updateResult.val,
    async (tmc) => {
      const { details, exercises, settings } = tmc
      const [availablePoints, awardedPoints] = exercises.reduce(
        (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
        [0, 0],
      )

      courseData.data = {
        ...courseData.data,
        availablePoints,
        awardedPoints,
        description: details.description || "",
        disabled: settings.disabled_status !== "enabled",
        materialUrl: settings.material_url,
        perhapsExamMode: settings.hide_submission_results,
      }
      await userData.val.updateCourse(courseData)

      return await userData.val.updateExercises(
        courseId,
        combineTmcApiExerciseData(details.exercises, exercises).map((x) => makeTmcKind(x)),
      )
    },
    async (mooc) => {
      const [moocCourse, slides] = mooc
      // The update result and the stored course are looked up from the same
      // `courseId`, so this holds by construction; assert it to narrow the stored
      // data off its tmc|mooc union before writing mooc-shaped fields below.
      if (courseData.kind !== "mooc") {
        return Err(
          new Error(`Expected stored course ${moocCourse.id} to be a mooc course but it was tmc`),
        )
      }
      // Non-fatal: on a failed fetch, previous local progress is carried over
      // per exercise id so a refresh never wipes known points or passed flags.
      const progressRes = await match(
        courseId,
        async () => Err<Error>(new Error("not a mooc course")),
        (moocId) => langs.val.getMoocCourseProgress(moocId.instanceId),
      )
      if (progressRes.err) {
        Logger.warn("Failed to fetch mooc course progress", progressRes.val)
      }
      const previousExercises = courseData.data.exercises
      // One local exercise per slide, keyed by the slide's exercise id (a UUID).
      // The bulk download/update CLI subcommand resolves `--exercise-id` against
      // `slide.exercise_id`, so the exercise id (not the task id) is the identity
      // the extension must carry.
      const localExercises = combineMoocApiExerciseData(
        slides,
        progressRes.ok ? progressRes.val : undefined,
        previousExercises,
      )

      const { availablePoints, awardedPoints } = sumMoocCoursePoints(localExercises)
      courseData.data = {
        ...courseData.data,
        availablePoints,
        awardedPoints,
        // Refresh the metadata the backend can change, mirroring what the tmc arm
        // does. `disabled`, `materialUrl` and `perhapsExamMode` have no mooc
        // equivalent (see `zMoocCourse`), so they are genuinely nothing to do here.
        //
        // `name` (the slug) is deliberately NOT refreshed: it is the workspace
        // folder name and the key for closed-exercise settings and exercise
        // lookups, so adopting a renamed slug here would desync those from disk
        // without the accompanying move.
        description: moocCourse.description,
        title: moocCourse.name,
        organization: moocCourse.organization_name,
      }
      await userData.val.updateCourse(courseData)

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
      ...workspaceManager.val.getExercisesByCourseSlug(courseName),
    )
  }

  // refresh local exercises to ensure deleted exercises don't appear open etc.
  await refreshLocalExercises(actionContext)

  const course = userData.val.getCourse(courseId)
  postCourseStatusMessage(
    LocalCourseData.getCourseId(course),
    course.data.disabled,
    LocalCourseData.getNewExercises(course),
  )

  return Ok(true)
}

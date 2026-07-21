import type { Result } from "ts-results"
import { Err } from "ts-results"

import { InitializationError } from "../errors"
import { CourseIdentifier, match } from "../shared/shared"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../storage/data"
import { Logger } from "../utilities"
import {
  combineMoocApiExerciseData,
  combineTmcApiExerciseData,
  sumMoocCoursePoints,
} from "../utilities/apiData"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ActionContext } from "./types"

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(
  actionContext: ActionContext,
  organizationSlug: string,
  course: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { langs, ui, userData, workspaceManager } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info("Adding new course")

  return match(
    course,
    async (tmcCourse) => {
      const courseDataResult = await langs.val.getTmcCourseData(tmcCourse.courseId)
      if (courseDataResult.err) {
        return courseDataResult
      }
      const courseData = courseDataResult.val

      let availablePoints = 0
      let awardedPoints = 0
      courseData.exercises.forEach((x) => {
        availablePoints += x.available_points.length
        awardedPoints += x.awarded_points.length
      })

      const localData: TmcLocalCourseData = {
        description: courseData.details.description || "",
        exercises: combineTmcApiExerciseData(courseData.details.exercises, courseData.exercises),
        id: courseData.details.id,
        name: courseData.details.name,
        title: courseData.details.title,
        organization: organizationSlug,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
        perhapsExamMode: courseData.settings.hide_submission_results,
        newExercises: [],
        notifyAfter: 0,
        disabled: courseData.settings.disabled_status !== "enabled",
        materialUrl: courseData.settings.material_url,
      }
      userData.val.addCourse({ kind: "tmc", data: localData })
      ui.treeDP.addChildWithId("myCourses", localData.id, localData.title, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [CourseIdentifier.from(localData.id)],
      })
      workspaceManager.val.createWorkspaceFile(courseData.details.name, "tmc")
      return refreshLocalExercises(actionContext)
    },
    async (mooc) => {
      // mooc has no course-instance concept: the identifier is the course id,
      // and the CLI call returns the course itself.
      const courseRes = await langs.val.getMoocCourseInstanceData(mooc.instanceId)
      if (courseRes.err) {
        return courseRes
      }
      const [moocCourse, slides] = courseRes.val

      // Non-fatal: a failed fetch just starts the course with zeroed progress.
      const progressRes = await langs.val.getMoocCourseProgress(mooc.instanceId)
      if (progressRes.err) {
        Logger.warn("Failed to fetch mooc course progress", progressRes.val)
      }

      // One local exercise per slide, keyed by the slide's exercise id (a UUID).
      // The bulk download/update CLI subcommand resolves `--exercise-id` against
      // `slide.exercise_id`, so the exercise id (not the task id) is the identity
      // the extension must carry.
      const exercises = combineMoocApiExerciseData(
        slides,
        progressRes.ok ? progressRes.val : undefined,
      )
      const { availablePoints, awardedPoints } = sumMoocCoursePoints(exercises)

      const localData: MoocLocalCourseData = {
        id: moocCourse.id,
        name: moocCourse.slug,
        description: moocCourse.description,
        title: moocCourse.name,
        organization: moocCourse.organization_name,
        awardedPoints,
        availablePoints,
        disabled: false,
        materialUrl: null,
        exercises,
        newExercises: [],
        notifyAfter: 0,
        perhapsExamMode: false,
      }
      // A duplicate enrollment of the same course can surface twice from the
      // backend, and re-adding an already-added course id throws; fail gracefully
      // instead of crashing the add flow.
      try {
        userData.val.addCourse({ kind: "mooc", data: localData })
      } catch (e) {
        return Err(e instanceof Error ? e : new Error(String(e)))
      }
      ui.treeDP.addChildWithId("myCourses", localData.id, localData.name, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [CourseIdentifier.from(localData.id)],
      })
      workspaceManager.val.createWorkspaceFile(moocCourse.slug, "mooc")
      return refreshLocalExercises(actionContext)
    },
  )
}

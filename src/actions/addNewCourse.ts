import type { Result } from "ts-results"
import { Err } from "ts-results"

import { InitializationError } from "../errors"
import type { CourseIdentifier } from "../shared/shared"
import { match } from "../shared/shared"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../storage/data"
import { Logger } from "../utilities"
import {
  combineMoocApiExerciseData,
  combineTmcApiExerciseData,
  sumCoursePoints,
  sumTmcApiCoursePoints,
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

      const { availablePoints, awardedPoints } = sumTmcApiCoursePoints(courseData.exercises)

      const localData: TmcLocalCourseData = {
        description: courseData.details.description || "",
        exercises: combineTmcApiExerciseData(courseData.details.exercises, courseData.exercises),
        id: courseData.details.id,
        name: courseData.details.name,
        title: courseData.details.title,
        organization: organizationSlug,
        availablePoints,
        awardedPoints,
        perhapsExamMode: courseData.settings.hide_submission_results,
        newExercises: [],
        notifyAfter: 0,
        disabled: courseData.settings.disabled_status !== "enabled",
        materialUrl: courseData.settings.material_url,
      }
      const addResult = await userData.val.addCourse({ kind: "tmc", data: localData })
      if (addResult.err) {
        return addResult
      }
      ui.treeDP.refresh()
      await workspaceManager.val.createWorkspaceFile(courseData.details.name, "tmc")
      return refreshLocalExercises(actionContext)
    },
    async (mooc) => {
      // mooc has no course-instance concept: the identifier is the course id,
      // and the CLI call returns the course itself.
      const courseRes = await langs.val.getMoocCourseData(mooc.instanceId)
      if (courseRes.err) {
        return courseRes
      }
      const [moocCourse, slides] = courseRes.val

      // Non-fatal: a failed fetch just starts the course with zeroed progress.
      const progressRes = await langs.val.getMoocCourseProgress(mooc.instanceId)
      if (progressRes.err) {
        Logger.warn("Failed to fetch mooc course progress", progressRes.val)
      }

      const exercises = combineMoocApiExerciseData(
        slides,
        progressRes.ok ? progressRes.val : undefined,
      )
      const { availablePoints, awardedPoints } = sumCoursePoints(exercises)

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
      // backend, so an already-added course id is a plausible input here.
      const addResult = await userData.val.addCourse({ kind: "mooc", data: localData })
      if (addResult.err) {
        return addResult
      }
      ui.treeDP.refresh()
      await workspaceManager.val.createWorkspaceFile(moocCourse.slug, "mooc")
      return refreshLocalExercises(actionContext)
    },
  )
}

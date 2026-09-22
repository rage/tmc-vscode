import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData, makeMoocKind, makeTmcKind, match } from "../shared/shared"
import { Logger } from "../utilities"
import { toStoredMoocCourse, toStoredTmcCourse } from "../utilities/apiData"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Adds a new course to user's courses, and tells an open My Courses panel.
 *
 * @param organizationSlug The tmc organization the course was picked from;
 *   ignored for a mooc course, which carries its own.
 */
export async function addNewCourse(
  actionContext: ReadyActionContext,
  organizationSlug: string,
  course: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { ui } = actionContext
  const { langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Adding new course")

  const fetched = await match(
    course,
    async (tmcCourse): Promise<Result<LocalCourseData, Error>> => {
      const courseData = await langs.getTmcCourseData(tmcCourse.courseId)
      return courseData.map((x) => makeTmcKind(toStoredTmcCourse(x, organizationSlug)))
    },
    async (mooc): Promise<Result<LocalCourseData, Error>> => {
      const courseRes = await langs.getMoocCourseData(mooc.instanceId)
      if (courseRes.err) {
        return courseRes
      }
      const [moocCourse, slides] = courseRes.val

      // Non-fatal: a failed fetch just starts the course with zeroed progress.
      const progressRes = await langs.getMoocCourseProgress(mooc.instanceId)
      if (progressRes.err) {
        Logger.warn("Failed to fetch mooc course progress", progressRes.val)
      }
      return Ok(
        makeMoocKind(
          toStoredMoocCourse(moocCourse, slides, progressRes.ok ? progressRes.val : undefined),
        ),
      )
    },
  )
  if (fetched.err) {
    return fetched
  }

  // A duplicate enrollment of the same mooc course can surface twice from the
  // backend, so an already-added course id is a plausible input here.
  const addResult = await userData.addCourse(fetched.val)
  if (addResult.err) {
    return addResult
  }
  ui.treeDP.refresh()
  TmcPanel.postMessage({
    type: "setMyCourses",
    target: { type: "MyCourses" },
    courses: userData.getCourses(),
  })
  await workspaceManager.createWorkspaceFile(
    LocalCourseData.getCourseName(fetched.val),
    fetched.val.kind,
  )
  return refreshLocalExercises(actionContext)
}

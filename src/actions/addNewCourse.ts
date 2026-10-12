import type { Result } from "ts-results"

import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData, makeMoocKind, makeTmcKind, match } from "../shared/shared"
import { Logger } from "../utilities"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"
import { fetchStoredCourse } from "./updateCourse"

/**
 * Adds a new course to user's courses and shows it in the Courses view.
 *
 * @param organizationSlug The tmc organization the course was picked from;
 *   ignored for a mooc course, which carries its own.
 */
export async function addNewCourse(
  actionContext: ReadyActionContext,
  organizationSlug: string,
  course: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Adding new course")

  const fetched = await fetchStoredCourse(
    langs,
    match(
      course,
      (tmc) => makeTmcKind({ courseId: tmc.courseId, organization: organizationSlug }),
      (mooc) => makeMoocKind({ courseId: mooc.instanceId }),
    ),
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
  await workspaceManager.createWorkspaceFile(
    LocalCourseData.getCourseName(fetched.val),
    fetched.val.kind,
  )
  return refreshLocalExercises(actionContext)
}

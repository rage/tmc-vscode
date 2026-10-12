import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import type { ReadyActionContext } from "./types"

/**
 * Closes given exercises, hiding them from the course workspace.
 *
 * @returns the ids of the given exercises that are on disk.
 */
export async function closeExercises(
  actionContext: ReadyActionContext,
  ids: ExerciseIdentifier[],
  courseId: CourseIdentifier,
): Promise<Result<ExerciseIdentifier[], Error>> {
  const { userData, workspaceManager } = actionContext.startup

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const closeResult = await workspaceManager.closeCourseExercises(
    course.kind,
    LocalCourseData.getCourseName(course),
    ids,
  )
  if (closeResult.err) {
    return closeResult
  }
  return new Ok(closeResult.val.map((exercise) => exercise.id))
}

import { compact } from "lodash"
import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier, ExtensionToWebview } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise } from "../shared/shared"
import type { ReadyActionContext } from "./types"

/**
 * Closes given exercises, hiding them from the course workspace.
 * @param ids Array of exercise IDs
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
  const exercises = new Map(LocalCourseData.getExercises(course).map((x) => [x.data.id, x]))
  const exerciseSlugs = compact(
    ids.map((x) => {
      const exercise = exercises.get(ExerciseIdentifier.unwrap(x))
      if (!exercise) {
        return undefined
      }
      // The workspace manager expects a slug, not the mooc exercise's raw uuid id.
      return LocalCourseExercise.getSlug(exercise)
    }),
  )

  const courseName = LocalCourseData.getCourseName(course)
  const closeResult = await workspaceManager.closeCourseExercises(
    course.kind,
    courseName,
    exerciseSlugs,
  )
  if (closeResult.err) {
    return closeResult
  }

  const slugToId = new Map(
    Array.from(exercises.entries(), ([key, val]) => [
      LocalCourseExercise.getSlug(val),
      ExerciseIdentifier.from(key),
    ]),
  )
  const closedIds = closeResult.val
    .map((exercise) => slugToId.get(exercise.exerciseSlug))
    .filter((e) => e !== undefined)

  TmcPanel.postMessage(
    ...closedIds.map<ExtensionToWebview>((id) => ({
      type: "exerciseStatusChange",
      courseId,
      exerciseId: id,
      status: "closed",
      target: {
        type: "CourseDetails",
      },
    })),
  )

  return new Ok(closedIds)
}

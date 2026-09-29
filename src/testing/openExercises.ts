import type WorkspaceManager from "../api/workspaceManager"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseStatus } from "../api/workspaceManager"

/** The open course workspace's exercises that are open in it; none outside a course workspace. */
export function openCourseExercises(
  workspaceManager: Pick<
    WorkspaceManager,
    "activeCourse" | "activeCourseBackend" | "getExercisesByCourseSlug"
  >,
): WorkspaceExercise[] {
  const { activeCourse, activeCourseBackend } = workspaceManager
  if (activeCourse === undefined || activeCourseBackend === undefined) {
    return []
  }
  return workspaceManager
    .getExercisesByCourseSlug(activeCourseBackend, activeCourse)
    .filter((exercise) => exercise.status === ExerciseStatus.Open)
}

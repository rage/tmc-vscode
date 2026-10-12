import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"

export function idOfTmcExercise(tmcExerciseId: number): ExerciseIdentifier {
  return makeTmcKind({ tmcExerciseId })
}

export function idOfMoocExercise(moocExerciseId: string): ExerciseIdentifier {
  return makeMoocKind({ moocExerciseId })
}

export function idOfTmcCourse(courseId: number): CourseIdentifier {
  return makeTmcKind({ courseId })
}

export function idOfMoocCourse(moocCourseId: string): CourseIdentifier {
  return makeMoocKind({ instanceId: moocCourseId })
}

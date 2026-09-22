import {
  LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../config/constants"
import type {
  CourseExercise,
  Exercise,
  MoocCourseProgress,
  TmcExerciseSlide,
} from "../shared/langsSchema"
import type { MoocLocalCourseExercise, TmcLocalCourseExercise } from "../storage/data"

/**
 * Takes exercise arrays from two different endpoints and attempts to resolve them into
 * `LocalCourseExercise`. Uses common default values, if matching id is not found from
 * `courseExercises`.
 */
export function combineTmcApiExerciseData(
  exercises: Exercise[],
  courseExercises: CourseExercise[],
): TmcLocalCourseExercise[] {
  const exercisePointsMap = new Map(courseExercises.map((x) => [x.id, x]))
  return exercises.map<TmcLocalCourseExercise>((x) => {
    const match = exercisePointsMap.get(x.id)
    const passed = x.completed
    const awardedPointsFallback = passed
      ? LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER
      : LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER
    const localCourseExercise: TmcLocalCourseExercise = {
      id: x.id,
      availablePoints:
        match?.available_points.length ?? LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
      awardedPoints: match?.awarded_points.length ?? awardedPointsFallback,
      name: x.name,
      deadline: x.deadline,
      passed: x.completed,
      softDeadline: x.soft_deadline,
    }
    return localCourseExercise
  })
}

/**
 * Builds local mooc exercises from the course's exercise slides and the
 * user's per-exercise progress. When `progress` is unavailable (e.g. a
 * transient fetch failure), falls back to `previousExercises` per exercise id
 * so a refresh never wipes previously known points or passed flags.
 *
 * One local exercise per slide, keyed by `slide.exercise_id` (a UUID): the bulk
 * download/update CLI subcommand resolves `--exercise-id` against that field, not
 * the task id, so it is the identity callers must carry.
 */
export function combineMoocApiExerciseData(
  slides: TmcExerciseSlide[],
  progress: MoocCourseProgress | undefined,
  previousExercises: MoocLocalCourseExercise[] = [],
): MoocLocalCourseExercise[] {
  const progressById = new Map(progress?.exercises.map((x) => [x.exercise_id, x]) ?? [])
  const previousById = new Map(previousExercises.map((x) => [x.id, x]))
  return slides.map<MoocLocalCourseExercise>((slide) => {
    const exerciseProgress = progressById.get(slide.exercise_id)
    const previous = previousById.get(slide.exercise_id)
    return {
      id: slide.exercise_id,
      name: slide.exercise_name,
      deadline: slide.deadline,
      softDeadline: slide.deadline,
      passed: exerciseProgress?.completed ?? previous?.passed ?? false,
      availablePoints: exerciseProgress?.score_maximum ?? previous?.availablePoints ?? 0,
      awardedPoints: exerciseProgress?.score_given ?? previous?.awardedPoints ?? 0,
    }
  })
}

export interface CoursePoints {
  availablePoints: number
  awardedPoints: number
}

/** Sums per-exercise points into course totals; local exercises carry the same two fields on both backends. */
export function sumCoursePoints(exercises: readonly CoursePoints[]): CoursePoints {
  return exercises.reduce(
    (totals, exercise) => ({
      availablePoints: totals.availablePoints + exercise.availablePoints,
      awardedPoints: totals.awardedPoints + exercise.awardedPoints,
    }),
    { availablePoints: 0, awardedPoints: 0 },
  )
}

/**
 * Course totals straight from the tmc points endpoint. Summing the combined local
 * exercises instead would fold in `combineTmcApiExerciseData`'s placeholder points
 * for exercises that endpoint does not list.
 */
export function sumTmcApiCoursePoints(courseExercises: CourseExercise[]): CoursePoints {
  return sumCoursePoints(
    courseExercises.map((x) => ({
      availablePoints: x.available_points.length,
      awardedPoints: x.awarded_points.length,
    })),
  )
}

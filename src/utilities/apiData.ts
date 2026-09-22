import {
  LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../config/constants"
import type {
  CombinedCourseData,
  CourseExercise,
  Exercise,
  MoocCourse,
  MoocCourseProgress,
  TmcExerciseSlide,
} from "../shared/langsSchema"
import type {
  MoocLocalCourseData,
  MoocLocalCourseExercise,
  TmcLocalCourseData,
  TmcLocalCourseExercise,
} from "../storage/data"

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

/**
 * The stored form of a tmc course, for both adding it and refreshing it.
 *
 * @param organization Slug of the organization the course was picked from; the
 *   course data does not carry it, so a refresh passes the stored one.
 * @param previous The stored course being refreshed. Its `name`, `newExercises`
 *   and `notifyAfter` are kept; every other field is rebuilt, so a refresh and an
 *   add of the same payload agree.
 */
export function toStoredTmcCourse(
  courseData: CombinedCourseData,
  organization: string,
  previous?: TmcLocalCourseData,
): TmcLocalCourseData {
  const { details, exercises, settings } = courseData
  return {
    id: details.id,
    // The slug names the workspace folder and keys exercises on disk, so a
    // renamed course keeps its old one.
    name: previous?.name ?? details.name,
    title: details.title,
    description: details.description || "",
    organization,
    exercises: combineTmcApiExerciseData(details.exercises, exercises),
    ...sumTmcApiCoursePoints(exercises),
    perhapsExamMode: settings.hide_submission_results,
    newExercises: previous?.newExercises ?? [],
    notifyAfter: previous?.notifyAfter ?? 0,
    disabled: settings.disabled_status !== "enabled",
    materialUrl: settings.material_url,
  }
}

/**
 * The stored form of a courses.mooc.fi course, for both adding it and refreshing it.
 *
 * @param progress `undefined` when its fetch failed: exercises then keep
 *   `previous`'s points and passed flags, or start at zero on an add.
 * @param previous The stored course being refreshed. Its `name`, `newExercises`
 *   and `notifyAfter` are kept; every other field is rebuilt, so a refresh and an
 *   add of the same payload agree. Unlike tmc, `organization` is the course's own.
 */
export function toStoredMoocCourse(
  course: MoocCourse,
  slides: TmcExerciseSlide[],
  progress: MoocCourseProgress | undefined,
  previous?: MoocLocalCourseData,
): MoocLocalCourseData {
  const exercises = combineMoocApiExerciseData(slides, progress, previous?.exercises)
  return {
    id: course.id,
    // See `toStoredTmcCourse`: the slug is the on-disk key.
    name: previous?.name ?? course.slug,
    title: course.name,
    description: course.description,
    organization: course.organization_name,
    exercises,
    ...sumCoursePoints(exercises),
    // courses.mooc.fi has no exam mode, course material link or disabled state.
    perhapsExamMode: false,
    materialUrl: null,
    disabled: false,
    newExercises: previous?.newExercises ?? [],
    notifyAfter: previous?.notifyAfter ?? 0,
  }
}

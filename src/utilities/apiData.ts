import type {
  CombinedCourseData,
  CombinedMoocCourseData,
  CourseExercise,
  Exercise,
  ExerciseProgress,
  CourseProgress,
  TmcExerciseSlide,
} from "../../shared/langsSchema"
import type { MoocClosedChapter } from "../../shared/lib"
import {
  LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../config/constants"
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
      ...(x.attempted ? { attempted: true } : {}),
      softDeadline: x.soft_deadline,
    }
    return localCourseExercise
  })
}

/**
 * Builds local mooc exercises from the course's slides and the user's per-exercise progress.
 * An exercise `progress` does not list keeps its `previousExercises` points and flags.
 *
 * One local exercise per slide, keyed by `slide.exercise_id`: the bulk download/update CLI
 * subcommand resolves `--exercise-id` against that field, not the task id.
 */
export function combineMoocApiExerciseData(
  slides: TmcExerciseSlide[],
  progress: CourseProgress,
  previousExercises: MoocLocalCourseExercise[] = [],
): MoocLocalCourseExercise[] {
  const progressById = new Map(progress.exercises.map((x) => [x.exercise_id, x]))
  const previousById = new Map(previousExercises.map((x) => [x.id, x]))
  return slides.map<MoocLocalCourseExercise>((slide) => {
    const exerciseProgress = progressById.get(slide.exercise_id)
    const previous = previousById.get(slide.exercise_id)
    const lockingStatus = slide.chapter?.locking_status
    return {
      id: slide.exercise_id,
      name: slide.exercise_name,
      deadline: slide.deadline,
      ...moocStoredStanding(exerciseProgress, previous),
      ...storedPoints(exerciseProgress, previous),
      ...(slide.chapter
        ? {
            chapter: {
              name: slide.chapter.name,
              number: slide.chapter.chapter_number,
              ...(lockingStatus ? { lockingStatus } : {}),
            },
          }
        : {}),
      ...(slide.page_url ? { pageUrl: slide.page_url } : {}),
      ...(slide.unsupported ? { browserOnly: true } : {}),
      ...instructionsOf(slide),
      ...(slide.tasks.some((task) => task.model_solution_spec !== null)
        ? { hasModelSolution: true }
        : {}),
      ...reviewOf(exerciseProgress),
    }
  })
}

/** The plain text of the slide's task instructions, one paragraph per block. */
function instructionsOf(slide: TmcExerciseSlide): Pick<MoocLocalCourseExercise, "instructions"> {
  const paragraphs = slide.tasks.flatMap((task) => task.instructions_text ?? [])
  return paragraphs.length > 0 ? { instructions: paragraphs } : {}
}

function reviewOf(
  progress: ExerciseProgress | undefined,
): Pick<MoocLocalCourseExercise, "reviewingStage" | "teacherReview"> {
  const stage = progress?.reviewing_stage
  const review = progress?.teacher_review
  return {
    ...(stage ? { reviewingStage: stage } : {}),
    ...(review
      ? {
          teacherReview: {
            decision: review.decision,
            justification: review.justification,
            scoreGiven: review.score_given,
            createdAt: review.created_at,
          },
        }
      : {}),
  }
}

function storedPoints(
  progress: ExerciseProgress | undefined,
  previous: Pick<MoocLocalCourseExercise, "availablePoints" | "awardedPoints"> | undefined,
): Pick<MoocLocalCourseExercise, "availablePoints" | "awardedPoints"> {
  return {
    availablePoints: progress?.score_maximum ?? previous?.availablePoints ?? 0,
    awardedPoints: progress?.score_given ?? previous?.awardedPoints ?? 0,
  }
}

/**
 * The course's chapters that have not opened yet, each exercise as `previousExercises` last
 * stored it with the points `progress` reports now.
 */
export function combineMoocClosedChapters(
  progress: CourseProgress,
  previousExercises: MoocLocalCourseExercise[] = [],
): MoocClosedChapter[] {
  const previousById = new Map(previousExercises.map((x) => [x.id, x]))
  return progress.closed_chapters.map((chapter) => ({
    name: chapter.name,
    number: chapter.chapter_number,
    opensAt: chapter.opens_at,
    exercises: chapter.exercises.map((exerciseProgress) => {
      const previous = previousById.get(exerciseProgress.exercise_id)
      return {
        ...(previous ?? { name: "", deadline: null }),
        id: exerciseProgress.exercise_id,
        ...moocStoredStanding(exerciseProgress, previous),
        ...storedPoints(exerciseProgress, previous),
      }
    }),
  }))
}

/** A mooc exercise's stored standing, tries and review state, as the backend decides them. */
export interface MoocStoredStanding {
  passed: boolean
  /** Absent means no. */
  attempted?: boolean
  outOfTries: boolean
  /** Absent means unlimited. */
  maxTries?: number
  /** Absent means unlimited. */
  triesLeft?: number
  /** Absent when no review is pending. */
  pendingReview?: NonNullable<ExerciseProgress["pending_teacher_review"]>
  /** Absent means no. */
  exerciseLocked?: boolean
}

/**
 * The stored standing, tries and review state `progress` sets. Keeps `previous`'s, else none,
 * when the backend sent no progress; keeps its `passed` and `outOfTries` when it sent no
 * standing, as a host that predates it does.
 */
export function moocStoredStanding(
  progress: ExerciseProgress | undefined,
  previous?: Pick<
    MoocLocalCourseExercise,
    | "passed"
    | "attempted"
    | "outOfTries"
    | "maxTries"
    | "triesLeft"
    | "pendingReview"
    | "exerciseLocked"
  >,
): MoocStoredStanding {
  const isAttempted = progress ? progress.attempted : previous?.attempted === true
  const triesAndReview = progress
    ? {
        ...(progress.max_tries === null ? {} : { maxTries: progress.max_tries }),
        ...(progress.tries_left === null ? {} : { triesLeft: progress.tries_left }),
        ...(progress.pending_teacher_review === null
          ? {}
          : { pendingReview: progress.pending_teacher_review }),
        ...(progress.exercise_locked ? { exerciseLocked: true } : {}),
      }
    : {
        ...(previous?.maxTries === undefined ? {} : { maxTries: previous.maxTries }),
        ...(previous?.triesLeft === undefined ? {} : { triesLeft: previous.triesLeft }),
        ...(previous?.pendingReview === undefined ? {} : { pendingReview: previous.pendingReview }),
        ...(previous?.exerciseLocked ? { exerciseLocked: true } : {}),
      }
  const attempted = isAttempted ? { attempted: true } : {}
  if (!progress?.standing) {
    return {
      passed: previous?.passed ?? false,
      ...attempted,
      outOfTries: previous?.outOfTries ?? false,
      ...triesAndReview,
    }
  }
  return {
    passed: progress.standing === "Passed",
    ...attempted,
    outOfTries: progress.standing === "OutOfTries",
    ...triesAndReview,
  }
}

export interface CoursePoints {
  availablePoints: number
  awardedPoints: number
}

/** Sums per-exercise points into course totals; both backends' local exercises carry the fields. */
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
 * Course totals straight from the tmc points endpoint; summing the combined local exercises
 * would fold in `combineTmcApiExerciseData`'s placeholder points for unlisted exercises.
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
 * @param organization Slug of the organization the course was picked from; the course data
 *   does not carry it, so a refresh passes the stored one.
 * @param previous The stored course being refreshed. Its `name`, `newExercises` and
 *   `notifyAfter` are kept; the rest is rebuilt, so a refresh and an add of one payload agree.
 */
export function toStoredTmcCourse(
  courseData: CombinedCourseData,
  organization: string,
  previous?: TmcLocalCourseData,
): TmcLocalCourseData {
  const { details, exercises, settings } = courseData
  return {
    id: details.id,
    // The slug names the workspace folder and keys exercises on disk, so a renamed course keeps it.
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
 * @param previous The stored course being refreshed; kept and rebuilt fields as in
 *   {@link toStoredTmcCourse}, except that `organization` is the course's own.
 */
export function toStoredMoocCourse(
  { course, slides, progress }: CombinedMoocCourseData,
  previous?: MoocLocalCourseData,
): MoocLocalCourseData {
  const previousExercises = [
    ...(previous?.exercises ?? []),
    ...(previous?.closedChapters ?? []).flatMap((chapter) => chapter.exercises),
  ]
  const exercises = combineMoocApiExerciseData(slides, progress, previousExercises)
  const closedChapters = combineMoocClosedChapters(progress, previousExercises)
  return {
    id: course.id,
    // See `toStoredTmcCourse`: the slug is the on-disk key.
    name: previous?.name ?? course.slug,
    title: course.name,
    description: course.description,
    organization: course.organization_name,
    aiPolicy: course.ai_policy,
    exercises,
    ...sumCoursePoints([...exercises, ...closedChapters.flatMap((chapter) => chapter.exercises)]),
    newExercises: previous?.newExercises ?? [],
    notifyAfter: previous?.notifyAfter ?? 0,
    ...(closedChapters.length > 0 ? { closedChapters } : {}),
    ...(course.url ? { url: course.url } : {}),
    ...(course.language_code ? { languageCode: course.language_code } : {}),
    ...(course.language_group_id ? { languageGroupId: course.language_group_id } : {}),
    ...(course.closed_at ? { closedAt: course.closed_at } : {}),
    ...(course.successor_course_id ? { successorCourseId: course.successor_course_id } : {}),
    ...(course.is_staff ? { isStaff: true } : {}),
    ...(previous?.examAnswerableUntil ? { examAnswerableUntil: previous.examAnswerableUntil } : {}),
  }
}

/**
 * The stored form of a started courses.mooc.fi exam, kept as a course of its exercises whose
 * deadline is when the exam's answers close.
 *
 * @param exam The stored exam, or the one being added: its id, name and closing time.
 */
export function toStoredMoocExam(
  exam: Pick<MoocLocalCourseData, "id" | "name" | "title" | "organization"> &
    Partial<MoocLocalCourseData> & { examAnswerableUntil: string },
  slides: TmcExerciseSlide[],
): MoocLocalCourseData {
  const previousExercises = exam.exercises ?? []
  const exercises = combineMoocApiExerciseData(
    slides.map((slide) => ({ ...slide, deadline: slide.deadline ?? exam.examAnswerableUntil })),
    { course_id: exam.id, exercises: [], closed_chapters: [] },
    previousExercises,
  )
  return {
    id: exam.id,
    name: exam.name,
    title: exam.title,
    description: null,
    organization: exam.organization,
    aiPolicy: exam.aiPolicy ?? "not_set",
    exercises,
    ...sumCoursePoints(exercises),
    newExercises: exam.newExercises ?? [],
    notifyAfter: exam.notifyAfter ?? 0,
    examAnswerableUntil: exam.examAnswerableUntil,
  }
}

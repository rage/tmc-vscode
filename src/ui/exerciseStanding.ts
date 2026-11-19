import type { CourseIdentifier, ExerciseIdentifier, SubmissionView } from "../../shared/lib"
import {
  arePointsHeldForReview,
  LocalCourseData,
  LocalCourseExercise,
  unwrap,
} from "../../shared/lib"
import type { UserData } from "../config/userdata"
import { getExerciseIncludingClosedChapters } from "../config/userdata"
import { standingView } from "../panels/submissionView"
import { modelSolutionUrl } from "./modelSolution"
import { nextExerciseAfter } from "./treeview/courseViewModel"

/**
 * Whether a results screen leads on from `exercise` to the next one: it is passed, or all that
 * is left is a teacher's review, as the course home then continues past it too.
 */
export function leadsOnFrom(exercise: LocalCourseExercise): boolean {
  return (
    unwrap(exercise).passed ||
    (exercise.kind === "mooc" &&
      arePointsHeldForReview(exercise.data.pendingReview, exercise.data.awardedPoints))
  )
}

/** The exercise to go on to after `exerciseId`, as a results panel offers it. */
export function nextExerciseOf(
  userData: Pick<UserData, "getCourse" | "getExercise">,
  courseId: CourseIdentifier,
  exerciseId: ExerciseIdentifier,
): SubmissionView["nextExercise"] {
  const course = userData.getCourse(courseId)
  const nextId = course.ok ? nextExerciseAfter(course.val, exerciseId, new Date()) : undefined
  const next = nextId && userData.getExercise(nextId)
  return next?.ok ? { name: LocalCourseExercise.getSlug(next.val.exercise) } : undefined
}

/**
 * A results panel's view of `exerciseId` with no submission to show, as its stored course
 * stands now; `undefined` when the course no longer has it.
 */
export function exerciseStandingView(
  userData: Pick<UserData, "getCourse" | "getExercise" | "getExerciseInClosedChapter">,
  exerciseId: ExerciseIdentifier,
): SubmissionView | undefined {
  const stored = getExerciseIncludingClosedChapters(userData, exerciseId)
  if (stored.err) {
    return undefined
  }
  const view = standingView(stored.val.exercise, modelSolutionUrl(stored.val))
  const nextExercise = leadsOnFrom(stored.val.exercise)
    ? nextExerciseOf(userData, LocalCourseData.getCourseId(stored.val.course), exerciseId)
    : undefined
  return nextExercise ? { ...view, nextExercise } : view
}

import { z } from "zod"

import type { CourseIdentifier, Enum, ExerciseIdentifier } from "./enum"
import { EnumSchema, makeMoocKind, makeTmcKind, match, unwrap } from "./enum"

// The live course schemas. Storage v3 persists exactly these (see `data_v3.ts`), so a change
// here is a storage format change.

export const SharedTmcCourseExerciseSchema = z.object({
  id: z.number(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /** The exercise slug. */
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  softDeadline: z.string().nullable(),
})

export type SharedTmcCourseExercise = z.infer<typeof SharedTmcCourseExerciseSchema>

export const SharedTmcCourseDataSchema = z.object({
  id: z.number(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  organization: z.string(),
  exercises: z.array(SharedTmcCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /** The course hides submission results. */
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.number()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export type SharedTmcCourseData = z.infer<typeof SharedTmcCourseDataSchema>

/** A chapter of a mooc course, as its exercises are grouped by. */
const MoocExerciseChapterSchema = z.object({
  name: z.string(),
  /** The chapter's position in the course, from 1. */
  number: z.number(),
})

export const SharedMoocCourseExerciseSchema = z.object({
  id: z.string(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /** The exercise slug. */
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  /** Below full points with the try limit used up, so the score is final; absent means no. */
  outOfTries: z.boolean().optional(),
  /** The chapter the course material puts the exercise in; absent outside any chapter. */
  chapter: MoocExerciseChapterSchema.optional(),
})

export type SharedMoocCourseExercise = z.infer<typeof SharedMoocCourseExerciseSchema>

export const SharedMoocCourseDataSchema = z.object({
  /** The courses.mooc.fi course id, which is the course's only client-side key. */
  id: z.string(),
  /** The course slug. */
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  organization: z.string(),
  exercises: z.array(SharedMoocCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  newExercises: z.array(z.string()),
  notifyAfter: z.number(),
})

export type SharedMoocCourseData = z.infer<typeof SharedMoocCourseDataSchema>

export type LocalCourseExercise = Enum<SharedTmcCourseExercise, SharedMoocCourseExercise>

/**
 * Whether an exercise's soft deadline is the one it is judged by: the exercise has both
 * deadlines and the soft one comes first. Takes the ISO timestamps a stored exercise holds.
 */
export function isSoftDeadlineBinding({
  softDeadline,
  deadline,
}: {
  softDeadline?: string | null
  deadline: string | null
}): boolean {
  return !!softDeadline && deadline !== null && Date.parse(softDeadline) < Date.parse(deadline)
}

/** What missing a binding soft deadline costs, as one sentence for the student. */
export const SOFT_DEADLINE_PENALTY =
  "An exercise submitted after its soft deadline still counts, but awards only 75% of its points."

export namespace LocalCourseExercise {
  export function getSlug(lce: LocalCourseExercise): string {
    return unwrap(lce).name
  }

  export function getId(lce: LocalCourseExercise): ExerciseIdentifier {
    return match(
      lce,
      (tmc) => makeTmcKind({ tmcExerciseId: tmc.id }),
      (mooc) => makeMoocKind({ moocExerciseId: mooc.id }),
    )
  }

  /** The soft deadline as stored; mooc exercises have none. */
  export function getSoftDeadline(lce: LocalCourseExercise): string | null {
    return lce.kind === "tmc" ? lce.data.softDeadline : null
  }
}

export const LocalCourseDataSchema = EnumSchema(
  SharedTmcCourseDataSchema,
  SharedMoocCourseDataSchema,
)

export type LocalCourseData = Enum<SharedTmcCourseData, SharedMoocCourseData>

export namespace LocalCourseData {
  export function getCourseId(lcd: LocalCourseData): CourseIdentifier {
    return match(
      lcd,
      (tmc) => makeTmcKind({ courseId: tmc.id }),
      (mooc) => makeMoocKind({ moocCourseId: mooc.id }),
    )
  }

  /**
   * The course slug: the workspace folder name, the path segment and the key for
   * per-course settings. Use {@link getCourseTitle} for anything the user reads.
   */
  export function getCourseName(lcd: LocalCourseData): string {
    return unwrap(lcd).name
  }

  /** The course's human-readable name, for every label shown to the user. */
  export function getCourseTitle(lcd: LocalCourseData): string {
    return unwrap(lcd).title
  }

  /** Whether the backend has closed the course to downloads and submissions; never for mooc. */
  export function isDisabled(lcd: LocalCourseData): boolean {
    return lcd.kind === "tmc" && lcd.data.disabled
  }

  /** Whether the course hides submission results, as an exam does; never for mooc. */
  export function isExamMode(lcd: LocalCourseData): boolean {
    return lcd.kind === "tmc" && lcd.data.perhapsExamMode
  }

  export function getNewExercises(lcd: LocalCourseData): ExerciseIdentifier[] {
    return match(
      lcd,
      (tmc) => tmc.newExercises.map((neid) => makeTmcKind({ tmcExerciseId: neid })),
      (mooc) => mooc.newExercises.map((neid) => makeMoocKind({ moocExerciseId: neid })),
    )
  }

  export function getExercises(lcd: LocalCourseData): LocalCourseExercise[] {
    return match(
      lcd,
      (tmc) => tmc.exercises.map(makeTmcKind),
      (mooc) => mooc.exercises.map(makeMoocKind),
    )
  }
}

/**
 * An exercise's state as the Courses view shows it: on disk (`opened`, `closed`), on its way
 * (`downloading`, `downloadFailed`), or not downloaded (`missing`, `new` when the course
 * announced it, `expired` past its hard deadline).
 */
export type ExerciseStatus =
  | "closed"
  | "downloading"
  | "downloadFailed"
  | "expired"
  | "missing"
  | "new"
  | "opened"

export const FeedbackQuestionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  lower: z.number().optional(),
  upper: z.number().optional(),
  question: z.string(),
})

export type FeedbackQuestion = z.infer<typeof FeedbackQuestionSchema>

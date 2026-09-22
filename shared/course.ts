import { z } from "zod"

import type { CourseIdentifier, Enum } from "./enum"
import {
  EnumSchema,
  ExerciseIdentifier,
  ExerciseIdentifierSchema,
  makeMoocKind,
  makeTmcKind,
  match,
} from "./enum"
import { RunResult, StyleValidationResult } from "./langsSchema"

// duplicated from the data module; keep in sync manually
export const SharedTmcCourseExerciseSchema = z.object({
  id: z.number(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /// Equivalent to exercise slug
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
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.number()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export type SharedTmcCourseData = z.infer<typeof SharedTmcCourseDataSchema>

export const SharedMoocCourseExerciseSchema = z.object({
  id: z.string(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /// Equivalent to exercise slug
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  softDeadline: z.string().nullable(),
})

export type SharedMoocCourseExercise = z.infer<typeof SharedMoocCourseExerciseSchema>

export const SharedMoocCourseDataSchema = z.object({
  // The courses.mooc.fi course id. There is no separate course-instance concept
  // on this backend (the backend resolves the enrolled instance from the user's
  // identity), so the course id is the sole client-side course key.
  id: z.string(),
  // course slug
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  organization: z.string(),
  exercises: z.array(SharedMoocCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.string()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export type SharedMoocCourseData = z.infer<typeof SharedMoocCourseDataSchema>

export const LocalCourseExerciseSchema = EnumSchema(
  SharedTmcCourseExerciseSchema,
  SharedMoocCourseExerciseSchema,
)

export type LocalCourseExercise = Enum<SharedTmcCourseExercise, SharedMoocCourseExercise>

export namespace LocalCourseExercise {
  export function getSlug(lce: LocalCourseExercise): string {
    return match(
      lce,
      (tmc) => tmc.name,
      (mooc) => mooc.name,
    )
  }

  export function getId(lce: LocalCourseExercise): ExerciseIdentifier {
    const id = match(
      lce,
      (tmc) => tmc.id,
      (mooc) => mooc.id,
    )
    return ExerciseIdentifier.from(id)
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
      // mooc has no instance concept; the course id is the identifier (carried
      // under the `instanceId` label on the CourseIdentifier mooc arm)
      (mooc) => makeMoocKind({ instanceId: mooc.id }),
    )
  }

  /**
   * The course slug: the workspace folder name, the path segment and the key for
   * per-course settings. Use {@link getCourseTitle} for anything the user reads.
   */
  export function getCourseName(lcd: LocalCourseData): string {
    return match(
      lcd,
      (tmc) => tmc.name,
      (mooc) => mooc.name,
    )
  }

  /** The course's human-readable name, for every label shown to the user. */
  export function getCourseTitle(lcd: LocalCourseData): string {
    return match(
      lcd,
      (tmc) => tmc.title,
      (mooc) => mooc.title,
    )
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

export const ExerciseStatusSchema = z.enum([
  "closed",
  "downloading",
  "downloadFailed",
  "expired",
  "missing",
  "new",
  "opened",
])

export type ExerciseStatus = z.infer<typeof ExerciseStatusSchema>

export const ExerciseSchema = z.object({
  id: ExerciseIdentifierSchema,
  name: z.string(),
  isHard: z.boolean(),
  hardDeadlineString: z.string(),
  softDeadlineString: z.string(),
  passed: z.boolean(),
})

export const ExerciseGroupSchema = z.object({
  name: z.string(),
  exercises: z.array(ExerciseSchema),
  nextDeadlineString: z.string(),
})

export type ExerciseGroup = z.infer<typeof ExerciseGroupSchema>

export const TestResultDataSchema = z.object({
  testResult: RunResult,
  id: ExerciseIdentifierSchema,
  courseSlug: z.string(),
  exerciseName: z.string(),
  tmcLogs: z.object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }),
  pasteLink: z.string().optional(),
  disabled: z.boolean().optional(),
  styleValidationResult: StyleValidationResult.nullable().optional(),
})

export type TestResultData = z.infer<typeof TestResultDataSchema>

export const FeedbackQuestionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  lower: z.number().optional(),
  upper: z.number().optional(),
  question: z.string(),
})

export type FeedbackQuestion = z.infer<typeof FeedbackQuestionSchema>

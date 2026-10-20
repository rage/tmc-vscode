import { z } from "zod"

import type { BackendKind } from "./enum"
import { ExerciseIdentifierSchema } from "./enum"

const BackendKindSchema = z.enum(["tmc", "mooc"]) satisfies z.ZodType<BackendKind>

/** A deadline as the course home prints it, formatted on the host in the display language. */
const DeadlineTextSchema = z.object({
  /** ISO timestamp, for `<time datetime>`. */
  at: z.string(),
  /** E.g. "Oct 2, 2026, 3:00 PM". */
  absolute: z.string(),
  /** E.g. "in 3 days" or "2 hours ago". */
  relative: z.string(),
})

export type DeadlineText = z.infer<typeof DeadlineTextSchema>

const ExerciseStatusSchema = z.enum([
  "closed",
  "downloading",
  "downloadFailed",
  "expired",
  "missing",
  "new",
  "opened",
])

/** One exercise row of the course home. */
export const CourseHomeExerciseSchema = z.object({
  id: ExerciseIdentifierSchema,
  name: z.string(),
  status: ExerciseStatusSchema,
  passed: z.boolean(),
  isOutOfTries: z.boolean(),
  awardedPoints: z.number(),
  availablePoints: z.number(),
  /** The deadline the exercise is judged by; a binding soft one sets `isSoftDeadline`. */
  deadline: DeadlineTextSchema.optional(),
  isSoftDeadline: z.boolean(),
  isUpdateable: z.boolean(),
})

export type CourseHomeExercise = z.infer<typeof CourseHomeExerciseSchema>

export const CourseHomePartSchema = z.object({
  /** Unique among the course's parts. */
  key: z.string(),
  name: z.string(),
  isDefaultOpen: z.boolean(),
  exercises: z.array(CourseHomeExerciseSchema),
})

export type CourseHomePart = z.infer<typeof CourseHomePartSchema>

/**
 * Everything the course home shows of one course, built on the host from the same view model
 * the Courses view draws, so the two never disagree.
 */
export const CourseHomeViewSchema = z.object({
  backend: BackendKindSchema,
  title: z.string(),
  /** The tmc organization slug or the mooc organization name. */
  organization: z.string(),
  description: z.string().nullable(),
  materialUrl: z.string().nullable(),
  awardedPoints: z.number(),
  availablePoints: z.number(),
  nextDeadline: DeadlineTextSchema.optional(),
  /** Any exercise is judged by a soft deadline, whose penalty the page then explains. */
  hasSoftDeadlines: z.boolean(),
  isExamMode: z.boolean(),
  isDisabled: z.boolean(),
  /** The backend did not answer the last refresh, so deadlines and points may be stale. */
  isOffline: z.boolean(),
  isLoggedIn: z.boolean(),
  /** This window is the course's workspace. */
  isWorkspaceOpen: z.boolean(),
  /** This window is the course's workspace and in Restricted Mode. */
  isRestricted: z.boolean(),
  /** Announced as new and not dismissed; downloadable ones only. */
  newExercises: z.array(z.object({ id: ExerciseIdentifierSchema, name: z.string() })),
  /** Exercises on disk whose template changed on the backend. */
  updates: z.array(z.object({ id: ExerciseIdentifierSchema, name: z.string() })),
  /** Exercises the last automatic update replaced, until the student dismisses the notice. */
  recentlyUpdated: z.array(z.string()),
  parts: z.array(CourseHomePartSchema),
})

export type CourseHomeView = z.infer<typeof CourseHomeViewSchema>

/** What the course home can do to the whole course. */
export const CourseHomeActionSchema = z.enum([
  "downloadAllExercises",
  "downloadNewExercises",
  "dismissNewExercises",
  "updateExercises",
  "dismissRecentUpdates",
  "closeCompletedExercises",
  "switchCourseWorkspace",
  "revealInCoursesView",
])

export type CourseHomeAction = z.infer<typeof CourseHomeActionSchema>

/** What the course home can do to one of the course's exercises. */
export const CourseHomeExerciseActionSchema = z.enum([
  "open",
  "download",
  "reset",
  "downloadOldSubmission",
])

export type CourseHomeExerciseAction = z.infer<typeof CourseHomeExerciseActionSchema>

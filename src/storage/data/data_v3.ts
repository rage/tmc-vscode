import { z } from "zod"

import {
  SharedMoocCourseDataSchema,
  SharedMoocCourseExerciseSchema,
  SharedTmcCourseDataSchema,
  SharedTmcCourseExerciseSchema,
} from "../../shared/shared"
import * as v2 from "./data_v2"

// global storage keys
export const USER_DATA_KEY = "user-data-v3"
export import SESSION_STATE_KEY = v2.SESSION_STATE_KEY
/** Pre-2.0 exercises langs refused to take over, in their v0 shape with `path` resolved. */
export const PENDING_EXERCISE_MIGRATION_KEY = "pending-exercise-migration-v3"

export type LogLevel = v2.LogLevel
export type SessionState = v2.SessionState
export import ExerciseStatus = v2.ExerciseStatus

// validation schemas (see the note in data_v0.ts: unknown extra keys are accepted)
//
// v3 is the latest version, so it persists the live schemas from `shared/course.ts`.
// Introducing v4 means freezing copies of them here first.

export const logLevelSchema = v2.logLevelSchema
export const sessionStateSchema = v2.sessionStateSchema
export const exerciseStatusSchema = v2.exerciseStatusSchema
export const tmcLocalCourseExerciseSchema = SharedTmcCourseExerciseSchema
export const tmcLocalCourseDataSchema = SharedTmcCourseDataSchema
export const moocLocalCourseExerciseSchema = SharedMoocCourseExerciseSchema
export const moocLocalCourseDataSchema = SharedMoocCourseDataSchema

export const userDataSchema = z.object({
  courses: z.array(tmcLocalCourseDataSchema),
  mooc_courses: z.array(moocLocalCourseDataSchema),
})

// data types
export type TmcLocalCourseExercise = z.infer<typeof tmcLocalCourseExerciseSchema>
export type TmcLocalCourseData = z.infer<typeof tmcLocalCourseDataSchema>
export type MoocLocalCourseExercise = z.infer<typeof moocLocalCourseExerciseSchema>
export type MoocLocalCourseData = z.infer<typeof moocLocalCourseDataSchema>
export type UserData = z.infer<typeof userDataSchema>

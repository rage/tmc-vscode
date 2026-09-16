import { z } from "zod"

import * as v2 from "./data_v2"

// global storage keys
export const USER_DATA_KEY = "user-data-v3"
export import SESSION_STATE_KEY = v2.SESSION_STATE_KEY

export type LogLevel = v2.LogLevel
export type SessionState = v2.SessionState
export import ExerciseStatus = v2.ExerciseStatus
export type TmcLocalCourseExercise = v2.LocalCourseExercise
export type TmcLocalCourseData = v2.LocalCourseData

// data types
export interface MoocLocalCourseExercise {
  id: string
  availablePoints: number
  awardedPoints: number
  /// Equivalent to exercise slug
  name: string
  deadline: string | null
  passed: boolean
  softDeadline: string | null
}

export interface MoocLocalCourseData {
  // The courses.mooc.fi course id. There is no separate course-instance concept
  // on this backend: the backend resolves the user's enrolled instance from
  // their identity, so the course id is the sole client-side course key.
  id: string
  // course slug
  name: string
  title: string
  description: string | null
  organization: string
  exercises: MoocLocalCourseExercise[]
  availablePoints: number
  awardedPoints: number
  perhapsExamMode: boolean
  newExercises: string[]
  notifyAfter: number
  disabled: boolean
  materialUrl: string | null
}

export interface UserData {
  // tmc_courses
  courses: TmcLocalCourseData[]
  mooc_courses: MoocLocalCourseData[]
}

// validation schemas (see the note in data_v0.ts: unknown extra keys are accepted)

export const logLevelSchema = v2.logLevelSchema
export const sessionStateSchema = v2.sessionStateSchema
export const exerciseStatusSchema = v2.exerciseStatusSchema
export const tmcLocalCourseExerciseSchema = v2.localCourseExerciseSchema
export const tmcLocalCourseDataSchema = v2.localCourseDataSchema

export const moocLocalCourseExerciseSchema: z.ZodType<MoocLocalCourseExercise> = z.object({
  id: z.string(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  softDeadline: z.string().nullable(),
})

export const moocLocalCourseDataSchema: z.ZodType<MoocLocalCourseData> = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  organization: z.string(),
  exercises: z.array(moocLocalCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.string()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export const userDataSchema: z.ZodType<UserData> = z.object({
  courses: z.array(tmcLocalCourseDataSchema),
  mooc_courses: z.array(moocLocalCourseDataSchema),
})

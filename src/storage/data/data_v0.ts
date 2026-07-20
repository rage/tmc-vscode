import * as path from "path"

import { z } from "zod"

// global storage keys
export const EXERCISE_DATA_KEY = "exerciseData"
export const USER_DATA_KEY = "userData"
export const EXTENSION_SETTINGS_KEY = "extensionSettings"
export const EXTENSION_VERSION_KEY = "extensionVersion"

// data path
export function exercisesDataPath(dataPath: string): string {
  return path.join(dataPath, "TMC workspace", "Exercises")
}

export function closedExerciseDataPath(dataPath: string, id: string): string {
  return path.join(dataPath, "TMC workspace", "closed-exercises", id.toString())
}

// data types
export interface LocalCourseDataExercise {
  id: number
  passed: boolean
  name?: string | undefined
  deadline?: string | null | undefined
  softDeadline?: string | null | undefined
}

export interface LocalCourseData {
  id: number
  name: string
  description: string
  organization: string
  availablePoints?: number | undefined
  awardedPoints?: number | undefined
  disabled?: boolean | undefined
  exercises: LocalCourseDataExercise[]
  newExercises?: number[] | undefined
  perhapsExamMode?: boolean | undefined
  title?: string | undefined
  notifyAfter?: number | undefined
  material_url?: string | null | undefined
}

export enum ExerciseStatus {
  OPEN = 0,
  CLOSED = 1,
  MISSING = 2,
}

export interface LocalExerciseData {
  id: number
  checksum: string
  name: string
  course: string
  deadline?: string | null | undefined
  isOpen?: boolean | undefined
  organization: string
  path?: string | undefined
  softDeadline?: string | null | undefined
  status?: ExerciseStatus | undefined
  updateAvailable?: boolean | undefined
}

export enum LogLevel {
  None = "none",
  Errors = "errors",
  Verbose = "verbose",
  Debug = "debug",
}

export interface ExtensionSettings {
  dataPath: string
  downloadOldSubmission?: boolean | undefined
  hideMetaFiles?: boolean | undefined
  insiderVersion?: boolean | undefined
  logLevel?: LogLevel | undefined
  oldDataPath?: { path: string; timestamp: number } | undefined
  updateExercisesAutomatically?: boolean | undefined
}

export interface UserData {
  courses: LocalCourseData[]
}

// validation schemas
//
// These guard real users' persisted data and must tolerate unknown extra
// keys (data written by a newer extension version): zod's default object
// schema accepts and ignores unknown keys, and `validateData` returns the
// original object untouched.

export const localCourseDataExerciseSchema: z.ZodType<LocalCourseDataExercise> = z.object({
  id: z.number(),
  passed: z.boolean(),
  name: z.string().optional(),
  deadline: z.string().nullable().optional(),
  softDeadline: z.string().nullable().optional(),
})

export const localCourseDataSchema: z.ZodType<LocalCourseData> = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  organization: z.string(),
  availablePoints: z.number().optional(),
  awardedPoints: z.number().optional(),
  disabled: z.boolean().optional(),
  exercises: z.array(localCourseDataExerciseSchema),
  newExercises: z.array(z.number()).optional(),
  perhapsExamMode: z.boolean().optional(),
  title: z.string().optional(),
  notifyAfter: z.number().optional(),
  material_url: z.string().nullable().optional(),
})

export const exerciseStatusSchema: z.ZodType<ExerciseStatus> = z.enum(ExerciseStatus)

export const localExerciseDataSchema: z.ZodType<LocalExerciseData> = z.object({
  id: z.number(),
  checksum: z.string(),
  name: z.string(),
  course: z.string(),
  deadline: z.string().nullable().optional(),
  isOpen: z.boolean().optional(),
  organization: z.string(),
  path: z.string().optional(),
  softDeadline: z.string().nullable().optional(),
  status: exerciseStatusSchema.optional(),
  updateAvailable: z.boolean().optional(),
})

export const logLevelSchema: z.ZodType<LogLevel> = z.enum(LogLevel)

export const extensionSettingsSchema: z.ZodType<ExtensionSettings> = z.object({
  dataPath: z.string(),
  downloadOldSubmission: z.boolean().optional(),
  hideMetaFiles: z.boolean().optional(),
  insiderVersion: z.boolean().optional(),
  logLevel: logLevelSchema.optional(),
  oldDataPath: z.object({ path: z.string(), timestamp: z.number() }).optional(),
  updateExercisesAutomatically: z.boolean().optional(),
})

export const userDataSchema: z.ZodType<UserData> = z.object({
  courses: z.array(localCourseDataSchema),
})

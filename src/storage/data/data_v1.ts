import { z } from "zod"

// global storage keys
export const USER_DATA_KEY = "user-data-v1"
export const EXTENSION_SETTINGS_KEY = "extension-settings-v1"
export const SESSION_STATE_KEY = "session-state-v1"

// data types
export interface LocalCourseDataExercise {
  id: number
  awardedPoints?: number | undefined
  availablePoints?: number | undefined
  name: string
  deadline: string | null
  passed: boolean
  softDeadline: string | null
}

export interface LocalCourseData {
  id: number
  name: string
  title: string
  description: string
  organization: string
  exercises: LocalCourseDataExercise[]
  availablePoints: number
  awardedPoints: number
  perhapsExamMode: boolean
  newExercises: number[]
  notifyAfter: number
  disabled: boolean
  materialUrl: string | null
}

export enum ExerciseStatus {
  OPEN = "open",
  CLOSED = "closed",
  MISSING = "missing",
}

export interface ExtensionSettings {
  downloadOldSubmission: boolean
  hideMetaFiles: boolean
  insiderVersion: boolean
  logLevel: LogLevel
  updateExercisesAutomatically: boolean
}

export type LogLevel = "none" | "errors" | "verbose"

export interface SessionState {
  extensionVersion?: string | undefined
}

export interface UserData {
  courses: LocalCourseData[]
}

// validation schemas (see the note in data_v0.ts: unknown extra keys are accepted)

export const localCourseDataExerciseSchema: z.ZodType<LocalCourseDataExercise> = z.object({
  id: z.number(),
  awardedPoints: z.number().optional(),
  availablePoints: z.number().optional(),
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  softDeadline: z.string().nullable(),
})

export const localCourseDataSchema: z.ZodType<LocalCourseData> = z.object({
  id: z.number(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  organization: z.string(),
  exercises: z.array(localCourseDataExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.number()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export const exerciseStatusSchema: z.ZodType<ExerciseStatus> = z.enum(ExerciseStatus)

export const logLevelSchema: z.ZodType<LogLevel> = z.enum(["none", "errors", "verbose"])

export const extensionSettingsSchema: z.ZodType<ExtensionSettings> = z.object({
  downloadOldSubmission: z.boolean(),
  hideMetaFiles: z.boolean(),
  insiderVersion: z.boolean(),
  logLevel: logLevelSchema,
  updateExercisesAutomatically: z.boolean(),
})

export const sessionStateSchema: z.ZodType<SessionState> = z.object({
  extensionVersion: z.string().optional(),
})

export const userDataSchema: z.ZodType<UserData> = z.object({
  courses: z.array(localCourseDataSchema),
})

import { z } from "zod"

import * as v1 from "./data_v1"

// global storage keys
export import USER_DATA_KEY = v1.USER_DATA_KEY
export import EXTENSION_SETTINGS_KEY = v1.EXTENSION_SETTINGS_KEY
export import SESSION_STATE_KEY = v1.SESSION_STATE_KEY

// extension settings keys
export const TMC_DOWNLOAD_OLD_SUBMISSION_KEY = "testMyCode.downloadOldSubmission"
export const TMC_HIDE_META_FILES_KEY = "testMyCode.hideMetaFiles"
export const TMC_UPDATE_EXERCISES_AUTOMATICALLY_KEY = "testMyCode.updateExercisesAutomatically"
export const TMC_INSIDER_VERSION_KEY = "testMyCode.insiderVersion"
export const TMC_LOG_LEVEL_KEY = "testMyCode.logLevel"

// langs settings
export function langsClosedExercisesKey(exerciseId: string): string {
  return `closed-exercises-for:${exerciseId}`
}

// data types
export type LogLevel = v1.LogLevel
export type SessionState = v1.SessionState
export type ExtensionSettings = v1.ExtensionSettings
export import ExerciseStatus = v1.ExerciseStatus

export interface LocalCourseExercise {
  id: number
  availablePoints: number
  awardedPoints: number
  /// Equivalent to exercise slug
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
  exercises: LocalCourseExercise[]
  availablePoints: number
  awardedPoints: number
  perhapsExamMode: boolean
  newExercises: number[]
  notifyAfter: number
  disabled: boolean
  materialUrl: string | null
}

export interface UserData {
  courses: LocalCourseData[]
}

// validation schemas (see the note in data_v0.ts: unknown extra keys are accepted)

export const logLevelSchema = v1.logLevelSchema
export const sessionStateSchema = v1.sessionStateSchema
export const extensionSettingsSchema = v1.extensionSettingsSchema
export const exerciseStatusSchema = v1.exerciseStatusSchema

export const localCourseExerciseSchema: z.ZodType<LocalCourseExercise> = z.object({
  id: z.number(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
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
  exercises: z.array(localCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.number()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export const userDataSchema: z.ZodType<UserData> = z.object({
  courses: z.array(localCourseDataSchema),
})

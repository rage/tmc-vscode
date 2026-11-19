import { z } from "zod"

import {
  SharedMoocCourseDataSchema,
  SharedMoocCourseExerciseSchema,
  SharedTmcCourseDataSchema,
  SharedTmcCourseExerciseSchema,
} from "../../../shared/lib"
import * as v2 from "./data_v2"

// global storage keys
export const USER_DATA_KEY = "user-data-v3"
export import SESSION_STATE_KEY = v2.SESSION_STATE_KEY
/** Pre-2.0 exercises langs refused to take over, in their v0 shape with `path` resolved. */
export const PENDING_EXERCISE_MIGRATION_KEY = "pending-exercise-migration-v3"
/** The raw legacy values as the first migration found them; written once, never overwritten. */
export const LEGACY_DATA_BACKUP_KEY = "legacy-data-backup-v3"
/** The latest migration runs and unreadable legacy values; see {@link MigrationDiagnostics}. */
export const MIGRATION_DIAGNOSTICS_KEY = "migration-diagnostics-v3"
/** What this version last mirrored to `user-data-v1`; unset until it first does. */
export const LEGACY_MIRROR_RECORD_KEY = "legacy-mirror-record-v3"

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

/** Read only by hand, so it has no schema. */
export interface LegacyDataBackup {
  /** ISO timestamp. */
  createdAt: string
  /** The extension version that last ran before the backup, if one was recorded. */
  fromVersion: string | null
  toVersion: string
  /** Each legacy key that held a value, as stored. */
  values: Record<string, unknown>
}

/** One activation's migration that read legacy data, wrote or retired a key, or failed. */
export const migrationRunSchema = z.object({
  /** ISO timestamp. */
  at: z.string(),
  /** The extension version that last ran before this one, if one was recorded. */
  fromVersion: z.string().nullable(),
  toVersion: z.string(),
  outcome: z.enum(["migrated", "failed"]),
  error: z.string().optional(),
  keysRead: z.array(z.string()),
  keysWritten: z.array(z.string()),
  keysRetired: z.array(z.string()),
  /** Stored courses and exercises left out because they could not be read. */
  droppedEntries: z.number(),
})

export const legacyMirrorRecordSchema = z.object({
  /** The ids of the tmc courses in the mirror; empty when it was deleted for having none. */
  courseIds: z.array(z.number()),
})

/** A legacy course, or a whole legacy value, kept because rewriting its key would lose it. */
export const unreadableLegacyValueSchema = z.object({
  /** ISO timestamp. */
  keptAt: z.string(),
  key: z.string(),
  value: z.unknown(),
})

export type LegacyMirrorRecord = z.infer<typeof legacyMirrorRecordSchema>
export type UnreadableLegacyValue = z.infer<typeof unreadableLegacyValueSchema>
export type MigrationRun = z.infer<typeof migrationRunSchema>
/** Both oldest first. */
export interface MigrationDiagnostics {
  runs: MigrationRun[]
  unreadable: UnreadableLegacyValue[]
}
export type TmcLocalCourseExercise = z.infer<typeof tmcLocalCourseExerciseSchema>
export type TmcLocalCourseData = z.infer<typeof tmcLocalCourseDataSchema>
export type MoocLocalCourseExercise = z.infer<typeof moocLocalCourseExerciseSchema>
export type MoocLocalCourseData = z.infer<typeof moocLocalCourseDataSchema>
export type UserData = z.infer<typeof userDataSchema>

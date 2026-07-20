import type { FeedbackQuestion } from "../actions/types"
import type Langs from "../api/langs"
import type { Course, Organization } from "../api/types"
import type { SubmissionFinished } from "../shared/langsSchema"
import type { CourseIdentifier, ExerciseIdentifier, LocalCourseData } from "../shared/shared"
import type Storage from "../storage"
import type { ExtensionSettings } from "../storage/data"
import type { LogLevel } from "../utilities/logger"
import type UI from "./ui"

export interface HandlerContext {
  tmc: Langs
  storage: Storage
  ui: UI
  visibilityGroups: VisibilityGroups
}

export interface VisibilityGroups {
  loggedIn: VisibilityGroup
}

export interface VisibilityGroup {
  id: string
  not: VisibilityGroupNegated
}

export interface VisibilityGroupNegated {
  id: string
}

export interface CourseDetailsData {
  course: LocalCourseData
  courseId: number
  exerciseData: CourseDetailsExerciseGroup[]
  offlineMode: boolean
}

export interface CourseDetailsExerciseGroup {
  name: string
  nextDeadlineString: string
  exercises: CourseDetailsExercise[]
}

export interface CourseDetailsExercise {
  id: ExerciseIdentifier
  name: string
  passed: boolean
  softDeadline: Date | null
  softDeadlineString: string
  hardDeadline: Date | null
  hardDeadlineString: string
  isHard: boolean
}

export interface CourseData {
  courses: Course[]
  organization: Organization
}

export interface ErrorData {
  error: Error
}

export interface LoginData {
  error?: string
}

export interface OrganizationData {
  organizations: Organization[]
  pinned: Organization[]
}

export interface RunningTestsData {
  exerciseName: string
}

export interface SettingsData {
  extensionSettings: ExtensionSettings
  tmcDataSize: string
}

export interface SubmissionResultData {
  statusData: SubmissionFinished
  feedbackQuestions: FeedbackQuestion[]
  submissionUrl: string | undefined
}

export interface SubmissionStatusData {
  messages: string[]
  progressPct: number
  submissionUrl: string | undefined
}

export interface TestResultData {
  testResult: unknown
  id: number
  courseSlug: string
  exerciseName: string
  tmcLogs: {
    stdout?: string
    stderr?: string
  }
  pasteLink?: string
  disabled?: boolean
}

export type ExerciseStatus =
  | "closed"
  | "downloading"
  | "downloadFailed"
  | "expired"
  | "missing"
  | "new"
  | "opened"

export interface ExerciseStatusChange {
  command: "exerciseStatusChange"
  exerciseId: number
  status: ExerciseStatus
}

export interface SetDataFolder {
  command: "setTmcDataFolder"
  path: string
  diskSize: string
}

export interface LoginError {
  command: "loginError"
  error: string
}

export interface SetCourseDisabledStatus {
  command: "setCourseDisabledStatus"
  courseId: CourseIdentifier
  disabled: boolean
}

export interface SetBooleanSetting {
  command: "setBooleanSetting"
  setting: "downloadOldSubmission" | "hideMetaFiles" | "insider" | "updateExercisesAutomatically"
  enabled: boolean
}

export interface SetLogLevel {
  command: "setLogLevel"
  level: LogLevel
}

export interface SetNextCourseDeadline {
  command: "setNextCourseDeadline"
  deadline: string
  courseId: number
}

export interface SetNewExercises {
  command: "setNewExercises"
  courseId: number
  exerciseIds: number[]
}

export interface SetUpdateables {
  command: "setUpdateables"
  exerciseIds: number[]
  courseId: number
}

export type WebviewMessage =
  | ExerciseStatusChange
  | LoginError
  | SetBooleanSetting
  | SetCourseDisabledStatus
  | SetDataFolder
  | SetNextCourseDeadline
  | SetNewExercises
  | SetLogLevel
  | SetUpdateables

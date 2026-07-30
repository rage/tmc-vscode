import { z } from "zod"

// The tmc-langs-cli stdout contract, as zod v4 schemas.
//
// Source of truth: the serde-annotated Rust types in tmc-langs-rust, exported
// from that repo as a schemars JSON Schema generated with the *serialize*
// contract, so it describes exactly what the CLI writes to stdout. Vendored
// from rev b94f8c7f9f7 (branch programming-exercise-migration).
//
// This file is a thin shim: the schemas below are generated from that JSON
// Schema and re-exported under stable public names. Do not hand-edit them;
// regenerate with `pnpm run vendor:langs-schema` (re-vendors
// shared/bindings.schema.json) and `pnpm run generate:langs-schema`. See
// docs/development.md.
//
// Two properties of the generated schemas are easy to trip over:
//   - Optionality reflects *serialization*: serde emits Option::None as an
//     explicit `null` unless skip_serializing_if is set, so Option fields are
//     required-but-nullable and only genuinely omitted fields are optional.
//   - `format: "date-time"` is stripped during generation, so timestamps
//     validate as plain strings: real TMC timestamps carry +03:00 offsets that
//     a Z-only ISO check would reject.
//
// Objects are non-strict, so a newer CLI adding fields does not break
// validation.
import {
  zClientUpdateData,
  zCliOutput,
  zCombinedCourseData,
  zConfigValue,
  zCourse,
  zCourseData,
  zCourseDetails,
  zCourseExercise,
  zCourseProgress,
  zDataKind,
  zDownloadOrUpdateMoocCourseExercisesResult,
  zDownloadOrUpdateTmcCourseExercisesResult,
  zExercise,
  zExerciseDesc,
  zExerciseDetails,
  zExercisePackagingConfiguration,
  zExercisePoint,
  zExerciseSlideSubmissionListItem,
  zExerciseSubmission,
  zExerciseTaskSubmissionResult,
  zExerciseTaskSubmissionStatus,
  zExerciseType,
  zGradingProgress,
  zKind,
  zLocalMoocExercise,
  zLocalTmcExercise,
  zModelSolutionSpec,
  zMoocClientUpdateData,
  zMoocCourse,
  zMoocDeviceLogin,
  zMoocOldSubmissionRestore,
  zMoocExerciseDownload,
  zNewSubmission,
  zNotification,
  zNotificationKind,
  zOrganization,
  zOutputData,
  zOutputResult,
  zPublicSpec,
  zPythonVer,
  zRefreshData,
  zRefreshExercise,
  zReview,
  zRunResult,
  zRunStatus,
  zStatus,
  zStatusUpdateData,
  zStyleValidationError,
  zStyleValidationResult,
  zStyleValidationStrategy,
  zSubmission,
  zSubmissionFeedbackKind,
  zSubmissionFeedbackQuestion,
  zSubmissionFeedbackResponse,
  zSubmissionFinished,
  zSubmissionStatus,
  zTestCase,
  zTestDesc,
  zTestResult,
  zTmcConfig,
  zTmcExerciseDownload,
  zTmcExerciseSlide,
  zTmcExerciseTask,
  zTmcProjectYml,
  zTmcStyleValidationError,
  zTmcStyleValidationResult,
  zTmcStyleValidationStrategy,
  zUpdatedExercise,
  zUpdateResult,
} from "./generated/langs/zod.gen"

// ---------------------------------------------------------------------------
// Not part of the generated CliOutput contract: CLI input helpers and
// client-side composites, kept hand-written for compatibility.
// ---------------------------------------------------------------------------

export const Locale = z.string()
export type Locale = z.infer<typeof Locale>

export const Compression = z.enum(["tar", "zip", "zstd"])
export type Compression = z.infer<typeof Compression>

export const LocalExercise = z.union([
  z.object({ tmc: zLocalTmcExercise }),
  z.object({ mooc: zLocalMoocExercise }),
])
export type LocalExercise = z.infer<typeof LocalExercise>

/**
 * The released CLI that `TMC_LANGS_RUST_VERSION` pins reports a partially failed
 * tmc batch download as a structured `{ "failed-exercise-download": ... }` error
 * kind. The current CLI reports that case as a plain `generic` error, so the
 * variant is absent from the generated contract — but the pinned binary is the
 * one shipped to users, and its error output must still validate. Nothing here
 * consumes the structured form (the human-readable `message` carries the
 * detail), so fold it into `generic` rather than carrying a second output shape
 * through every type that intersects `OutputData`.
 */
function normalizeReleasedErrorKind(output: unknown): unknown {
  if (
    output === null ||
    typeof output !== "object" ||
    (output as { "output-kind"?: unknown })["output-kind"] !== "output-data"
  ) {
    return output
  }
  const data = (output as { data?: unknown }).data
  if (
    data === null ||
    typeof data !== "object" ||
    (data as { "output-data-kind"?: unknown })["output-data-kind"] !== "error"
  ) {
    return output
  }
  const errorData = (data as { "output-data"?: unknown })["output-data"]
  if (errorData === null || typeof errorData !== "object") {
    return output
  }
  const kind = (errorData as { kind?: unknown }).kind
  if (
    kind === null ||
    typeof kind !== "object" ||
    !("failed-exercise-download" in (kind as object))
  ) {
    return output
  }
  return {
    ...output,
    data: { ...data, "output-data": { ...errorData, kind: "generic" } },
  }
}

/** The format for all status updates. May contain some data. */
export interface StatusUpdate<T> {
  finished: boolean
  message: string
  "percent-done": number
  time: number
  data: T | null
}

// ---------------------------------------------------------------------------
// Deprecated alias.
// ---------------------------------------------------------------------------

/**
 * @deprecated The langs CLI has no course-instance concept; it returns
 * courses. Migrate usages to `MoocCourse` (fields changed, e.g.
 * `course_name` -> `name`).
 */
export const CourseInstance = zMoocCourse
export type CourseInstance = z.infer<typeof CourseInstance>

// ---------------------------------------------------------------------------
// Generated schemas, re-exported under their stable public names.
// ---------------------------------------------------------------------------

export const ClientUpdateData = zClientUpdateData
export type ClientUpdateData = z.infer<typeof ClientUpdateData>

export const CliOutput = z.preprocess(normalizeReleasedErrorKind, zCliOutput)
export type CliOutput = z.infer<typeof CliOutput>

export const CombinedCourseData = zCombinedCourseData
export type CombinedCourseData = z.infer<typeof CombinedCourseData>

export const ConfigValue = zConfigValue
export type ConfigValue = z.infer<typeof ConfigValue>

export const Course = zCourse
export type Course = z.infer<typeof Course>

export const CourseData = zCourseData
export type CourseData = z.infer<typeof CourseData>

export const CourseDetails = zCourseDetails
export type CourseDetails = z.infer<typeof CourseDetails>

export const CourseExercise = zCourseExercise
export type CourseExercise = z.infer<typeof CourseExercise>

export const DataKind = zDataKind
export type DataKind = z.infer<typeof DataKind>

export const DownloadOrUpdateMoocCourseExercisesResult = zDownloadOrUpdateMoocCourseExercisesResult
export type DownloadOrUpdateMoocCourseExercisesResult = z.infer<
  typeof DownloadOrUpdateMoocCourseExercisesResult
>

export const DownloadOrUpdateTmcCourseExercisesResult = zDownloadOrUpdateTmcCourseExercisesResult
export type DownloadOrUpdateTmcCourseExercisesResult = z.infer<
  typeof DownloadOrUpdateTmcCourseExercisesResult
>

export const Exercise = zExercise
export type Exercise = z.infer<typeof Exercise>

export const ExerciseDesc = zExerciseDesc
export type ExerciseDesc = z.infer<typeof ExerciseDesc>

export const ExerciseDetails = zExerciseDetails
export type ExerciseDetails = z.infer<typeof ExerciseDetails>

export const ExercisePackagingConfiguration = zExercisePackagingConfiguration
export type ExercisePackagingConfiguration = z.infer<typeof ExercisePackagingConfiguration>

export const ExercisePoint = zExercisePoint
export type ExercisePoint = z.infer<typeof ExercisePoint>

/** A past mooc submission of the current user; `id` is the slide-submission id. */
export const ExerciseSlideSubmissionListItem = zExerciseSlideSubmissionListItem
export type ExerciseSlideSubmissionListItem = z.infer<typeof ExerciseSlideSubmissionListItem>

export const ExerciseSubmission = zExerciseSubmission
export type ExerciseSubmission = z.infer<typeof ExerciseSubmission>

export const ExerciseTaskSubmissionResult = zExerciseTaskSubmissionResult
export type ExerciseTaskSubmissionResult = z.infer<typeof ExerciseTaskSubmissionResult>

export const ExerciseTaskSubmissionStatus = zExerciseTaskSubmissionStatus
export type ExerciseTaskSubmissionStatus = z.infer<typeof ExerciseTaskSubmissionStatus>

export const ExerciseType = zExerciseType
export type ExerciseType = z.infer<typeof ExerciseType>

export const GradingProgress = zGradingProgress
export type GradingProgress = z.infer<typeof GradingProgress>

export const Kind = zKind
export type Kind = z.infer<typeof Kind>

export const LocalMoocExercise = zLocalMoocExercise
export type LocalMoocExercise = z.infer<typeof LocalMoocExercise>

export const LocalTmcExercise = zLocalTmcExercise
export type LocalTmcExercise = z.infer<typeof LocalTmcExercise>

export const ModelSolutionSpec = zModelSolutionSpec
export type ModelSolutionSpec = z.infer<typeof ModelSolutionSpec>

/** Per-exercise download progress for `mooc-client-update-data`; mirrors tmc's `ClientUpdateData`/`exercise-download` but keyed by UUID. */
export const MoocClientUpdateData = zMoocClientUpdateData
export type MoocClientUpdateData = z.infer<typeof MoocClientUpdateData>

export const MoocCourse = zMoocCourse
export type MoocCourse = z.infer<typeof MoocCourse>

/** Per-exercise progress for a course, from `mooc course-progress` (`mooc-course-progress` output kind); course totals are derived by summation. */
export const MoocCourseProgress = zCourseProgress
export type MoocCourseProgress = z.infer<typeof MoocCourseProgress>

/** RFC 8628 device-authorization data from a `mooc-device-login` status update (verification URL + user code), shown while `mooc login` blocks polling. */
export const MoocDeviceLogin = zMoocDeviceLogin
export type MoocDeviceLogin = z.infer<typeof MoocDeviceLogin>

export const MoocExerciseDownload = zMoocExerciseDownload
export type MoocExerciseDownload = z.infer<typeof MoocExerciseDownload>

/** Outcome of `mooc download-old-submission`: `nothing-to-download` for a submission with no files (an answer made in the browser). */
export const MoocOldSubmissionRestore = zMoocOldSubmissionRestore
export type MoocOldSubmissionRestore = z.infer<typeof MoocOldSubmissionRestore>

export const NewSubmission = zNewSubmission
export type NewSubmission = z.infer<typeof NewSubmission>

export const Notification = zNotification
export type Notification = z.infer<typeof Notification>

export const NotificationKind = zNotificationKind
export type NotificationKind = z.infer<typeof NotificationKind>

export const Organization = zOrganization
export type Organization = z.infer<typeof Organization>

export const OutputData = zOutputData
export type OutputData = z.infer<typeof OutputData>

export const OutputResult = zOutputResult
export type OutputResult = z.infer<typeof OutputResult>

export const PublicSpec = zPublicSpec
export type PublicSpec = z.infer<typeof PublicSpec>

export const PythonVer = zPythonVer
export type PythonVer = z.infer<typeof PythonVer>

export const RefreshData = zRefreshData
export type RefreshData = z.infer<typeof RefreshData>

export const RefreshExercise = zRefreshExercise
export type RefreshExercise = z.infer<typeof RefreshExercise>

export const Review = zReview
export type Review = z.infer<typeof Review>

export const RunResult = zRunResult
export type RunResult = z.infer<typeof RunResult>

export const RunStatus = zRunStatus
export type RunStatus = z.infer<typeof RunStatus>

export const Status = zStatus
export type Status = z.infer<typeof Status>

export const StatusUpdateData = zStatusUpdateData
export type StatusUpdateData = z.infer<typeof StatusUpdateData>

export const StyleValidationError = zStyleValidationError
export type StyleValidationError = z.infer<typeof StyleValidationError>

export const StyleValidationResult = zStyleValidationResult
export type StyleValidationResult = z.infer<typeof StyleValidationResult>

export const StyleValidationStrategy = zStyleValidationStrategy
export type StyleValidationStrategy = z.infer<typeof StyleValidationStrategy>

export const Submission = zSubmission
export type Submission = z.infer<typeof Submission>

export const SubmissionFeedbackKind = zSubmissionFeedbackKind
export type SubmissionFeedbackKind = z.infer<typeof SubmissionFeedbackKind>

export const SubmissionFeedbackQuestion = zSubmissionFeedbackQuestion
export type SubmissionFeedbackQuestion = z.infer<typeof SubmissionFeedbackQuestion>

export const SubmissionFeedbackResponse = zSubmissionFeedbackResponse
export type SubmissionFeedbackResponse = z.infer<typeof SubmissionFeedbackResponse>

export const SubmissionFinished = zSubmissionFinished
export type SubmissionFinished = z.infer<typeof SubmissionFinished>

export const SubmissionStatus = zSubmissionStatus
export type SubmissionStatus = z.infer<typeof SubmissionStatus>

export const TestCase = zTestCase
export type TestCase = z.infer<typeof TestCase>

export const TestDesc = zTestDesc
export type TestDesc = z.infer<typeof TestDesc>

export const TestResult = zTestResult
export type TestResult = z.infer<typeof TestResult>

export const TmcConfig = zTmcConfig
export type TmcConfig = z.infer<typeof TmcConfig>

export const TmcExerciseDownload = zTmcExerciseDownload
export type TmcExerciseDownload = z.infer<typeof TmcExerciseDownload>

export const TmcExerciseSlide = zTmcExerciseSlide
export type TmcExerciseSlide = z.infer<typeof TmcExerciseSlide>

export const TmcExerciseTask = zTmcExerciseTask
export type TmcExerciseTask = z.infer<typeof TmcExerciseTask>

export const TmcProjectYml = zTmcProjectYml
export type TmcProjectYml = z.infer<typeof TmcProjectYml>

export const TmcStyleValidationError = zTmcStyleValidationError
export type TmcStyleValidationError = z.infer<typeof TmcStyleValidationError>

export const TmcStyleValidationResult = zTmcStyleValidationResult
export type TmcStyleValidationResult = z.infer<typeof TmcStyleValidationResult>

export const TmcStyleValidationStrategy = zTmcStyleValidationStrategy
export type TmcStyleValidationStrategy = z.infer<typeof TmcStyleValidationStrategy>

export const UpdatedExercise = zUpdatedExercise
export type UpdatedExercise = z.infer<typeof UpdatedExercise>

export const UpdateResult = zUpdateResult
export type UpdateResult = z.infer<typeof UpdateResult>

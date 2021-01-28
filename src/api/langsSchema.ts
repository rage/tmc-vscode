import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    ExerciseDetails,
    OldSubmission,
    Organization,
    SubmissionFeedbackResponse,
    SubmissionResponse,
    SubmissionResultReport,
} from "./types";

// * Output schema for TMC-Langs 0.9.1 *

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-client/src/tmc_client.rs
// -------------------------------------------------------------------------------------------------

type ClientUpdateDataEnum<K extends string, V> = {
    "client-update-data-kind": K;
} & V;

export type ClientUpdateData =
    | ClientUpdateDataEnum<"exercise-download", { id: number; path: string }>
    | ClientUpdateDataEnum<"posted-submission", SubmissionResponse>;

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-cli/src/output.rs
// -------------------------------------------------------------------------------------------------

type OutputType<K extends string, V> = { "output-kind": K } & V;

export type Output =
    | OutputType<"output-data", OutputData>
    | OutputType<"status-update", StatusUpdateData>
    | OutputType<"warnings", Warnings>;

export interface OutputData {
    status: Status;
    message: string;
    result: OutputResult;
    data: Data | null;
}

interface DataType<T extends string, V> {
    "output-data-kind": T;
    "output-data": V;
}

export type Data =
    | DataType<"error", LangsError>
    | DataType<"validation", unknown>
    | DataType<"free-disk-space", number>
    | DataType<"available-points", string[]>
    | DataType<"exercises", string[]>
    | DataType<"exercise-packaging-configuration", unknown>
    | DataType<"local-exercises", LocalExercise[]>
    | DataType<"refresh-result", unknown>
    | DataType<"test-result", RunResult>
    | DataType<"exercise-desc", unknown>
    | DataType<"updated-exercises", UpdatedExercise[]>
    | DataType<"exercise-download", DownloadOrUpdateCourseExercisesResult>
    | DataType<"combined-course-data", CombinedCourseData>
    | DataType<"course-details", CourseDetails["course"]>
    | DataType<"course-exercises", CourseExercise[]>
    | DataType<"course-data", CourseSettings>
    | DataType<"courses", Course[]>
    | DataType<"exercise-details", ExerciseDetails>
    | DataType<"submissions", OldSubmission[]>
    | DataType<"update-result", unknown>
    | DataType<"organization", Organization>
    | DataType<"organizations", Organization[]>
    | DataType<"reviews", unknown>
    | DataType<"token", unknown>
    | DataType<"new-submission", SubmissionResponse>
    | DataType<"submission-feedback-response", SubmissionFeedbackResponse>
    | DataType<"submission-finished", SubmissionResultReport>
    | DataType<"config-value", unknown>
    | DataType<"tmc-config", TmcConfig>;

type StatusUpdateDataType<T extends string, V> = {
    "update-data-kind": T;
} & V;

export type StatusUpdateData =
    | StatusUpdateDataType<"client-update-data", StatusUpdate<ClientUpdateData>>
    | StatusUpdateDataType<"none", StatusUpdate<null>>;

export type Status = "finished" | "crashed";

export type OutputResult =
    | "logged-in"
    | "logged-out"
    | "not-logged-in"
    | "error"
    | "executed-command";

export interface LangsError {
    kind: LangsErrorKind;
    trace: string[];
}

export interface FailedExerciseDownload {
    completed: DownloadOrUpdateCourseExercise[];
    skipped: DownloadOrUpdateCourseExercise[];
    failed: Array<[DownloadOrUpdateCourseExercise, string[]]>;
}

export type LangsErrorKind =
    | "generic"
    | "forbidden"
    | "not-logged-in"
    | "connection-error"
    | "obsolete-client"
    | "invalid-token"
    | FailedExerciseDownload;

export interface CombinedCourseData {
    details: CourseDetails["course"];
    exercises: CourseExercise[];
    settings: CourseSettings;
}

export interface DownloadOrUpdateCourseExercisesResult {
    downloaded: DownloadOrUpdateCourseExercise[];
    skipped: DownloadOrUpdateCourseExercise[];
}

export interface DownloadOrUpdateCourseExercise {
    "course-slug": string;
    "exercise-slug": string;
    path: string;
}

export interface LocalExercise {
    "exercise-slug": string;
    "exercise-path": string;
}

export interface UpdatedExercise {
    id: number;
}

export interface DownloadTarget {
    id: number;
    path: string;
}

export interface Warnings {
    warnings: string[];
}

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-cli/src/config/tmc_config.rs
// -------------------------------------------------------------------------------------------------

export interface TmcConfig {
    "projects-dir": string;
    [key: string]: unknown;
}

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-framework/src/domain.rs
// -------------------------------------------------------------------------------------------------

export interface TestResult {
    name: string;
    successful: boolean;
    points: string[];
    message: string;
    exception: string[];
}

export interface RunResult {
    status: RunStatus;
    testResults: TestResult[];
    logs: unknown;
}

export type RunStatus =
    | "PASSED"
    | "TESTS_FAILED"
    | "COMPILE_FAILED"
    | "TESTRUN_INTERRUPTED"
    | "GENERIC_ERROR";

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-util/src/progress_reporter.rs
// -------------------------------------------------------------------------------------------------

export interface StatusUpdate<T> {
    finished: boolean;
    message: string;
    "percent-done": number;
    time: number | null;
    data: T | null;
}

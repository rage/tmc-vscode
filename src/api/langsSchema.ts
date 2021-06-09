import { CourseDetails, CourseExercise, CourseSettings, SubmissionResponse } from "./types";

// * Output schema for TMC-Langs 0.17.3 *

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-client/src/tmc_client.rs
// -------------------------------------------------------------------------------------------------

export type ClientUpdateData =
    | ({ "client-update-data-kind": "exercise-download" } & { id: number; path: string })
    | ({ "client-update-data-kind": "posted-submission" } & SubmissionResponse);

// -------------------------------------------------------------------------------------------------
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-cli/src/output.rs
// -------------------------------------------------------------------------------------------------

export type Output =
    | ({ "output-kind": "output-data" } & UncheckedOutputData)
    | ({ "output-kind": "status-update" } & StatusUpdateData)
    | ({ "output-kind": "warnings" } & Warnings);

export interface UncheckedOutputData {
    status: Status;
    message: string;
    result: OutputResult;
    data: DataType<string, unknown> | null;
}

export interface OutputData<T> {
    status: Status;
    message: string;
    result: OutputResult;
    data: DataType<string, T>;
}

interface DataType<T extends string, V> {
    "output-data-kind": T;
    "output-data": V;
}

export type StatusUpdateData =
    | ({ "update-data-kind": "client-update-data" } & StatusUpdate<ClientUpdateData>)
    | ({ "update-data-kind": "none" } & StatusUpdate<null>);

export type Status = "finished" | "crashed";

export type OutputResult =
    | "logged-in"
    | "logged-out"
    | "not-logged-in"
    | "error"
    | "executed-command";

export interface ErrorResponse {
    kind: ErrorResponseKind;
    trace: string[];
}

export interface FailedExerciseDownload {
    completed: ExerciseDownload[];
    skipped: ExerciseDownload[];
    failed: Array<[ExerciseDownload, string[]]>;
}

export type ErrorResponseKind =
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
    downloaded: ExerciseDownload[];
    skipped: ExerciseDownload[];
    failed?: Array<[ExerciseDownload, string[]]>;
}

export interface ExerciseDownload {
    id: number;
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

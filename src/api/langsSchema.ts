// Stdout schema for TMC Langs 0.6.5
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-cli/src/output.rs

export interface LangsError {
    kind:
        | "generic"
        | "forbidden"
        | "not-logged-in"
        | "connection-error"
        | "obsolete-client"
        | "invalid-token";
    trace: string[];
}

export interface LangsWarning {
    "output-kind": "warnings";
    warnings: string[];
}

export interface LangsOutputBase<T> {
    data: T;
    message: string | null;
    "percent-done": number;
}

export interface LangsOutputData<T> extends LangsOutputBase<T> {
    "output-kind": "output-data";
    result:
        | "logged-in"
        | "logged-out"
        | "not-logged-in"
        | "error"
        | "sent-data"
        | "retrieved-data"
        | "executed-command";
    status: "crashed" | "finished";
}

export interface LangsStatusUpdate<T> extends LangsOutputBase<T> {
    "output-kind": "status-update";
    finished: boolean;
    time: number | null;
}

export interface DownloadOrUpdateCourseExercisesResult {
    downloaded: DownloadOrUpdateCourseExercise[];
    skipped: DownloadOrUpdateCourseExercise[];
}

export interface DownloadOrUpdateCourseExercise {
    "course-slug": string;
    "exercise-slug": string;
}

export interface LocalExercise {
    "exercise-path": string;
    "exercise-slug": string;
}

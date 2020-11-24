// Stdout schema for TMC Langs 0.6.5
// https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-cli/src/output.rs

interface LangsError {
    kind:
        | "generic"
        | "forbidden"
        | "not-logged-in"
        | "connection-error"
        | "obsolete-client"
        | "invalid-token";
    trace: string[];
}

interface LangsWarning {
    "output-kind": "warnings";
    warnings: string[];
}

interface LangsOutputBase<T> {
    data: T;
    message: string | null;
    "percent-done": number;
}

interface LangsOutputData<T> extends LangsOutputBase<T> {
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

interface LangsStatusUpdate<T> extends LangsOutputBase<T> {
    "output-kind": "status-update";
    finished: boolean;
    time: number | null;
}

export { LangsError, LangsOutputData, LangsStatusUpdate, LangsWarning };

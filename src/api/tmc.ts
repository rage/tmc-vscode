import * as cp from "child_process";
import * as ClientOauth2 from "client-oauth2";
import * as _ from "lodash";
import * as kill from "tree-kill";
import { Err, Ok, Result } from "ts-results";
import { createIs, is } from "typescript-is";

import {
    ACCESS_TOKEN_URI,
    CLIENT_ID,
    CLIENT_NAME,
    CLIENT_SECRET,
    TMC_API_URL,
    TMC_LANGS_TIMEOUT,
} from "../config/constants";
import Resources from "../config/resources";
import Storage from "../config/storage";
import {
    ApiError,
    AuthenticationError,
    AuthorizationError,
    ConnectionError,
    RuntimeError,
} from "../errors";
import { displayProgrammerError, sleep } from "../utils/";
import { Logger } from "../utils/logger";

import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    ExerciseDetails,
    OldSubmission,
    Organization,
    SubmissionFeedback,
    SubmissionFeedbackResponse,
    SubmissionResponse,
    SubmissionStatusReport,
    TMCApiResponse,
    TmcLangsTestResultsRust,
} from "./types";
import WorkspaceManager from "./workspaceManager";

interface RustProcessArgs {
    args: string[];
    core: boolean;
    env?: { [key: string]: string };
    onStderr?: (data: string) => void;
    onStdout?: (data: UncheckedLangsResponse) => void;
    stdin?: string;
}

type RustProcessLogs = {
    stderr: string;
    stdout: UncheckedLangsResponse[];
};

type RustProcessRunner = {
    interrupt(): void;
    result: Promise<Result<RustProcessLogs, Error>>;
};

/**
 * Schema for Responses returned by TMC-langs.
 *
 * https://github.com/rage/tmc-langs-rust/blob/master/tmc-langs-cli/src/output.rs
 */
interface UncheckedLangsResponse {
    data: unknown;
    message: string | null;
    "percent-done": number;
    result:
        | "logged-in"
        | "logged-out"
        | "not-logged-in"
        | "error"
        | "sent-data"
        | "retrieved-data"
        | "executed-command"
        | "downloading"
        | "compressing"
        | "extracting"
        | "processing"
        | "sending"
        | "waiting-for-results"
        | "finished"
        | "intermediate-step-finished";
    status: "finished" | "crashed" | "in-progress";
}

interface LangsResponse<T> extends UncheckedLangsResponse {
    data: T;
    result: Exclude<UncheckedLangsResponse["result"], "error">;
    status: Exclude<UncheckedLangsResponse["status"], "crashed">;
}

interface LangsError {
    kind: string;
    trace: string[];
}

/**
 * A Class that provides an interface to all TMC services.
 */
export default class TMC {
    private readonly _oauth2: ClientOauth2;
    private readonly _storage: Storage;
    private readonly _resources: Resources;
    private readonly _tmcApiUrl: string;
    private readonly _tmcDefaultHeaders: { client: string; client_version: string };
    private readonly _isInsider: () => boolean;
    private readonly _cache: Map<string, TMCApiResponse>;
    private readonly _rustCache: Map<string, LangsResponse<unknown>>;
    private _token: ClientOauth2.Token | undefined;

    private _workspaceManager?: WorkspaceManager;

    /**
     * Creates a new instance of TMC interface class.
     *
     * @param storage Used to store authentication token.
     * @param resources Used to locate TMC-langs executable.
     * @param isInsider Callable insider status check function.
     */
    constructor(storage: Storage, resources: Resources, isInsider: () => boolean) {
        this._oauth2 = new ClientOauth2({
            accessTokenUri: ACCESS_TOKEN_URI,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });
        this._storage = storage;
        const authToken = storage.getAuthenticationToken();
        if (authToken) {
            this._token = new ClientOauth2.Token(this._oauth2, authToken);
        }
        this._resources = resources;
        this._tmcApiUrl = TMC_API_URL;
        this._cache = new Map();
        this._rustCache = new Map();
        this._tmcDefaultHeaders = {
            client: CLIENT_NAME,
            client_version: resources.extensionVersion,
        };
        this._isInsider = isInsider;
    }

    public setWorkspaceManager(workspaceManager: WorkspaceManager): void {
        if (this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager already assigned");
        }
        this._workspaceManager = workspaceManager;
    }

    // ---------------------------------------------------------------------------------------------
    // Authentication commands
    // ---------------------------------------------------------------------------------------------

    /**
     * Authenticates user to TMC services. Uses TMC-langs `core login` command internally.
     *
     * This operation will fails if wrong credentials are provided or if the user is already signed
     * in.
     *
     * @param username Username or email.
     * @param password Password.
     */
    public async authenticate(username: string, password: string): Promise<Result<void, Error>> {
        if (this._token) {
            throw new Error("Authentication token already exists.");
        }
        const loginResult = await this._executeLangsCommand(
            {
                args: ["login", "--email", username, "--base64"],
                core: true,
                stdin: Buffer.from(password).toString("base64"),
            },
            createIs<unknown>(),
        );
        if (loginResult.err) {
            return new Err(new AuthenticationError(loginResult.val.message));
        }

        // Non-Insider compatibility: Get token from langs and store it. This relies on a side
        // effect but can be removed once token is no longer used.
        const getTokenResult = await this.isAuthenticated();
        return getTokenResult.ok ? Ok.EMPTY : getTokenResult;
    }

    /**
     * Returns user's current authentication status. Uses TMC-langs `core logged-in` command
     * internally.
     *
     * @returns Boolean indicating if the user is authenticated.
     */
    public async isAuthenticated(): Promise<Result<boolean, Error>> {
        const loggedInResult = await this._executeLangsCommand(
            { args: ["logged-in"], core: true },
            createIs<ClientOauth2.Data | null>(),
        );
        if (loggedInResult.err) {
            return loggedInResult;
        }
        const response = loggedInResult.val;
        if (response.result === "not-logged-in") {
            if (!this._token) {
                return new Ok(false);
            }

            // Insider compatibility: If token exists but Langs didn't have it, pass it on.
            const setTokenResult = await this._executeLangsCommand(
                {
                    args: ["login", "--set-access-token", this._token.data.access_token],
                    core: true,
                },
                createIs<unknown>(),
            );
            if (setTokenResult.err) {
                return setTokenResult;
            }
        } else if (response.result === "logged-in" && response.data) {
            // Non-insider compatibility: keep stored token up to date
            this._token = new ClientOauth2.Token(this._oauth2, response.data);
            this._storage.updateAuthenticationToken(this._token.data);
        }
        return new Ok(this._token !== undefined);
    }

    /**
     * Deauthenticates current user. Uses TMC-langs `core logout` command internally.
     */
    public async deauthenticate(): Promise<Result<void, Error>> {
        const logoutResult = await this._executeLangsCommand(
            { args: ["logout"], core: true },
            createIs<unknown>(),
        );
        if (logoutResult.err) {
            return logoutResult;
        }
        this._token = undefined;
        this._storage.updateAuthenticationToken(undefined);
        return Ok.EMPTY;
    }

    // ---------------------------------------------------------------------------------------------
    // Non-core commands
    // ---------------------------------------------------------------------------------------------

    /**
     * Clears given exercise from extra files such as build files. Uses TMC-langs `clean` command
     * internally.
     *
     * @param id ID of the exercise to clean.
     */
    public async clean(id: number): Promise<Result<void, Error>> {
        if (!this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const exerciseFolderPath = this._workspaceManager.getExercisePathById(id);
        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        return this._executeLangsCommand(
            { args: ["clean", "--exercise-path", exerciseFolderPath.val], core: false },
            createIs<unknown>(),
            false,
        ).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Runs local tests for given exercise. Uses TMC-langs `run-tests` command internally.
     *
     * @param id ID of the exercise to test.
     * @param pythonExecutablePath Optional path to Python executable to use instead of the one
     * detected in PATH.
     */
    public runTests(
        id: number,
        pythonExecutablePath?: string,
    ): [Promise<Result<TmcLangsTestResultsRust, Error>>, () => void] {
        if (!this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }
        const exerciseFolderPath = this._workspaceManager.getExercisePathById(id);
        if (exerciseFolderPath.err) {
            return [Promise.resolve(exerciseFolderPath), (): void => {}];
        }

        const env: { [key: string]: string } = {};
        if (this._isInsider() && pythonExecutablePath) {
            env.TMC_LANGS_PYTHON_EXEC = pythonExecutablePath;
        }
        const { interrupt, result } = this._spawnLangsProcess({
            args: ["run-tests", "--exercise-path", exerciseFolderPath.val],
            core: false,
            env,
            onStderr: (data) => Logger.log("Rust Langs", data),
        });

        const postResult: Promise<Result<TmcLangsTestResultsRust, Error>> = result.then((res) => {
            if (res.err) {
                return res;
            }

            const last = _.last(res.val.stdout);
            if (!last) {
                return new Err(new Error("Langs response missing"));
            }

            return this._checkLangsResponse(last, createIs<TmcLangsTestResultsRust>()).map(
                (r) => r.data,
            );
        });

        return [postResult, interrupt];
    }

    // ---------------------------------------------------------------------------------------------
    // Core commands
    // ---------------------------------------------------------------------------------------------

    /**
     * Downloads an exercise to the provided filepath. Uses TMC-langs `download-or-update-exercise`
     * core command internally.
     *
     * @param id Id of the exercise to download.
     * @param exercisePath Filepath where the exercise should be downloaded to.
     */
    public async downloadExercise(
        id: number,
        exercisePath: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        progressCallback?: (downloadedPct: number, increment: number) => void,
    ): Promise<Result<void, Error>> {
        return this._executeLangsCommand(
            {
                args: ["download-or-update-exercises", "--exercise", id.toString(), exercisePath],
                core: true,
            },
            createIs<unknown>(),
            false,
        ).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Downloads user's old submission for a given exercise. Optionally submits the current state
     * of the exercise beforehand. Uses TMC-langs `download-old-submission` core command internally.
     *
     * @param exerciseId  Id of the exercise.
     * @param exercisePath Filepath where the old submission should be downloaded to.
     * @param submissionId Id of the exercise submission to download.
     * @param saveOldState Whether to submit the current state of the exercise beforehand.
     */
    public async downloadOldSubmission(
        exerciseId: number,
        exercisePath: string,
        submissionId: number,
        saveOldState: boolean,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        progressCallback?: (downloadedPct: number, increment: number) => void,
    ): Promise<Result<void, Error>> {
        const flags = saveOldState ? ["--save-old-state"] : [];
        const args = [
            "download-old-submission",
            ...flags,
            "--exercise-id",
            exerciseId.toString(),
            "--output-path",
            exercisePath,
            "--submission-id",
            submissionId.toString(),
        ];

        if (saveOldState) {
            args.push(
                "--submission-url",
                `${this._tmcApiUrl}core/exercises/${exerciseId}/submissions`,
            );
        }

        return this._executeLangsCommand(
            { args, core: true },
            createIs<unknown>(),
            false,
        ).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Gets all courses of the given organization. Results may vary depending on the user account's
     * priviledges. Uses TMC-langs `get-courses` core command internally.
     *
     * @param organization Slug of the organization.
     * @returns Array of the organization's courses.
     */
    public getCourses(organization: string, cache = false): Promise<Result<Course[], Error>> {
        return this._executeLangsCommand(
            { args: ["get-courses", "--organization", organization], core: true },
            createIs<Course[]>(),
            cache,
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets user-specific details of the given course. Uses TMC-langs `get-course-details` core
     * command internally.
     *
     * @param courseId Id to the course.
     * @returns Details of the course.
     */
    public async getCourseDetails(
        courseId: number,
        cache = false,
    ): Promise<Result<CourseDetails, Error>> {
        return this._executeLangsCommand(
            { args: ["get-course-details", "--course-id", courseId.toString()], core: true },
            createIs<CourseDetails["course"]>(),
            cache,
        ).then((res) => res.map((r) => ({ course: r.data })));
    }

    /**
     * Gets exercises of the given course. Each exercise includes information about available and
     * awarded points. Uses TMC-langs `get-course-exercises` core command internally.
     *
     * @param courseId Id of the course.
     * @returns Array of the course's exercises.
     */
    public async getCourseExercises(
        courseId: number,
        cache = false,
    ): Promise<Result<CourseExercise[], Error>> {
        return this._executeLangsCommand(
            { args: ["get-course-exercises", "--course-id", courseId.toString()], core: true },
            createIs<CourseExercise[]>(),
            cache,
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets general course info of the given course. Uses TMC-langs `get-course-settings` core
     * command internally.
     *
     * @param courseId Id of the course.
     * @returns Info of the course.
     */
    public getCourseSettings(
        courseId: number,
        cache = false,
    ): Promise<Result<CourseSettings, Error>> {
        return this._executeLangsCommand(
            {
                args: ["get-course-settings", "--course-id", courseId.toString()],
                core: true,
            },
            createIs<CourseSettings>(),
            cache,
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets details of the given exercise. Uses TMC-langs `get-exercise-details` core command
     * internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns Details of the exercise.
     */
    public async getExerciseDetails(
        exerciseId: number,
        cache = false,
    ): Promise<Result<ExerciseDetails, Error>> {
        return this._executeLangsCommand(
            {
                args: ["get-exercise-details", "--exercise-id", exerciseId.toString()],
                core: true,
            },
            createIs<ExerciseDetails>(),
            cache,
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets user's old submissions for the given exercise. Uses TMC-langs `get-exercise-submissions`
     * core command internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns Array of old submissions.
     */
    public async getOldSubmissions(exerciseId: number): Promise<Result<OldSubmission[], Error>> {
        return this._executeLangsCommand(
            {
                args: ["get-exercise-submissions", "--exercise-id", exerciseId.toString()],
                core: true,
            },
            createIs<OldSubmission[]>(),
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets data of the given organization. Uses TMC-langs `get-organization` core command
     * internally.
     *
     * @param organizationSlug Slug of the organization.
     * @returns Organization matching the given slug.
     */
    public async getOrganization(
        organizationSlug: string,
        cache = false,
    ): Promise<Result<Organization, Error>> {
        return this._executeLangsCommand(
            { args: ["get-organization", "--organization", organizationSlug], core: true },
            createIs<Organization>(),
            cache,
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets all organizations. Uses TMC-langs `get-organizations` core command internally.
     *
     * @returns A list of organizations.
     */
    public async getOrganizations(cache = false): Promise<Result<Organization[], Error>> {
        return this._executeLangsCommand(
            { args: ["get-organizations"], core: true },
            createIs<Organization[]>(),
            cache,
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Reverts given exercise to its original template. Optionally submits the current state
     * of the exercise beforehand. Uses TMC-langs `reset-exercise` core command internally.
     *
     * @param exerciseId Id of the exercise.
     * @param saveOldState Whether to submit current state of the exercise before reseting it.
     */
    public async resetExercise(
        exerciseId: number,
        saveOldState: boolean,
    ): Promise<Result<void, Error>> {
        if (!this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }
        const exerciseFolderPath = this._workspaceManager.getExercisePathById(exerciseId);
        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        const flags = saveOldState ? ["--save-old-state"] : [];
        const args = [
            "reset-exercise",
            ...flags,
            "--exercise-id",
            exerciseId.toString(),
            "--exercise-path",
            exerciseFolderPath.val,
        ];
        if (saveOldState) {
            args.push(
                "--submission-url",
                `${this._tmcApiUrl}core/exercises/${exerciseId}/submissions`,
            );
        }

        const result = await this._executeLangsCommand({ args, core: true }, createIs<unknown>());
        if (result.err) {
            return result;
        }

        Logger.debug("reset-exercise", result.val);
        return Ok.EMPTY;
    }

    /**
     * Submits given exercise to server. Uses TMC-langs `submit` core command internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns Response for sending the exercise.
     */
    public async submitExercise(exerciseId: number): Promise<Result<SubmissionResponse, Error>> {
        if (!this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const exerciseFolderPath = this._workspaceManager.getExercisePathById(exerciseId);
        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        const submitUrl = `${this._tmcApiUrl}core/exercises/${exerciseId}/submissions`;

        return this._executeLangsCommand(
            {
                args: [
                    "submit",
                    "--dont-block",
                    "--submission-path",
                    exerciseFolderPath.val,
                    "--submission-url",
                    submitUrl,
                ],
                core: true,
            },
            createIs<SubmissionResponse>(),
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Submits an exercise to server and waits for test results. Uses TMC-langs `submit` core
     * command internally.
     *
     * @param exerciseId Id of the exercise.
     * @param progressCallback Optional callback function that can be used to get status reports.
     */
    public async submitExerciseAndWaitForResults(
        exerciseId: number,
        progressCallback?: (progressPct: number, message?: string) => void,
    ): Promise<Result<SubmissionStatusReport, Error>> {
        if (!this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const exerciseFolderPath = this._workspaceManager.getExercisePathById(exerciseId);
        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        const submitUrl = `${this._tmcApiUrl}core/exercises/${exerciseId}/submissions`;

        return this._executeLangsCommand(
            {
                args: [
                    "submit",
                    "--submission-path",
                    exerciseFolderPath.val,
                    "--submission-url",
                    submitUrl,
                ],
                core: true,
                onStdout: (res) =>
                    progressCallback?.(50 * res["percent-done"], res.message || undefined),
            },
            createIs<SubmissionStatusReport>(),
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Submits given exercise to TMC Paste and provides a link to it. Uses TMC-langs `paste` core
     * command internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns TMC paste link.
     */
    public async submitExerciseToPaste(exerciseId: number): Promise<Result<string, Error>> {
        if (!this._workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const exerciseFolderPath = this._workspaceManager.getExercisePathById(exerciseId);
        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        const submitUrl = `${this._tmcApiUrl}core/exercises/${exerciseId}/submissions`;

        return this._executeLangsCommand(
            {
                args: [
                    "paste",
                    "--locale",
                    "eng",
                    "--submission-path",
                    exerciseFolderPath.val,
                    "--submission-url",
                    submitUrl,
                ],
                core: true,
            },
            createIs<SubmissionResponse>(),
        ).then((res) => res.map((r) => r.data.paste_url));
    }

    /**
     * Submits feedback for an exercise. Uses TMC-langs `send-feedback` core command internally.
     *
     * @param feedbackUrl URL for feedback. Usually provided by a successful exercise submission.
     * @param feedback Feedback to submit.
     * @returns Response from submitting the feedback.
     */
    public async submitSubmissionFeedback(
        feedbackUrl: string,
        feedback: SubmissionFeedback,
    ): Promise<Result<SubmissionFeedbackResponse, Error>> {
        const feedbackArgs = feedback.status.reduce<string[]>(
            (acc, next) => acc.concat("--feedback", next.question_id.toString(), next.answer),
            [],
        );
        return this._executeLangsCommand(
            {
                args: ["send-feedback", ...feedbackArgs, "--feedback-url", feedbackUrl],
                core: true,
            },
            createIs<SubmissionFeedbackResponse>(),
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Executes a tmc-langs-cli process with given arguments to the completion and handles
     * validation for the last response received from the process.
     *
     * @param langsArgs Command arguments passed on to spawnLangsProcess.
     * @param checker Checker function used to validate the type of data-property.
     * @param useCache Whether to try fetching the data from cache instead of running the process.
     * @returns Result that resolves to a checked LansResponse.
     */
    private async _executeLangsCommand<T>(
        langsArgs: RustProcessArgs,
        checker: (object: unknown) => object is T,
        useCache = false,
    ): Promise<Result<LangsResponse<T>, Error>> {
        const cacheKey = langsArgs.args.join("-");
        let cached: LangsResponse<unknown> | undefined;
        if (useCache && (cached = this._rustCache.get(cacheKey))) {
            if (checker(cached.data)) {
                return new Ok({ ...cached, data: cached.data });
            } else {
                // This should NEVER have to happen
                Logger.error("Cached data for key didn't match the expected type, re-fetching...");
                Logger.debug(cacheKey, cached.data);
            }
        }
        const result = await this._spawnLangsProcess(langsArgs).result;
        if (result.err) {
            return result;
        }
        const last = _.last(result.val.stdout);
        if (last === undefined) {
            return new Err(new Error("No langs response received"));
        }
        const checked = this._checkLangsResponse(last, checker);
        if (checked.err) {
            return checked;
        }
        this._rustCache.set(cacheKey, checked.val);
        return new Ok(checked.val);
    }

    /**
     * Checks langs response for generic errors.
     */
    private _checkLangsResponse<T>(
        langsResponse: UncheckedLangsResponse,
        checker: (object: unknown) => object is T,
    ): Result<LangsResponse<T>, Error> {
        const { data, result, status } = langsResponse;
        const message = langsResponse.message || "null";
        if (status === "crashed") {
            if (is<string[]>(data)) {
                const msg = "Langs process crashed: ";
                Logger.error(msg, data.join("\n"));
                return new Err(new RuntimeError(msg + message, data.join("\n")));
            }
            return new Err(new Error("Langs process crashed: " + message));
        }
        if (result === "error") {
            if (is<LangsError>(data)) {
                const { kind, trace } = data;
                const traceString = trace.join("\n");
                Logger.error("TMC Langs errored.", kind, traceString);
                if (kind === "generic") {
                    return new Err(new RuntimeError(message, traceString));
                } else if (kind === "authorization-error") {
                    return new Err(new AuthorizationError(message, traceString));
                } else if (kind === "connection-error") {
                    return new Err(new ConnectionError(message, traceString));
                }
            }
            Logger.error("Unexpected langs error type.");
            return new Err(new ApiError(message));
        }
        if (!checker(data)) {
            Logger.debug("Unexpected response data type: ", data);
            return new Err(new ApiError("Unexpected response data type."));
        }
        return new Ok({ ...langsResponse, data, result, status });
    }

    /**
     * Spawns a new tmc-langs-cli process with given arguments.
     *
     * @returns Rust process runner.
     */
    private _spawnLangsProcess(commandArgs: RustProcessArgs): RustProcessRunner {
        const { args, core, env, onStderr, onStdout, stdin } = commandArgs;
        const CORE_ARGS = [
            "core",
            "--client-name",
            CLIENT_NAME,
            "--client-version",
            this._resources.extensionVersion,
        ];

        let stderr = "";
        const stdout: UncheckedLangsResponse[] = [];
        let stdoutBuffer = "";

        const executable = this._resources.getCliPath();
        const executableArgs = core ? CORE_ARGS.concat(args) : args;

        let active = true;
        let interrupted = false;
        Logger.log([executable, ...executableArgs].map((x) => JSON.stringify(x)).join(" "));
        const cprocess = cp.spawn(executable, executableArgs, {
            env: { ...process.env, ...env, RUST_LOG: "debug" },
        });
        stdin && cprocess.stdin.write(stdin + "\n");

        const processResult = new Promise<number | null>((resolve, reject) => {
            // let resultCode: number | null = null;
            // let stdoutEnded = false;

            // TODO: move to rust
            const timeout = setTimeout(() => {
                kill(cprocess.pid);
                reject("Process didn't seem to finish or was taking a really long time.");
            }, TMC_LANGS_TIMEOUT);

            cprocess.on("error", (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            cprocess.stderr.on("data", (chunk) => {
                const data = chunk.toString();
                stderr += data;
                onStderr?.(data);
            });
            // cprocess.stdout.on("end", () => {
            //     stdoutEnded = true;
            //     if (resultCode) {
            //         clearTimeout(timeout);
            //         resolve(resultCode);
            //     }
            // });
            cprocess.on("exit", (code) => {
                // resultCode = code;
                // if (stdoutEnded) {
                clearTimeout(timeout);
                resolve(code);
                // }
            });
            cprocess.stdout.on("data", (chunk) => {
                const parts = (stdoutBuffer + chunk.toString()).split("\n");
                stdoutBuffer = parts.pop() || "";
                for (const part of parts) {
                    try {
                        const json = JSON.parse(part.trim());
                        if (is<UncheckedLangsResponse>(json)) {
                            stdout.push(json);
                            onStdout?.(json);
                        } else {
                            Logger.error("TMC-langs response didn't match expected type");
                            Logger.debug(part);
                        }
                    } catch (e) {
                        Logger.warn("Failed to parse TMC-langs output");
                        Logger.debug(part);
                    }
                }
            });
        });

        const result = (async (): RustProcessRunner["result"] => {
            try {
                await processResult;
                while (!cprocess.stdout.destroyed) {
                    Logger.debug("stdout still active, waiting...");
                    await sleep(50);
                }
            } catch (error) {
                return new Err(new RuntimeError(error));
            }

            if (interrupted) {
                return new Err(new RuntimeError("TMC Langs process was killed."));
            }

            if (stdoutBuffer !== "") {
                Logger.warn("Failed to parse some TMC Langs output");
                Logger.debug(stdoutBuffer);
            }

            return new Ok({
                stderr,
                stdout,
            });
        })();

        const interrupt = (): void => {
            if (active) {
                active = false;
                interrupted = true;
                kill(cprocess.pid);
            }
        };

        return { interrupt, result };
    }
}

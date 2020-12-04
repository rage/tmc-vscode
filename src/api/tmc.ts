import * as cp from "child_process";
import * as ClientOauth2 from "client-oauth2";
import * as kill from "tree-kill";
import { Err, Ok, Result } from "ts-results";
import { createIs, is } from "typescript-is";

import {
    ApiError,
    AuthenticationError,
    AuthorizationError,
    ConnectionError,
    EmptyLangsResponseError,
    ForbiddenError,
    InvalidTokenError,
    ObsoleteClientError,
    RuntimeError,
} from "../errors";
import { Logger } from "../utils/logger";
import { showError, showWarning } from "../window";

import { LangsError, LangsOutputData, LangsStatusUpdate, LangsWarning } from "./langsSchema";
import {
    Course,
    CourseData,
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
    TestResults,
} from "./types";

const API_CACHE_LIFETIME = 5 * 60 * 1000;
const CLI_PROCESS_TIMEOUT = 2 * 60 * 1000;

interface Options {
    apiCacheLifetime?: string;
    cliConfigDir?: string;
    cliExecutionTimeout?: number;
}

interface LangsProcessArgs {
    args: string[];
    core: boolean;
    env?: { [key: string]: string };
    /** Which args should be obfuscated in logs. */
    obfuscate?: number[];
    onStderr?: (data: string) => void;
    onStdout?: (data: LangsStatusUpdate<unknown>) => void;
    stdin?: string;
}

interface LangsProcessRunner<T> {
    interrupt(): void;
    result: Promise<Result<LangsOutputData<T>, Error>>;
}

interface ResponseCacheEntry {
    response: LangsOutputData<unknown>;
    timestamp: number;
}

interface CacheOptions {
    forceRefresh?: boolean;
}

interface CacheConfig<T1, T2> {
    forceRefresh?: boolean;
    key: string;
    /** Optional remapper for assigning parts of the result to different keys. */
    remapper?: (response: LangsOutputData<T1>) => Array<[string, LangsOutputData<T2>]>;
}

/**
 * A Class that provides an interface to all TMC services.
 */
export default class TMC {
    private readonly _options: Options;
    private readonly _responseCache: Map<string, ResponseCacheEntry>;
    private _onLogin?: () => void;
    private _onLogout?: () => void;

    /**
     * Creates a new instance of TMC interface class.
     *
     * @param configuration
     */
    constructor(
        private readonly cliPath: string,
        private readonly clientName: string,
        private readonly clientVersion: string,
        private readonly apiRootUrl: string,
        options?: Options,
    ) {
        this._options = { ...options };
        this._responseCache = new Map();
    }

    /**
     * Sets the callback to an event. Will overwrite previous callback for the specified event.
     *
     * @param event Event to subscribe to.
     * @param callback Eventhandler to invoke on event.
     */
    public on(event: "login" | "logout", callback: () => void): void {
        switch (event) {
            case "login":
                this._onLogin = callback;
                break;
            case "logout":
                this._responseCache.clear();
                this._onLogout = callback;
                break;
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Authentication commands
    // ---------------------------------------------------------------------------------------------

    /**
     * Authenticates user to TMC services. Uses TMC-langs `login` core command internally.
     *
     * This operation will fails if wrong credentials are provided or if the user is already signed
     * in.
     *
     * @param username Username or email.
     * @param password Password.
     */
    public async authenticate(username: string, password: string): Promise<Result<void, Error>> {
        const loginResult = await this._executeLangsCommand(
            {
                args: ["login", "--email", username, "--base64"],
                core: true,
                obfuscate: [2],
                stdin: Buffer.from(password).toString("base64"),
            },
            createIs<unknown>(),
        );
        if (loginResult.err) {
            return Err(new AuthenticationError(loginResult.val.message));
        }

        this._onLogin?.();
        return Ok.EMPTY;
    }

    /**
     * Passes an access token to TMC-langs. Uses TMC-langs `login` core command internally.
     *
     * @deprecated Since version 1.0.0. Should only be used for passing the token to TMC-langs from
     * older versions.
     *
     * @param token Authorization token.
     */
    public async setAuthenticationToken(token: ClientOauth2.Data): Promise<Result<void, Error>> {
        const setTokenResult = await this._executeLangsCommand(
            {
                args: ["login", "--set-access-token", token.access_token],
                core: true,
                obfuscate: [2],
            },
            createIs<unknown>(),
        );

        if (setTokenResult.err) {
            return setTokenResult;
        }

        this._onLogin?.();
        return Ok.EMPTY;
    }

    /**
     * Returns user's current authentication status. Uses TMC-langs `logged-in` core command
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

        switch (loggedInResult.val.result) {
            case "logged-in":
                return new Ok(true);
            case "not-logged-in":
                return new Ok(false);
            default:
                return Err(new Error(`Unexpected langs result: ${loggedInResult.val.result}`));
        }
    }

    /**
     * Deauthenticates current user. Uses TMC-langs `logout` core command internally.
     */
    public async deauthenticate(): Promise<Result<void, Error>> {
        const logoutResult = await this._executeLangsCommand(
            { args: ["logout"], core: true },
            createIs<unknown>(),
        );
        if (logoutResult.err) {
            return logoutResult;
        }

        this._onLogout?.();
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
    public async clean(exercisePath: string): Promise<Result<void, Error>> {
        return this._executeLangsCommand(
            { args: ["clean", "--exercise-path", exercisePath], core: false },
            createIs<unknown>(),
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
        exercisePath: string,
        pythonExecutablePath?: string,
    ): [Promise<Result<TestResults, Error>>, () => void] {
        const env: { [key: string]: string } = {};
        if (pythonExecutablePath) {
            env.TMC_LANGS_PYTHON_EXEC = pythonExecutablePath;
        }
        const { interrupt, result } = this._spawnLangsProcess({
            args: ["run-tests", "--exercise-path", exercisePath],
            core: false,
            env,
            onStderr: (data) => Logger.log("Rust Langs", data),
        });
        const postResult = result.then((res) =>
            res
                .andThen((x) => this._checkLangsResponse(x, createIs<TestResults>()))
                .map((x) => x.data),
        );

        return [postResult, interrupt];
    }

    public async getSetting(key: string): Promise<Result<string, Error>> {
        return this._executeLangsCommand(
            {
                args: ["settings", "--client-name", this.clientName, "get", key],
                core: false,
            },
            createIs<string>(),
        ).then((x) => x.map((x) => x.data));
    }

    public async setSetting(key: string, value: string): Promise<Result<void, Error>> {
        return this._executeLangsCommand(
            {
                args: ["settings", "--client-name", this.clientName, "set", key, value],
                core: false,
            },
            createIs<unknown>(),
        ).then((x) => x.andThen(() => Ok.EMPTY));
    }

    // ---------------------------------------------------------------------------------------------
    // Core commands
    // ---------------------------------------------------------------------------------------------

    /**
     * @deprecated - Migrate to `downloadExercises`
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
        ).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Downloads multiple exercises to TMC-langs' configured project directory. Uses TMC-langs
     * `download-or-update-course-exercises` core command internally.
     *
     * @param ids Ids of the exercises to download.
     */
    public async downloadExercises(
        ids: number[],
        onDownloaded?: (download: { id: number; path: string }) => void,
    ): Promise<Result<void, Error>> {
        const onStdout = (res: LangsStatusUpdate<unknown>): void => {
            if (is<{ ExerciseDownload: { id: number; path: string } }>(res.data)) {
                onDownloaded?.(res.data.ExerciseDownload);
            }
        };

        return this._executeLangsCommand(
            {
                args: [
                    "download-or-update-course-exercises",
                    "--exercise-id",
                    ...ids.map((id) => id.toString()),
                ],
                core: true,
                onStdout,
            },
            createIs<unknown>(),
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
                `${this.apiRootUrl}/api/v8/core/exercises/${exerciseId}/submissions`,
            );
        }

        return this._executeLangsCommand({ args, core: true }, createIs<unknown>()).then((res) =>
            res.err ? res : Ok.EMPTY,
        );
    }

    /**
     * Gets all courses of the given organization. Results may vary depending on the user account's
     * priviledges. Uses TMC-langs `get-courses` core command internally.
     *
     * @param organization Slug of the organization.
     * @returns Array of the organization's courses.
     */
    public getCourses(
        organization: string,
        options?: CacheOptions,
    ): Promise<Result<Course[], Error>> {
        return this._executeLangsCommand(
            { args: ["get-courses", "--organization", organization], core: true },
            createIs<Course[]>(),
            { forceRefresh: options?.forceRefresh, key: `organization-${organization}-courses` },
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets user-specific data of the given course. Uses TMC-langs `get-course-data` core
     * command internally.
     *
     * @param courseId Id to the course.
     * @returns A combination of getCourseDetails, getCourseExercises, getCourseSettings.
     */
    public async getCourseData(
        courseId: number,
        options?: CacheOptions,
    ): Promise<Result<CourseData, Error>> {
        const remapper: CacheConfig<CourseData, unknown>["remapper"] = (response) => {
            const { details, exercises, settings } = response.data;
            return [
                [`course-${courseId}-details`, { ...response, data: details }],
                [`course-${courseId}-exercises`, { ...response, data: exercises }],
                [`course-${courseId}-settings`, { ...response, data: settings }],
            ];
        };

        return this._executeLangsCommand<CourseData>(
            { args: ["get-course-data", "--course-id", courseId.toString()], core: true },
            createIs<CourseData>(),
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-data`, remapper },
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
        options?: CacheOptions,
    ): Promise<Result<CourseDetails, Error>> {
        return this._executeLangsCommand(
            { args: ["get-course-details", "--course-id", courseId.toString()], core: true },
            createIs<CourseDetails["course"]>(),
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-details` },
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
        options?: CacheOptions,
    ): Promise<Result<CourseExercise[], Error>> {
        return this._executeLangsCommand(
            { args: ["get-course-exercises", "--course-id", courseId.toString()], core: true },
            createIs<CourseExercise[]>(),
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-exercises` },
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
        options?: CacheOptions,
    ): Promise<Result<CourseSettings, Error>> {
        return this._executeLangsCommand(
            { args: ["get-course-settings", "--course-id", courseId.toString()], core: true },
            createIs<CourseSettings>(),
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-settings` },
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
        options?: CacheOptions,
    ): Promise<Result<ExerciseDetails, Error>> {
        return this._executeLangsCommand(
            {
                args: ["get-exercise-details", "--exercise-id", exerciseId.toString()],
                core: true,
            },
            createIs<ExerciseDetails>(),
            { forceRefresh: options?.forceRefresh, key: `exercise-${exerciseId}-details` },
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
        options?: CacheOptions,
    ): Promise<Result<Organization, Error>> {
        return this._executeLangsCommand(
            { args: ["get-organization", "--organization", organizationSlug], core: true },
            createIs<Organization>(),
            { forceRefresh: options?.forceRefresh, key: `organization-${organizationSlug}` },
        ).then((res) => res.map((r) => r.data));
    }

    /**
     * Gets all organizations. Uses TMC-langs `get-organizations` core command internally.
     *
     * @returns A list of organizations.
     */
    public async getOrganizations(options?: CacheOptions): Promise<Result<Organization[], Error>> {
        const remapper: CacheConfig<Organization[], unknown>["remapper"] = (res) =>
            res.data.map((x) => [`organization-${x.slug}`, { ...res, data: x }]);

        return this._executeLangsCommand(
            { args: ["get-organizations"], core: true },
            createIs<Organization[]>(),
            { forceRefresh: options?.forceRefresh, key: "organizations", remapper },
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
        exercisePath: string,
        saveOldState: boolean,
    ): Promise<Result<void, Error>> {
        const flags = saveOldState ? ["--save-old-state"] : [];
        const args = [
            "reset-exercise",
            ...flags,
            "--exercise-id",
            exerciseId.toString(),
            "--exercise-path",
            exercisePath,
        ];
        if (saveOldState) {
            args.push(
                "--submission-url",
                `${this.apiRootUrl}/api/v8/core/exercises/${exerciseId}/submissions`,
            );
        }

        const result = await this._executeLangsCommand({ args, core: true }, createIs<unknown>());
        if (result.err) {
            return result;
        }

        return Ok.EMPTY;
    }

    /**
     * Submits given exercise to server. Uses TMC-langs `submit` core command internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns Response for sending the exercise.
     */
    public async submitExercise(
        exerciseId: number,
        exercisePath: string,
    ): Promise<Result<SubmissionResponse, Error>> {
        const submitUrl = `${this.apiRootUrl}/api/v8/core/exercises/${exerciseId}/submissions`;

        return this._executeLangsCommand(
            {
                args: [
                    "submit",
                    "--dont-block",
                    "--submission-path",
                    exercisePath,
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
        exercisePath: string,
        progressCallback?: (progressPct: number, message?: string) => void,
        onSubmissionUrl?: (url: string) => void,
    ): Promise<Result<SubmissionStatusReport, Error>> {
        const submitUrl = `${this.apiRootUrl}/api/v8/core/exercises/${exerciseId}/submissions`;
        const onStdout = (res: LangsStatusUpdate<unknown>): void => {
            progressCallback?.(100 * res["percent-done"], res.message ?? undefined);
            if (is<{ PostedSubmission: SubmissionResponse }>(res.data)) {
                onSubmissionUrl?.(res.data.PostedSubmission.show_submission_url);
            }
        };

        return this._executeLangsCommand(
            {
                args: ["submit", "--submission-path", exercisePath, "--submission-url", submitUrl],
                core: true,
                onStdout,
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
    public async submitExerciseToPaste(
        exerciseId: number,
        exercisePath: string,
    ): Promise<Result<string, Error>> {
        const submitUrl = `${this.apiRootUrl}/api/v8/core/exercises/${exerciseId}/submissions`;

        return this._executeLangsCommand(
            {
                args: ["paste", "--submission-path", exercisePath, "--submission-url", submitUrl],
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
     * @param cacheKey Key used for storing and accessing cached data. Required with useCache.
     * @param cacheTransformer Optional transformer function that can be used to split summary
     * responses.
     * @returns Result that resolves to a checked LansResponse.
     */
    private async _executeLangsCommand<T>(
        langsArgs: LangsProcessArgs,
        checker: (object: unknown) => object is T,
        cacheConfig?: CacheConfig<T, unknown>,
    ): Promise<Result<LangsOutputData<T>, Error>> {
        const cacheKey = cacheConfig?.key;
        const currentTime = Date.now();
        if (!cacheConfig?.forceRefresh && cacheKey) {
            const cachedEntry = this._responseCache.get(cacheKey);
            if (cachedEntry) {
                const { response, timestamp } = cachedEntry;
                const cachedDataLifeLeft = timestamp + API_CACHE_LIFETIME - currentTime;
                if (checker(response.data)) {
                    if (cachedDataLifeLeft > 0) {
                        const prettySecondsLeft = Math.ceil(cachedDataLifeLeft / 1000);
                        Logger.log(
                            `Using cached data for key: ${cacheKey}. Still valid for ${prettySecondsLeft}s`,
                        );
                        return Ok({ ...response, data: response.data });
                    }
                    Logger.debug(`Discarding invalidated cache data for key: ${cacheKey}`);
                    this._responseCache.delete(cacheKey);
                } else {
                    Logger.debug(`Incorrect cache data type for key: ${cacheKey}`);
                }
            }
        }

        const result = (await this._spawnLangsProcess(langsArgs).result).andThen((x) =>
            this._checkLangsResponse(x, checker),
        );
        if (result.err) {
            return result;
        }

        const response = result.val;
        if (cacheKey) {
            this._responseCache.set(cacheKey, { response, timestamp: currentTime });
            cacheConfig?.remapper?.(result.val).forEach(([key, response]) => {
                this._responseCache.set(key, { response, timestamp: currentTime });
            });
        }

        return Ok(response);
    }

    /**
     * Checks langs response for generic errors.
     */
    private _checkLangsResponse<T>(
        langsResponse: LangsOutputData<unknown>,
        checker: (object: unknown) => object is T,
    ): Result<LangsOutputData<T>, Error> {
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
                switch (kind) {
                    case "connection-error":
                        return new Err(new ConnectionError(message, traceString));
                    case "forbidden":
                        return new Err(new ForbiddenError(message, traceString));
                    case "invalid-token":
                        this._onLogout?.();
                        showError("Your TMC session has expired, please log in.");
                        return new Err(new InvalidTokenError(message));
                    case "not-logged-in":
                        this._onLogout?.();
                        return new Err(new AuthorizationError(message, traceString));
                    case "obsolete-client":
                        return new Err(
                            new ObsoleteClientError(
                                message +
                                    "\nYour TMC Extension is out of date, please update it." +
                                    "\nhttps://code.visualstudio.com/docs/editor/extension-gallery",
                                traceString,
                            ),
                        );
                    default:
                        return new Err(new RuntimeError(message, traceString));
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
    private _spawnLangsProcess(commandArgs: LangsProcessArgs): LangsProcessRunner<unknown> {
        const { args, core, env, obfuscate, onStderr, onStdout, stdin } = commandArgs;
        const CORE_ARGS = [
            "core",
            "--client-name",
            this.clientName,
            "--client-version",
            this.clientVersion,
        ];

        let theResult: LangsOutputData<unknown> | undefined;
        let stdoutBuffer = "";

        const executableArgs = core ? CORE_ARGS.concat(args) : args;
        const obfuscatedArgs = args.map((x, i) => (obfuscate?.includes(i) ? "***" : x));
        const logableArgs = core ? CORE_ARGS.concat(obfuscatedArgs) : obfuscatedArgs;
        Logger.log(
            "Run: " + [this.cliPath, ...logableArgs].map((x) => JSON.stringify(x)).join(" "),
        );

        let active = true;
        let interrupted = false;
        const cprocess = cp.spawn(this.cliPath, executableArgs, {
            env: {
                ...process.env,
                ...env,
                RUST_LOG: "debug",
                TMC_LANGS_ROOT_URL: this.apiRootUrl,
                TMC_LANGS_CONFIG_DIR: this._options.cliConfigDir,
            },
        });
        stdin && cprocess.stdin.write(stdin + "\n");

        const processResult = new Promise<number | null>((resolve, reject) => {
            let resultCode: number | undefined;
            let stdoutEnded = false;

            const timeout = setTimeout(() => {
                kill(cprocess.pid);
                reject("Process didn't seem to finish or was taking a really long time.");
            }, CLI_PROCESS_TIMEOUT);

            cprocess.on("error", (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            cprocess.stderr.on("data", (chunk) => {
                onStderr?.(chunk.toString());
            });
            cprocess.stdout.on("end", () => {
                stdoutEnded = true;
                if (resultCode !== undefined) {
                    clearTimeout(timeout);
                    resolve(resultCode);
                }
            });
            cprocess.on("exit", (code) => {
                resultCode = code ?? 0;
                if (stdoutEnded) {
                    clearTimeout(timeout);
                    resolve(code);
                }
            });
            cprocess.stdout.on("data", (chunk) => {
                const parts = (stdoutBuffer + chunk.toString()).split("\n");
                stdoutBuffer = parts.pop() || "";
                for (const part of parts) {
                    try {
                        const json = JSON.parse(part.trim());
                        if (is<LangsStatusUpdate<unknown>>(json)) {
                            onStdout?.(json);
                        } else if (is<LangsOutputData<unknown>>(json)) {
                            theResult = json;
                        } else if (is<LangsWarning>(json)) {
                            if (json.warnings.length !== 0) {
                                showWarning(json.warnings.join("\n"));
                            }
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

        const result = (async (): LangsProcessRunner<unknown>["result"] => {
            try {
                await processResult;
            } catch (error) {
                return Err(new RuntimeError(error));
            }

            if (interrupted) {
                return Err(new RuntimeError("TMC Langs process was killed."));
            }

            if (stdoutBuffer !== "") {
                Logger.warn("Failed to parse some TMC Langs output");
                Logger.debug(stdoutBuffer);
            }

            return theResult
                ? Ok(theResult)
                : Err(new EmptyLangsResponseError("Langs process ended without result data."));
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

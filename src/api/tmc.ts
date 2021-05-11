import * as cp from "child_process";
import * as kill from "tree-kill";
import { Err, Ok, Result } from "ts-results";
import { is } from "typescript-is";

import {
    API_CACHE_LIFETIME,
    CLI_PROCESS_TIMEOUT,
    MINIMUM_SUBMISSION_INTERVAL,
    TMC_BACKEND_URL,
} from "../config/constants";
import {
    AuthenticationError,
    AuthorizationError,
    BottleneckError,
    ConnectionError,
    EmptyLangsResponseError,
    ForbiddenError,
    InvalidTokenError,
    ObsoleteClientError,
    RuntimeError,
} from "../errors";
import { Logger } from "../utils/logger";

import {
    CombinedCourseData,
    Data,
    DownloadOrUpdateCourseExercisesResult,
    FailedExerciseDownload,
    LocalExercise,
    Output,
    OutputData,
    RunResult,
    StatusUpdateData,
    UpdatedExercise,
} from "./langsSchema";
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
    SubmissionResultReport,
    SubmissionStatusReport,
    TestResults,
} from "./types";

interface Options {
    apiCacheLifetime?: string;
    cliConfigDir?: string;
    timeout?: number;
}

interface ExecutionOptions {
    timeout: number;
}

interface LangsProcessArgs {
    args: string[];
    core: boolean;
    env?: { [key: string]: string };
    /** Which args should be obfuscated in logs. */
    obfuscate?: number[];
    onStderr?: (data: string) => void;
    onStdout?: (data: StatusUpdateData) => void;
    stdin?: string;
    processTimeout?: number;
}

interface LangsProcessRunner {
    interrupt(): void;
    result: Promise<Result<OutputData, Error>>;
}

interface ResponseCacheEntry {
    response: OutputData;
    timestamp: number;
}

interface CacheOptions {
    forceRefresh?: boolean;
}

interface CacheConfig {
    forceRefresh?: boolean;
    key: string;
    /** Optional remapper for assigning parts of the result to different keys. */
    remapper?: (response: OutputData) => Array<[string, OutputData]>;
}

/**
 * A Class that provides an interface to all TMC services.
 */
export default class TMC {
    private static readonly _exerciseUpdatesCacheKey = "exercise-updates";

    private _nextSubmissionAllowedTimestamp: number;
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
        options?: Options,
    ) {
        this._nextSubmissionAllowedTimestamp = 0;
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
        const loginResult = await this._executeLangsCommand({
            args: ["login", "--email", username, "--base64"],
            core: true,
            obfuscate: [2],
            stdin: Buffer.from(password).toString("base64"),
        });
        if (loginResult.err) {
            return Err(new AuthenticationError(loginResult.val.message));
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
    public async isAuthenticated(options?: ExecutionOptions): Promise<Result<boolean, Error>> {
        const loggedInResult = await this._executeLangsCommand({
            args: ["logged-in"],
            core: true,
            processTimeout: options?.timeout,
        });
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
        const logoutResult = await this._executeLangsCommand({ args: ["logout"], core: true });
        if (logoutResult.err) {
            return logoutResult;
        }

        this._responseCache.clear();
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
        return this._executeLangsCommand({
            args: ["clean", "--exercise-path", exercisePath],
            core: false,
        }).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Lists local exercises for given course. Uses TMC-langs `list-local-course-exercises` command
     * internally.
     *
     * @param courseSlug Course which's exercises should be listed.
     */
    public async listLocalCourseExercises(
        courseSlug: string,
    ): Promise<Result<LocalExercise[], Error>> {
        return (
            await this._executeLangsCommand({
                args: [
                    "list-local-course-exercises",
                    "--client-name",
                    this.clientName,
                    "--course-slug",
                    courseSlug,
                ],
                core: false,
            })
        ).andThen<LocalExercise[], Error>((x) =>
            x.data?.["output-data-kind"] === "local-exercises"
                ? Ok(x.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
    }

    /**
     * Moves this instance's projects directory on disk. Uses TMC-langs `settings move-projects-dir`
     * setting internally.
     *
     * @param newDirectory New location for projects directory.
     * @param onUpdate Progress callback.
     */
    public async moveProjectsDirectory(
        newDirectory: string,
        onUpdate?: (value: { percent: number; message?: string }) => void,
    ): Promise<Result<void, Error>> {
        const onStdout = (res: StatusUpdateData): void => {
            onUpdate?.({
                percent: res["percent-done"],
                message: res.message ?? undefined,
            });
        };

        return this._executeLangsCommand({
            args: ["settings", "--client-name", this.clientName, "move-projects-dir", newDirectory],
            core: false,
            onStdout,
        }).then((res) => (res.err ? res : Ok.EMPTY));
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
            processTimeout: CLI_PROCESS_TIMEOUT,
        });
        const postResult = result.then((res) =>
            res
                .andThen(this._checkLangsResponse)
                .andThen<RunResult, Error>((x) =>
                    x.data?.["output-data-kind"] === "test-result"
                        ? Ok(x.data["output-data"])
                        : Err(new Error("Unexpected Langs result.")),
                ),
        );

        return [postResult, interrupt];
    }

    // ---------------------------------------------------------------------------------------------
    // Settings commands
    // ---------------------------------------------------------------------------------------------

    /**
     * Migrates exercise under TMC-langs's management. The new location will be determined by
     * langs's `projects-dir` setting.
     */
    public async migrateExercise(
        courseSlug: string,
        exerciseChecksum: string,
        exerciseId: number,
        exercisePath: string,
        exerciseSlug: string,
    ): Promise<Result<void, Error>> {
        return this._executeLangsCommand({
            args: [
                "settings",
                "--client-name",
                this.clientName,
                "migrate",
                "--course-slug",
                courseSlug,
                "--exercise-checksum",
                exerciseChecksum,
                "--exercise-id",
                `${exerciseId}`,
                "--exercise-path",
                exercisePath,
                "--exercise-slug",
                exerciseSlug,
            ],
            core: false,
        }).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Gets the value for given key and asserts it's type. Uses TMC-langs `settings get` command
     * internally.
     */
    public async getSetting<T>(
        key: string,
        checker: (object: unknown) => object is T,
    ): Promise<Result<T | undefined, Error>> {
        return (
            await this._executeLangsCommand({
                args: ["settings", "--client-name", this.clientName, "get", key],
                core: false,
            })
        )
            .andThen((result) =>
                result.data?.["output-data-kind"] === "config-value"
                    ? Ok(result.data["output-data"])
                    : Err(new Error("Unexpected Langs result.")),
            )
            .andThen<T, Error>((result) =>
                checker(result) ? Ok(result) : Err(new Error("Invalid object type.")),
            );
    }

    /**
     * Sets a value for given key in stored settings. Uses TMC-langs `settings set` command
     * internally.
     */
    public async setSetting(key: string, value: string): Promise<Result<void, Error>> {
        return this._executeLangsCommand({
            args: ["settings", "--client-name", this.clientName, "set", key, value],
            core: false,
        }).then((x) => x.andThen(() => Ok.EMPTY));
    }

    /**
     * Resets all settings back to initial values. Uses TMC-langs `settings reset` command
     * internally.
     */
    public async resetSettings(): Promise<Result<void, Error>> {
        return this._executeLangsCommand({
            args: ["settings", "--client-name", this.clientName, "reset"],
            core: false,
        }).then((x) => x.andThen(() => Ok.EMPTY));
    }

    /**
     * Unsets the value of given key in stored settings. Uses TMC-langs `settings unset` command
     * internally.
     */
    public async unsetSetting(key: string): Promise<Result<void, Error>> {
        return this._executeLangsCommand({
            args: ["settings", "--client-name", this.clientName, "unset", key],
            core: false,
        }).then((x) => x.andThen(() => Ok.EMPTY));
    }

    // ---------------------------------------------------------------------------------------------
    // Core commands
    // ---------------------------------------------------------------------------------------------

    /**
     * Checks for updates for all exercises in this client's context. Uses TMC-langs
     * `check-exercise-updates` core command internally.
     */
    public async checkExerciseUpdates(
        options?: CacheOptions,
    ): Promise<Result<Array<{ id: number }>, Error>> {
        return (
            await this._executeLangsCommand(
                { args: ["check-exercise-updates"], core: true },
                { forceRefresh: options?.forceRefresh, key: TMC._exerciseUpdatesCacheKey },
            )
        ).andThen<UpdatedExercise[], Error>((result) =>
            result.data?.["output-data-kind"] === "updated-exercises"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
    }

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
        return this._executeLangsCommand({
            args: ["download-or-update-exercises", "--exercise", id.toString(), exercisePath],
            core: true,
        }).then((res) => (res.err ? res : Ok.EMPTY));
    }

    /**
     * Downloads multiple exercises to TMC-langs' configured project directory. Uses TMC-langs
     * `download-or-update-course-exercises` core command internally.
     *
     * @param ids Ids of the exercises to download.
     */
    public async downloadExercises(
        ids: number[],
        downloaded: (value: { id: number; percent: number; message?: string }) => void,
    ): Promise<Result<DownloadOrUpdateCourseExercisesResult, Error>> {
        const onStdout = (res: StatusUpdateData): void => {
            if (
                res["update-data-kind"] === "client-update-data" &&
                res.data?.["client-update-data-kind"] === "exercise-download"
            ) {
                downloaded({
                    id: res.data.id,
                    percent: res["percent-done"],
                    message: res.message ?? undefined,
                });
            }
        };

        const result = (
            await this._executeLangsCommand({
                args: [
                    "download-or-update-course-exercises",
                    "--exercise-id",
                    ...ids.map((id) => id.toString()),
                ],
                core: true,
                onStdout,
            })
        ).andThen<DownloadOrUpdateCourseExercisesResult, Error>((result) =>
            result.data?.["output-data-kind"] === "exercise-download"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
        if (result.err) {
            return result;
        }

        // Invalidate exercise update cache
        this._responseCache.delete(TMC._exerciseUpdatesCacheKey);
        return result;
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
                `${TMC_BACKEND_URL}/api/v8/core/exercises/${exerciseId}/submissions`,
            );
        }

        return this._executeLangsCommand({ args, core: true }).then((res) =>
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
    public async getCourses(
        organization: string,
        options?: CacheOptions,
    ): Promise<Result<Course[], Error>> {
        return (
            await this._executeLangsCommand(
                { args: ["get-courses", "--organization", organization], core: true },
                {
                    forceRefresh: options?.forceRefresh,
                    key: `organization-${organization}-courses`,
                },
            )
        ).andThen<Course[], Error>((result) =>
            result.data?.["output-data-kind"] === "courses"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
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
        const remapper: CacheConfig["remapper"] = (response) => {
            if (response.data?.["output-data-kind"] !== "combined-course-data") return [];
            const { details, exercises, settings } = response.data["output-data"];
            return [
                [
                    `course-${courseId}-details`,
                    {
                        ...response,
                        data: { "output-data-kind": "course-details", "output-data": details },
                    },
                ],
                [
                    `course-${courseId}-exercises`,
                    {
                        ...response,
                        data: { "output-data-kind": "course-exercises", "output-data": exercises },
                    },
                ],
                [
                    `course-${courseId}-settings`,
                    {
                        ...response,
                        data: { "output-data-kind": "course-data", "output-data": settings },
                    },
                ],
            ];
        };

        return (
            await this._executeLangsCommand(
                { args: ["get-course-data", "--course-id", courseId.toString()], core: true },
                { forceRefresh: options?.forceRefresh, key: `course-${courseId}-data`, remapper },
            )
        ).andThen<CombinedCourseData, Error>((result) =>
            result.data?.["output-data-kind"] === "combined-course-data"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
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
        return (
            await this._executeLangsCommand(
                { args: ["get-course-details", "--course-id", courseId.toString()], core: true },
                { forceRefresh: options?.forceRefresh, key: `course-${courseId}-details` },
            )
        )
            .andThen<CourseDetails["course"], Error>((result) =>
                result.data?.["output-data-kind"] === "course-details"
                    ? Ok(result.data["output-data"])
                    : Err(new Error("Unexpected Langs result.")),
            )
            .map((x) => ({ course: x }));
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
        return (
            await this._executeLangsCommand(
                { args: ["get-course-exercises", "--course-id", courseId.toString()], core: true },
                { forceRefresh: options?.forceRefresh, key: `course-${courseId}-exercises` },
            )
        ).andThen<CourseExercise[], Error>((result) =>
            result.data?.["output-data-kind"] === "course-exercises"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
    }

    /**
     * Gets general course info of the given course. Uses TMC-langs `get-course-settings` core
     * command internally.
     *
     * @param courseId Id of the course.
     * @returns Info of the course.
     */
    public async getCourseSettings(
        courseId: number,
        options?: CacheOptions,
    ): Promise<Result<CourseSettings, Error>> {
        return (
            await this._executeLangsCommand(
                { args: ["get-course-settings", "--course-id", courseId.toString()], core: true },
                { forceRefresh: options?.forceRefresh, key: `course-${courseId}-settings` },
            )
        ).andThen<CourseSettings, Error>((result) =>
            result.data?.["output-data-kind"] === "course-data"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
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
        return (
            await this._executeLangsCommand(
                {
                    args: ["get-exercise-details", "--exercise-id", exerciseId.toString()],
                    core: true,
                },
                { forceRefresh: options?.forceRefresh, key: `exercise-${exerciseId}-details` },
            )
        ).andThen<ExerciseDetails, Error>((result) =>
            result.data?.["output-data-kind"] === "exercise-details"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
    }

    /**
     * Gets user's old submissions for the given exercise. Uses TMC-langs `get-exercise-submissions`
     * core command internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns Array of old submissions.
     */
    public async getOldSubmissions(exerciseId: number): Promise<Result<OldSubmission[], Error>> {
        return (
            await this._executeLangsCommand({
                args: ["get-exercise-submissions", "--exercise-id", exerciseId.toString()],
                core: true,
            })
        ).andThen<OldSubmission[], Error>((result) =>
            result.data?.["output-data-kind"] === "submissions"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
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
        return (
            await this._executeLangsCommand(
                { args: ["get-organization", "--organization", organizationSlug], core: true },
                { forceRefresh: options?.forceRefresh, key: `organization-${organizationSlug}` },
            )
        ).andThen<Organization, Error>((result) =>
            result.data?.["output-data-kind"] === "organization"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
    }

    /**
     * Gets all organizations. Uses TMC-langs `get-organizations` core command internally.
     *
     * @returns A list of organizations.
     */
    public async getOrganizations(options?: CacheOptions): Promise<Result<Organization[], Error>> {
        const remapper: CacheConfig["remapper"] = (res) => {
            if (res.data?.["output-data-kind"] !== "organizations") return [];
            return res.data["output-data"].map<[string, OutputData]>((x) => [
                `organization-${x.slug}`,
                { ...res, data: { "output-data-kind": "organization", "output-data": x } },
            ]);
        };

        return (
            await this._executeLangsCommand(
                { args: ["get-organizations"], core: true },
                { forceRefresh: options?.forceRefresh, key: "organizations", remapper },
            )
        ).andThen<Organization[], Error>((result) =>
            result.data?.["output-data-kind"] === "organizations"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
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
                `${TMC_BACKEND_URL}/api/v8/core/exercises/${exerciseId}/submissions`,
            );
        }

        const result = await this._executeLangsCommand({ args, core: true });
        if (result.err) {
            return result;
        }

        return Ok.EMPTY;
    }

    /**
     * Submits an exercise to server and waits for test results. Uses TMC-langs `submit` core
     * command internally.
     *
     * This function can only be called once per `MINIMUM_SUBMISSION_INTERVAL` and this limitation
     * is shared with `submitExerciseToPaste()`.
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
        const now = Date.now();
        if (now < this._nextSubmissionAllowedTimestamp) {
            return Err(new BottleneckError("This command can't be executed at the moment."));
        } else {
            this._nextSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL;
        }

        const submitUrl = `${TMC_BACKEND_URL}/api/v8/core/exercises/${exerciseId}/submissions`;
        const onStdout = (res: StatusUpdateData): void => {
            progressCallback?.(100 * res["percent-done"], res.message ?? undefined);
            if (
                res["update-data-kind"] === "client-update-data" &&
                res.data?.["client-update-data-kind"] === "posted-submission"
            ) {
                onSubmissionUrl?.(res.data.show_submission_url);
            }
        };

        return (
            await this._executeLangsCommand({
                args: ["submit", "--submission-path", exercisePath, "--submission-url", submitUrl],
                core: true,
                onStdout,
            })
        ).andThen<SubmissionResultReport, Error>((result) =>
            result.data?.["output-data-kind"] === "submission-finished"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
    }

    /**
     * Submits given exercise to TMC Paste and provides a link to it. Uses TMC-langs `paste` core
     * command internally.
     *
     * This function can only be called once per `MINIMUM_SUBMISSION_INTERVAL` and this limitation
     * is shared with `submitExerciseAndWaitForResults()`.
     *
     * @param exerciseId Id of the exercise.
     * @returns TMC paste link.
     */
    public async submitExerciseToPaste(
        exerciseId: number,
        exercisePath: string,
    ): Promise<Result<string, Error>> {
        const now = Date.now();
        if (now < this._nextSubmissionAllowedTimestamp) {
            return Err(new BottleneckError("This command can't be executed at the moment."));
        } else {
            this._nextSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL;
        }

        const submitUrl = `${TMC_BACKEND_URL}/api/v8/core/exercises/${exerciseId}/submissions`;

        return (
            await this._executeLangsCommand({
                args: ["paste", "--submission-path", exercisePath, "--submission-url", submitUrl],
                core: true,
            })
        ).andThen<string, Error>((result) =>
            result.data?.["output-data-kind"] === "new-submission"
                ? Ok(result.data["output-data"].paste_url)
                : Err(new Error("Unexpected Langs result.")),
        );
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

        return (
            await this._executeLangsCommand({
                args: ["send-feedback", ...feedbackArgs, "--feedback-url", feedbackUrl],
                core: true,
            })
        ).andThen<SubmissionFeedbackResponse, Error>((result) =>
            result.data?.["output-data-kind"] === "submission-feedback-response"
                ? Ok(result.data["output-data"])
                : Err(new Error("Unexpected Langs result.")),
        );
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
    private async _executeLangsCommand(
        langsArgs: LangsProcessArgs,
        cacheConfig?: CacheConfig,
    ): Promise<Result<OutputData, Error>> {
        const cacheKey = cacheConfig?.key;
        const currentTime = Date.now();
        if (!cacheConfig?.forceRefresh && cacheKey) {
            const cachedEntry = this._responseCache.get(cacheKey);
            if (cachedEntry) {
                const { response, timestamp } = cachedEntry;
                const cachedDataLifeLeft = timestamp + API_CACHE_LIFETIME - currentTime;
                if (cachedDataLifeLeft > 0) {
                    const prettySecondsLeft = Math.ceil(cachedDataLifeLeft / 1000);
                    Logger.log(
                        `Using cached data for key: ${cacheKey}. Still valid for ${prettySecondsLeft}s`,
                    );
                    return Ok(response);
                }
                Logger.debug(`Discarding invalidated cache data for key: ${cacheKey}`);
                this._responseCache.delete(cacheKey);
            }
        }

        const result = (await this._spawnLangsProcess(langsArgs).result).andThen((x) =>
            this._checkLangsResponse(x),
        );
        if (result.err) {
            return result;
        }

        const response = result.val;
        if (response && cacheKey) {
            this._responseCache.set(cacheKey, { response, timestamp: currentTime });
            cacheConfig?.remapper?.(response).forEach(([key, response]) => {
                this._responseCache.set(key, { response, timestamp: currentTime });
            });
        }

        return Ok(response);
    }

    /**
     * Checks langs response for generic errors.
     */
    private _checkLangsResponse(langsResponse: OutputData): Result<OutputData, Error> {
        if (langsResponse.status === "crashed") {
            Logger.error(`Langs process crashed: ${langsResponse.message}`, langsResponse.data);
            return Err(new RuntimeError("Langs process crashed."));
        }

        if (langsResponse.data?.["output-data-kind"] !== "error") {
            return Ok(langsResponse);
        }

        const message = langsResponse.message;
        const traceString = langsResponse.data["output-data"].trace.join("\n");
        const outputDataKind = langsResponse.data["output-data"].kind;
        switch (outputDataKind) {
            case "connection-error":
                return Err(new ConnectionError(message, traceString));
            case "forbidden":
                return Err(new ForbiddenError(message, traceString));
            case "invalid-token":
                this._responseCache.clear();
                this._onLogout?.();
                return Err(new InvalidTokenError(message));
            case "not-logged-in":
                this._responseCache.clear();
                this._onLogout?.();
                return Err(new AuthorizationError(message, traceString));
            case "obsolete-client":
                return Err(
                    new ObsoleteClientError(
                        message +
                            "\nYour TMC Extension is out of date, please update it." +
                            "\nhttps://code.visualstudio.com/docs/editor/extension-gallery",
                        traceString,
                    ),
                );
        }

        // Special handling because it makes usage simpler
        if (is<FailedExerciseDownload>(outputDataKind)) {
            const data: Data = {
                "output-data-kind": "exercise-download",
                "output-data": {
                    downloaded: outputDataKind.completed,
                    skipped: outputDataKind.skipped,
                },
            };

            return Ok({ ...langsResponse, data });
        }

        return Err(new RuntimeError(message, traceString));
    }

    /**
     * Spawns a new tmc-langs-cli process with given arguments.
     *
     * @returns Rust process runner.
     */
    private _spawnLangsProcess(commandArgs: LangsProcessArgs): LangsProcessRunner {
        const { args, core, env, obfuscate, onStderr, onStdout, stdin, processTimeout } =
            commandArgs;
        const CORE_ARGS = [
            "core",
            "--client-name",
            this.clientName,
            "--client-version",
            this.clientVersion,
        ];

        let theResult: OutputData | undefined;
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
                TMC_LANGS_ROOT_URL: TMC_BACKEND_URL,
                TMC_LANGS_CONFIG_DIR: this._options.cliConfigDir,
            },
        });
        stdin && cprocess.stdin.write(stdin + "\n");

        const processResult = new Promise<number | null>((resolve, reject) => {
            let resultCode: number | undefined;
            let stdoutEnded = false;

            const timeout =
                processTimeout &&
                setTimeout(() => {
                    kill(cprocess.pid);
                    reject("Process didn't seem to finish or was taking a really long time.");
                }, processTimeout);

            cprocess.on("error", (error) => {
                timeout && clearTimeout(timeout);
                reject(error);
            });
            cprocess.stderr.on("data", (chunk) => {
                onStderr?.(chunk.toString());
            });
            cprocess.stdout.on("end", () => {
                stdoutEnded = true;
                if (resultCode !== undefined) {
                    timeout && clearTimeout(timeout);
                    resolve(resultCode);
                }
            });
            cprocess.on("exit", (code) => {
                resultCode = code ?? 0;
                if (stdoutEnded) {
                    timeout && clearTimeout(timeout);
                    resolve(code);
                }
            });
            cprocess.stdout.on("data", (chunk) => {
                const parts = (stdoutBuffer + chunk.toString()).split("\n");
                stdoutBuffer = parts.pop() || "";
                for (const part of parts) {
                    try {
                        const json = JSON.parse(part.trim());
                        if (!is<Output>(json)) {
                            Logger.error("TMC-langs response didn't match expected type");
                            Logger.debug(part);
                            continue;
                        }

                        switch (json["output-kind"]) {
                            case "output-data":
                                theResult = json;
                                break;
                            case "status-update":
                                onStdout?.(json);
                                break;
                            case "warnings":
                                break;
                            default:
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

        const result = (async (): LangsProcessRunner["result"] => {
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

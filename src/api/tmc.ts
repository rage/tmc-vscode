import * as cp from "child_process";
import * as kill from "tree-kill";
import { Err, Ok, Result } from "ts-results";
import { validate } from "typia";

import {
    API_CACHE_LIFETIME,
    CLI_PROCESS_TIMEOUT,
    MINIMUM_SUBMISSION_INTERVAL,
    MOOC_BACKEND_URL,
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
import {
    CliOutput,
    CombinedCourseData,
    Course,
    CourseData,
    CourseDetails,
    CourseExercise,
    DataKind,
    DownloadOrUpdateCourseExercisesResult,
    ExerciseDetails,
    LocalExercise,
    Organization,
    OutputData,
    RunResult,
    StatusUpdateData,
    StyleValidationResult,
    Submission,
    SubmissionFeedbackResponse,
    SubmissionFinished,
    UpdatedExercise,
} from "../shared/langsSchema";
import { Logger } from "../utilities/logger";

import { SubmissionFeedback } from "./types";
import { BaseError } from "../shared/shared";

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
    result: Promise<Result<OutputData, BaseError>>;
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
        if (!username || !password) {
            return Err(new AuthenticationError("Username and password may not be empty."));
        }
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("login", "--base64", "--email", username, "--stdin"),
                obfuscate: [8],
                stdin: Buffer.from(password).toString("base64"),
            },
            null,
        );
        return res
            .mapErr((x) => new AuthenticationError(x.message))
            .andThen(() => {
                this._onLogin?.();
                return Ok.EMPTY;
            });
    }

    /**
     * Returns user's current authentication status. Uses TMC-langs `logged-in` core command
     * internally.
     *
     * @returns Boolean indicating if the user is authenticated.
     */
    public async isAuthenticated(options?: ExecutionOptions): Promise<Result<boolean, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("logged-in"),
                processTimeout: options?.timeout,
            },
            null,
        );
        return res.andThen<boolean, Error>((x) => {
            switch (x.result) {
                case "logged-in":
                    return Ok(true);
                case "not-logged-in":
                    return Ok(false);
                default:
                    return Err(new Error(`Unexpected langs result: ${x.result}`));
            }
        });
    }

    /**
     * Deauthenticates current user. Uses TMC-langs `logout` core command internally.
     */
    public async deauthenticate(): Promise<Result<void, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("logout"),
            },
            null,
        );
        return res.andThen(() => {
            this._responseCache.clear();
            this._onLogout?.();
            return Ok.EMPTY;
        });
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
        const res = await this._executeLangsCommand(
            { args: ["clean", "--exercise-path", exercisePath] },
            null,
        );
        return res.err ? res : Ok.EMPTY;
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
        const res = await this._executeLangsCommand(
            {
                args: [
                    "list-local-course-exercises",
                    "--client-name",
                    this.clientName,
                    "--course-slug",
                    courseSlug,
                ],
            },
            "local-exercises",
        );
        return res.map((x) => x.data["output-data"]);
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
        progressCallback?: (progressPct: number, message?: string) => void,
    ): [Promise<Result<RunResult, BaseError>>, () => void] {
        const env: { [key: string]: string } = {};
        if (pythonExecutablePath) {
            env.TMC_LANGS_PYTHON_EXEC = pythonExecutablePath;
        }
        const { interrupt, result } = this._spawnLangsProcess({
            args: ["run-tests", "--exercise-path", exercisePath],
            env,
            onStdout: (data) =>
                progressCallback?.(100 * data["percent-done"], data.message ?? undefined),
            onStderr: (data) => Logger.info("Rust Langs", data),
            processTimeout: CLI_PROCESS_TIMEOUT,
        });
        const postResult = result.then((res) =>
            res
                .andThen((x) => this._checkLangsResponse(x, "test-result"))
                .map((x) => x.data["output-data"]),
        );

        return [postResult, interrupt];
    }

    public runCheckstyle(
        exercisePath: string,
        progressCallback?: (progressPct: number, message?: string) => void,
    ): [Promise<Result<StyleValidationResult | null, BaseError>>, () => void] {
        const { interrupt, result } = this._spawnLangsProcess({
            args: ["checkstyle", "--locale", "en", "--exercise-path", exercisePath],
            onStdout: (data) =>
                progressCallback?.(100 * data["percent-done"], data.message ?? undefined),
            onStderr: (data) => Logger.info("Rust Langs", data),
            processTimeout: CLI_PROCESS_TIMEOUT,
        });
        const checkstyleResult = result.then((res) =>
            res
                .andThen((x) => this._checkLangsResponse(x, "validation"))
                .map((x) => x.data["output-data"]),
        );
        return [checkstyleResult, interrupt];
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
        const res = await this._executeLangsCommand(
            {
                args: this._settingsCmd(
                    "migrate",
                    "--exercise-path",
                    exercisePath,
                    "--course-slug",
                    courseSlug,
                    "--exercise-id",
                    `${exerciseId}`,
                    "--exercise-slug",
                    exerciseSlug,
                    "--exercise-checksum",
                    exerciseChecksum,
                ),
            },
            null,
        );
        return res.err ? res : Ok.EMPTY;
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
        const res = await this._executeLangsCommand(
            {
                args: this._settingsCmd("move-projects-dir", newDirectory),
                onStdout,
            },
            null,
        );
        return res.err ? res : Ok.EMPTY;
    }

    /**
     * Gets the value for given key and asserts it's type. Uses TMC-langs `settings get` command
     * internally.
     */
    public async getSetting<T>(
        key: string,
        checker: (object: unknown) => object is T,
    ): Promise<Result<T | undefined, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._settingsCmd("get", key),
            },
            "config-value",
        );
        return res.andThen<T | undefined, Error>((x) => {
            const data = x.data?.["output-data"];
            if (data === undefined || data === null) {
                return Ok(undefined);
            }
            return checker(data) ? Ok(data) : Err(new Error("Invalid object type."));
        });
    }

    /**
     * Sets a value for given key in stored settings. Uses TMC-langs `settings set` command
     * internally.
     */
    public async setSetting(key: string, value: unknown): Promise<Result<void, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._settingsCmd("set", key, JSON.stringify(value)),
            },
            null,
        );
        return res.err ? res : Ok.EMPTY;
    }

    /**
     * Resets all settings back to initial values. Uses TMC-langs `settings reset` command
     * internally.
     */
    public async resetSettings(): Promise<Result<void, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._settingsCmd("reset"),
            },
            null,
        );
        return res.err ? res : Ok.EMPTY;
    }

    /**
     * Unsets the value of given key in stored settings. Uses TMC-langs `settings unset` command
     * internally.
     */
    public async unsetSetting(key: string): Promise<Result<void, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._settingsCmd("unset", key),
            },
            null,
        );
        return res.err ? res : Ok.EMPTY;
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
    ): Promise<Result<Array<UpdatedExercise>, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("check-exercise-updates"),
            },
            "updated-exercises",
            { forceRefresh: options?.forceRefresh, key: TMC._exerciseUpdatesCacheKey },
        );
        return res.map((x) => x.data["output-data"]);
    }

    /**
     * Downloads multiple exercises to TMC-langs' configured project directory. Uses TMC-langs
     * `download-or-update-course-exercises` core command internally.
     *
     * @param ids Ids of the exercises to download.
     * @param downloadTemplate Flag for downloading exercise template instead of latest submission.
     */
    public async downloadExercises(
        ids: number[],
        downloadTemplate: boolean,
        onDownloaded: (value: { id: number; percent: number; message?: string }) => void,
    ): Promise<Result<DownloadOrUpdateCourseExercisesResult, Error>> {
        const onStdout = (res: StatusUpdateData): void => {
            if (
                res["update-data-kind"] === "client-update-data" &&
                res.data?.["client-update-data-kind"] === "exercise-download"
            ) {
                onDownloaded({
                    id: res.data.id,
                    percent: res["percent-done"],
                    message: res.message ?? undefined,
                });
            }
        };
        const downloadTemplateArg = downloadTemplate ? ["--download-template"] : [];
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd(
                    "download-or-update-course-exercises",
                    ...downloadTemplateArg,
                    "--exercise-id",
                    ...ids.map((id) => id.toString()),
                ),
                onStdout,
            },
            "exercise-download",
        );
        return res.andThen((x) => {
            // Invalidate exercise update cache
            this._responseCache.delete(TMC._exerciseUpdatesCacheKey);
            return Ok(x.data["output-data"]);
        });
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
        const saveOldStateArg = saveOldState ? ["--save-old-state"] : [];
        const args = this._tmcCmd(
            "download-old-submission",
            "--submission-id",
            submissionId.toString(),
            ...saveOldStateArg,
            "--exercise-id",
            exerciseId.toString(),
            "--output-path",
            exercisePath,
        );
        const res = await this._executeLangsCommand({ args }, null);
        return res.err ? res : Ok.EMPTY;
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-courses", "--organization", organization),
            },
            "courses",
            {
                forceRefresh: options?.forceRefresh,
                key: `organization-${organization}-courses`,
            },
        );
        return res.map((x) => x.data["output-data"]);
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
    ): Promise<Result<CombinedCourseData, Error>> {
        const remapper: CacheConfig["remapper"] = (response) => {
            if (response.data?.["output-data-kind"] !== "combined-course-data") {
                return [];
            }
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-course-data", "--course-id", courseId.toString()),
            },
            "combined-course-data",
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-data`, remapper },
        );
        return res.map((x) => x.data["output-data"]);
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-course-details", "--course-id", courseId.toString()),
            },
            "course-details",
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-details` },
        );
        return res.map((x) => x.data["output-data"]);
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-course-exercises", "--course-id", courseId.toString()),
            },
            "course-exercises",
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-exercises` },
        );
        return res.map((x) => x.data["output-data"]);
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
    ): Promise<Result<CourseData, Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-course-settings", "--course-id", courseId.toString()),
            },
            "course-data",
            { forceRefresh: options?.forceRefresh, key: `course-${courseId}-settings` },
        );
        return res.map((x) => x.data["output-data"]);
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-exercise-details", "--exercise-id", exerciseId.toString()),
            },
            "exercise-details",
            { forceRefresh: options?.forceRefresh, key: `exercise-${exerciseId}-details` },
        );
        return res.map((x) => x.data["output-data"]);
    }

    /**
     * Gets user's old submissions for the given exercise. Uses TMC-langs `get-exercise-submissions`
     * core command internally.
     *
     * @param exerciseId Id of the exercise.
     * @returns Array of old submissions.
     */
    public async getOldSubmissions(exerciseId: number): Promise<Result<Submission[], Error>> {
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd(
                    "get-exercise-submissions",
                    "--exercise-id",
                    exerciseId.toString(),
                ),
            },
            "submissions",
        );
        return res.map((x) => x.data["output-data"]);
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-organization", "--organization", organizationSlug),
            },
            "organization",
            { forceRefresh: options?.forceRefresh, key: `organization-${organizationSlug}` },
        );
        return res.map((x) => x.data["output-data"]);
    }

    /**
     * Gets all organizations. Uses TMC-langs `get-organizations` core command internally.
     *
     * @returns A list of organizations.
     */
    public async getOrganizations(options?: CacheOptions): Promise<Result<Organization[], Error>> {
        const remapper: CacheConfig["remapper"] = (res) => {
            if (res.data?.["output-data-kind"] === "organizations") {
                return res.data["output-data"].map((x) => [
                    `organization-${x.slug}`,
                    { ...res, data: { "output-data-kind": "organization", "output-data": x } },
                ]);
            } else {
                return [];
            }
        };
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("get-organizations"),
            },
            "organizations",
            { forceRefresh: options?.forceRefresh, key: "organizations", remapper },
        );
        return res.map((x) => x.data["output-data"]);
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
        const saveOldStateArg = saveOldState ? ["--save-old-state"] : [];
        const args = this._tmcCmd(
            "reset-exercise",
            ...saveOldStateArg,
            "--exercise-id",
            exerciseId.toString(),
            "--exercise-path",
            exercisePath,
        );
        const res = await this._executeLangsCommand({ args }, null);
        return res.err ? res : Ok.EMPTY;
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
    ): Promise<Result<SubmissionFinished, Error>> {
        const now = Date.now();
        if (now < this._nextSubmissionAllowedTimestamp) {
            return Err(new BottleneckError("This command can't be executed at the moment."));
        } else {
            this._nextSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL;
        }

        const onStdout = (res: StatusUpdateData): void => {
            progressCallback?.(100 * res["percent-done"], res.message ?? undefined);
            if (
                res["update-data-kind"] === "client-update-data" &&
                res.data?.["client-update-data-kind"] === "posted-submission"
            ) {
                onSubmissionUrl?.(res.data.show_submission_url);
            }
        };

        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd(
                    "submit",
                    "--submission-path",
                    exercisePath,
                    "--exercise-id",
                    exerciseId.toString(),
                ),
                onStdout,
            },
            "submission-finished",
        );
        return res.map((x) => x.data["output-data"]);
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd(
                    "paste",
                    "--exercise-id",
                    exerciseId.toString(),
                    "--submission-path",
                    exercisePath,
                ),
            },
            "new-submission",
        );
        return res.map((x) => x.data["output-data"].paste_url);
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
        const res = await this._executeLangsCommand(
            {
                args: this._tmcCmd("send-feedback", "--feedback-url", feedbackUrl, ...feedbackArgs),
            },
            "submission-feedback-response",
        );
        return res.map((r) => r.data["output-data"]);
    }

    /**
     * Constructs the base arguments for all `tmc` subcommands.
     *
     * @param rest The rest of the arguments.
     * @returns The complete arguments.
     */
    private _tmcCmd(...rest: Array<string>): Array<string> {
        return [
            "tmc",
            "--client-name",
            this.clientName,
            "--client-version",
            this.clientVersion,
        ].concat(rest);
    }

    /**
     * Constructs the base arguments for all `settings` subcommands.
     *
     * @param rest The rest of the arguments.
     * @returns The complete arguments.
     */
    private _settingsCmd(...rest: Array<string>): Array<string> {
        return ["settings", "--client-name", this.clientName].concat(rest);
    }

    /**
     * Executes a tmc-langs-cli process with given arguments to the completion and handles
     * validation for the last response received from the process.
     *
     * @param langsArgs Command arguments passed on to spawnLangsProcess.
     * @param validator Validator used to check that the result corresponds to the expected type.
     * @param cacheConfig Cache options.
     */
    private async _executeLangsCommand<T extends DataKind["output-data-kind"] | null>(
        langsArgs: LangsProcessArgs,
        outputDataKind: T,
        cacheConfig?: CacheConfig,
    ): Promise<
        Result<OutputData & { data: T extends null ? null : { "output-data-kind": T } }, Error>
    > {
        const cacheKey = cacheConfig?.key;
        const currentTime = Date.now();
        if (!cacheConfig?.forceRefresh && cacheKey) {
            const cachedEntry = this._responseCache.get(cacheKey);
            if (cachedEntry) {
                const { response, timestamp } = cachedEntry;
                const cachedDataLifeLeft = timestamp + API_CACHE_LIFETIME - currentTime;
                if (cachedDataLifeLeft > 0 && dataMatchesKind(response, outputDataKind)) {
                    const prettySecondsLeft = Math.ceil(cachedDataLifeLeft / 1000);
                    Logger.info(
                        `Using cached data for key: ${cacheKey}. Still valid for ${prettySecondsLeft}s`,
                    );
                    return Ok(response);
                }
                Logger.debug(`Discarding invalidated cache data for key: ${cacheKey}`);
                this._responseCache.delete(cacheKey);
            }
        }

        const res = await this._spawnLangsProcess(langsArgs).result;
        return res
            .andThen((x) => this._checkLangsResponse(x, outputDataKind))
            .andThen((x) => {
                if (x && cacheKey) {
                    this._responseCache.set(cacheKey, { response: x, timestamp: currentTime });
                    cacheConfig?.remapper?.(x).forEach(([key, response]) => {
                        this._responseCache.set(key, { response, timestamp: currentTime });
                    });
                }
                return Ok(x);
            });
    }

    /**
     * Checks langs response for generic errors.
     */
    private _checkLangsResponse<T extends DataKind["output-data-kind"] | null>(
        langsResponse: OutputData,
        outputDataKind: T,
    ): Result<OutputData & { data: T extends null ? null : { "output-data-kind": T } }, BaseError> {
        if (!dataMatchesKind(langsResponse, outputDataKind)) {
            Logger.error("Unexpected TMC-langs response.", langsResponse);
            return Err(new BaseError("Unexpected TMC-langs response."));
        }
        if (langsResponse.status === "crashed") {
            Logger.error("Langs process crashed.", langsResponse.message, langsResponse.data);
            return Err(new BaseError("Langs process crashed."));
        }
        if (langsResponse.result !== "error") {
            return Ok(langsResponse);
        }
        if (langsResponse.data?.["output-data-kind"] !== "error") {
            Logger.error("Unexpected data in error response.", langsResponse);
            return Err(new BaseError("Unexpected data in error response"));
        }

        // after this point, we know we have an error
        const data = langsResponse.data;
        const message = langsResponse.message;
        const traceString = data["output-data"].trace.join("\n");
        const errorKind = data["output-data"].kind;
        switch (errorKind) {
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

        return Err(new RuntimeError(message, traceString));
    }

    /**
     * Spawns a new tmc-langs-cli process with given arguments.
     *
     * @returns Rust process runner.
     */
    private _spawnLangsProcess(commandArgs: LangsProcessArgs): LangsProcessRunner {
        const { args, env, obfuscate, onStderr, onStdout, stdin, processTimeout } = commandArgs;

        let theResult: OutputData | undefined;
        let stdoutBuffer = "";

        const obfuscatedArgs = args.map((x, i) => (obfuscate?.includes(i) ? "***" : x));
        const loggableCommand = [this.cliPath]
            .concat(obfuscatedArgs)
            .map((x) => JSON.stringify(x))
            .join(" ");

        // override settings with environment variables, mainly for testing
        const tmcBackendUrl = process.env.TMC_LANGS_TMC_ROOT_URL ?? TMC_BACKEND_URL;
        const moocBackendUrl = process.env.TMC_LANGS_MOOC_ROOT_URL ?? MOOC_BACKEND_URL;
        const tmcLangsConfigDir = process.env.TMC_LANGS_CONFIG_DIR ?? this._options.cliConfigDir;

        Logger.info(`Running ${loggableCommand}`);
        Logger.debug(`TMC backend at ${tmcBackendUrl}`);
        Logger.debug(`MOOC backend at ${moocBackendUrl}`);
        Logger.debug(`Config dir at ${tmcLangsConfigDir}`);

        let active = true;
        let interrupted = false;
        const cprocess = cp.spawn(this.cliPath, args, {
            env: {
                ...process.env,
                ...env,
                RUST_LOG: "debug,rustls=warn,reqwest=warn",
                TMC_LANGS_TMC_ROOT_URL: tmcBackendUrl,
                TMC_LANGS_MOOC_ROOT_URL: moocBackendUrl,
                TMC_LANGS_CONFIG_DIR: tmcLangsConfigDir,
            },
        });
        if (stdin) {
            cprocess.stdin.write(stdin + "\n");
        }

        const processResult = new Promise<number | null>((resolve, reject) => {
            let resultCode: number | undefined;
            let stdoutEnded = false;

            const timeout =
                processTimeout &&
                setTimeout(() => {
                    kill(cprocess.pid as number);
                    reject("Process didn't seem to finish or was taking a really long time.");
                }, processTimeout);

            cprocess.on("error", (error) => {
                if (timeout) {
                    clearTimeout(timeout);
                }
                if ("errno" in error) {
                    // check for macos error code -88
                    // which indicates an architecture mismatch
                    if (error.errno === -88) {
                        error.message = `A compatibility error was detected.
If you're on macOS: Try installing Rosetta by running \`softwareupdate --install-rosetta\` in the terminal. (See https://support.apple.com/en-us/102527).
${error.message}`;
                    }
                }
                reject(error);
            });
            cprocess.stderr.on("data", (chunk) => {
                const data = chunk.toString();
                Logger.debug("stderr", data);
                onStderr?.(data);
            });
            cprocess.stdout.on("end", () => {
                stdoutEnded = true;
                if (resultCode !== undefined) {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    resolve(resultCode);
                }
            });
            cprocess.on("exit", (code) => {
                resultCode = code ?? 0;
                if (stdoutEnded) {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    resolve(code);
                }
            });
            cprocess.stdout.on("data", (chunk) => {
                const data = chunk.toString();
                const parts = (stdoutBuffer + data).split("\n");
                stdoutBuffer = parts.pop() || "";
                for (const part of parts) {
                    try {
                        const trimmed = part.trim();
                        if (!trimmed) {
                            continue;
                        }
                        const json = JSON.parse(trimmed);
                        const validation = validate<CliOutput>(json);
                        if (!validation.success) {
                            Logger.error(
                                "TMC-langs response didn't match expected type:",
                                validation.errors,
                            );
                            Logger.debug(json);
                            continue;
                        }
                        const data = validation.data;

                        switch (data["output-kind"]) {
                            case "output-data":
                                theResult = data;
                                break;
                            case "status-update":
                                onStdout?.(data);
                                break;
                            case "notification":
                                break;
                            default:
                                Logger.error(
                                    "TMC-langs returned invalid `output-kind`:",
                                    data["output-kind"],
                                );
                                Logger.debug(data);
                        }
                    } catch (_e) {
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
                // Typing change from update
                return Err(new RuntimeError(error as string));
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
                kill(cprocess.pid as number);
            }
        };
        return { interrupt, result };
    }
}

/**
 * Type guard for OutputData with the data matching the given `output-data-kind`.
 *
 * @param data The `OutputData` with unknown result data.
 * @param kind The expected `output-data-kind`. If `null`, doesn't check `output-data`.
 * @returns
 */
function dataMatchesKind<T extends DataKind["output-data-kind"] | null>(
    data: OutputData, // this can be changed to unknown later if needed
    kind: T,
): data is OutputData & { data: T extends null ? null : { "output-data-kind": T } } {
    return (
        kind === null ||
        data.data?.["output-data-kind"] === kind ||
        data.data?.["output-data-kind"] === "error"
    );
}

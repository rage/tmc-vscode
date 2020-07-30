import * as cp from "child_process";
import * as ClientOauth2 from "client-oauth2";
import { sync as delSync } from "del";
import * as FormData from "form-data";
import * as fs from "fs";
import * as _ from "lodash";
import * as fetch from "node-fetch";
import * as path from "path";
import * as kill from "tree-kill";
import { Err, Ok, Result } from "ts-results";
import { createIs, is } from "typescript-is";
import * as url from "url";

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
    TimeoutError,
} from "../errors";
import { displayProgrammerError, downloadFile } from "../utils/";
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
    TmcLangsAction,
    TmcLangsFilePath,
    TmcLangsPath,
    TmcLangsResponse,
    TmcLangsTestResultsRust,
} from "./types";
import { showError } from "./vscode";
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

interface UncheckedLangsResponse {
    data: unknown;
    message: string | null;
    "percent-done": number;
    result:
        | "logged-in"
        | "logged-out"
        | "not-logged-in"
        | "error"
        | "running"
        | "sent-data"
        | "retrieved-data"
        | "executed-command";
    status: "successful" | "crashed" | "in-progress";
}

interface LangsResponse<T> extends UncheckedLangsResponse {
    data: T;
    result: Exclude<UncheckedLangsResponse["result"], "error">;
    status: Exclude<UncheckedLangsResponse["status"], "crashed">;
}

/**
 * A Class for interacting with the TestMyCode service, including authentication
 */
export default class TMC {
    private readonly oauth2: ClientOauth2;
    private token: ClientOauth2.Token | undefined;
    private readonly storage: Storage;
    private readonly resources: Resources;
    private readonly tmcApiUrl: string;
    private readonly tmcDefaultHeaders: { client: string; client_version: string };
    private workspaceManager?: WorkspaceManager;
    private readonly isInsider: () => boolean;

    private readonly cache: Map<string, TMCApiResponse>;
    private readonly rustCache: Map<string, LangsResponse<unknown>>;

    private nextLangsJsonId = 0;

    /**
     * Create the TMC service interaction class, includes setting up OAuth2 information
     */
    constructor(storage: Storage, resources: Resources, isInsider: () => boolean) {
        this.oauth2 = new ClientOauth2({
            accessTokenUri: ACCESS_TOKEN_URI,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });
        this.storage = storage;
        const authToken = storage.getAuthenticationToken();
        if (authToken) {
            this.token = new ClientOauth2.Token(this.oauth2, authToken);
        }
        this.resources = resources;
        this.tmcApiUrl = TMC_API_URL;
        this.cache = new Map();
        this.rustCache = new Map();
        this.tmcDefaultHeaders = {
            client: CLIENT_NAME,
            client_version: resources.extensionVersion,
        };
        this.isInsider = isInsider;
    }

    public setWorkspaceManager(workspaceManager: WorkspaceManager): void {
        if (this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager already assigned");
        }
        this.workspaceManager = workspaceManager;
    }

    /**
     * Attempts to authenticate with given credentials. Throws an error if an authentication token
     * is already present.
     *
     * @param username Username or email
     * @param password Password
     * @returns A boolean determining success, and a human readable error description.
     */
    public async authenticate(
        username: string,
        password: string,
        isInsider?: boolean,
    ): Promise<Result<void, Error>> {
        if (this.token) {
            throw new Error("Authentication token already exists.");
        }
        if (isInsider === true || this.isInsider()) {
            const loginResult = await this.executeLangsCommand(
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

        try {
            this.token = await this.oauth2.owner.getToken(username, password);
        } catch (err) {
            if (err.code === "EAUTH") {
                return new Err(new AuthenticationError("Incorrect username and/or password"));
            } else if (err.code === "EUNAVAILABLE") {
                return new Err(new ConnectionError("Connection error"));
            }
            Logger.error("Unknown authentication error:", err);
            return new Err(new Error("Unknown error: " + err.code));
        }
        this.storage.updateAuthenticationToken(this.token.data);
        return Ok.EMPTY;
    }

    /**
     * Logs out by deleting the authentication token.
     */
    public async deauthenticate(): Promise<Result<void, Error>> {
        if (this.isInsider()) {
            const logoutResult = await this.executeLangsCommand(
                { args: ["logout"], core: true },
                createIs<unknown>(),
            );
            if (logoutResult.err) {
                return logoutResult;
            }
        }
        this.token = undefined;
        this.storage.updateAuthenticationToken(undefined);
        return Ok.EMPTY;
    }

    /**
     * TODO: actually check if the token is valid
     * @returns whether an authentication token is present
     */
    public async isAuthenticated(isInsider?: boolean): Promise<Result<boolean, Error>> {
        if (isInsider === true || this.isInsider()) {
            const loggedInResult = await this.executeLangsCommand(
                { args: ["logged-in"], core: true },
                createIs<ClientOauth2.Data | null>(),
            );
            if (loggedInResult.err) {
                return loggedInResult;
            }
            const response = loggedInResult.val;
            if (response.result === "not-logged-in") {
                if (!this.token) {
                    return new Ok(false);
                }

                // Insider compatibility: If token exists but Langs didn't have it, pass it on.
                const setTokenResult = await this.executeLangsCommand(
                    {
                        args: ["login", "--set-access-token", this.token.data.access_token],
                        core: true,
                    },
                    createIs<unknown>(),
                );
                if (setTokenResult.err) {
                    return setTokenResult;
                }
            } else if (response.result === "logged-in" && response.data) {
                // Non-insider compatibility: keep stored token up to date
                this.token = new ClientOauth2.Token(this.oauth2, response.data);
                this.storage.updateAuthenticationToken(this.token.data);
            }
        }
        return new Ok(this.token !== undefined);
    }

    public async clean(id: number): Promise<Result<void, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const exerciseFolderPath = this.workspaceManager.getExercisePathById(id);
        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        const result = await this.executeLangsCommand(
            { args: ["clean", "--exercise-path", exerciseFolderPath.val], core: false },
            createIs<unknown>(),
            false,
        );
        if (result.err) {
            return result;
        }

        return Ok.EMPTY;
    }

    /**
     * @returns a list of organizations
     */
    public async getOrganizations(cache = false): Promise<Result<Organization[], Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                { args: ["get-organizations"], core: true },
                createIs<Organization[]>(),
                cache,
            ).then((res) => res.map((r) => r.data));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest("org.json", cache),
                createIs<Organization[]>(),
            );
        }
    }

    /**
     * @returns one Organization information
     * @param slug Organization slug/id
     */
    public async getOrganization(
        slug: string,
        cache = false,
    ): Promise<Result<Organization, Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                { args: ["get-organization", "--organization", slug], core: true },
                createIs<Organization>(),
                cache,
            ).then((res) => res.map((r) => r.data));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest(`org/${slug}.json`, cache),
                createIs<Organization>(),
            );
        }
    }

    /**
     * Requires an organization to be selected
     * @returns a list of courses belonging to the currently selected organization
     */
    public getCourses(organization: string, cache = false): Promise<Result<Course[], Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                { args: ["get-courses", "--organization", organization], core: true },
                createIs<Course[]>(),
                cache,
            ).then((res) => res.map((r) => r.data));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest(`core/org/${organization}/courses`, cache),
                createIs<Course[]>(),
            );
        }
    }

    /**
     * @param id course id
     * @returns a detailed description for the specified course
     */
    public async getCourseDetails(
        id: number,
        cache = false,
    ): Promise<Result<CourseDetails, Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                {
                    args: ["get-course-details", "--course-id", id.toString()],
                    core: true,
                },
                createIs<CourseDetails["course"]>(),
                cache,
            ).then((res) => res.map((r) => ({ course: r.data })));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest(`core/courses/${id}`, cache),
                createIs<CourseDetails>(),
            );
        }
    }

    /**
     * @param id course id
     * @returns course settings for the specified course
     */
    public getCourseSettings(id: number, cache = false): Promise<Result<CourseSettings, Error>> {
        // Wait for next rust version
        /* if (this.isInsider()) {
            return this.executeLangsCommand(
                {
                    args: ["get-course-settings", "--course-id", id.toString()],
                    core: true,
                    onStderr: (data) => Logger.log(data),
                    onStdout: (data) => Logger.log("gurn", JSON.stringify(data)),
                },
                createIs<CourseSettings>(),
                cache,
            ).then(res => res.map(r => r.data));
        } else {
        } */
        return this.checkApiResponse(
            this.tmcApiRequest(`courses/${id}`, cache),
            createIs<CourseSettings>(),
        );
    }

    /**
     *
     * @param id course id
     * @returns return list of courses exercises. Each exercise carry info about available points
     * that can be gained from an exercise
     */
    public async getCourseExercises(
        id: number,
        cache = false,
    ): Promise<Result<CourseExercise[], Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                {
                    args: ["get-course-exercises", "--course-id", id.toString()],
                    core: true,
                },
                createIs<CourseExercise[]>(),
                cache,
            ).then((res) => res.map((r) => r.data));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest(`courses/${id}/exercises`, cache),
                createIs<CourseExercise[]>(),
            );
        }
    }

    /**
     * @param id Exercise id
     * @returns A description for the specified exercise
     */
    public async getExerciseDetails(
        id: number,
        cache = false,
    ): Promise<Result<ExerciseDetails, Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                {
                    args: ["get-exercise-details", "--exercise-id", id.toString()],
                    core: true,
                },
                createIs<ExerciseDetails>(),
                cache,
            ).then((res) => res.map((r) => r.data));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest(`core/exercises/${id}`, cache),
                createIs<ExerciseDetails>(),
            );
        }
    }

    /**
     * Get submission status by url
     * @param submissionUrl Submission url
     */
    public async getSubmissionStatus(
        submissionUrl: string,
    ): Promise<Result<SubmissionStatusReport, Error>> {
        if (!this.token) {
            throw new Error("User not logged in!");
        }
        return this.checkApiResponse(
            this.tmcApiRequest(submissionUrl),
            createIs<SubmissionStatusReport>(),
        );
    }

    /**
     * Downloads exercise with given id and extracts it to the exercise folder.
     * @param id Id of the exercise to download
     * @param organizationSlug Slug for the organization this exercise belongs to.
     */
    public async downloadExercise(
        id: number,
        organizationSlug: string,
        progressCallback?: (downloadedPct: number, increment: number) => void,
    ): Promise<Result<void, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assigned");
        }
        const archivePath = path.join(`${this.resources.getDataPath()}`, `${id}.zip`);

        const detailsResult = await this.getExerciseDetails(id, true);
        if (detailsResult.err) {
            return detailsResult;
        }

        const courseResult = await this.getCourseDetails(detailsResult.val.course_id);
        if (courseResult.err) {
            return courseResult;
        }

        const exercise = courseResult.val.course.exercises.find((x) => x.id === id);
        if (!exercise) {
            return new Err(new Error("Exercise somehow missing from course"));
        }

        if (this.isInsider()) {
            // TODO post-insider: Pass this location directly to this function
            const exercisePath = await this.workspaceManager.createExerciseDownloadPath(
                exercise.soft_deadline,
                organizationSlug,
                exercise.checksum,
                detailsResult.val,
            );

            if (exercisePath.err) {
                return exercisePath;
            }

            const downloadResult = await this.executeLangsCommand(
                {
                    args: [
                        "download-or-update-exercises",
                        "--exercise",
                        id.toString(),
                        exercisePath.val,
                    ],
                    core: true,
                },
                createIs<unknown>(),
                false,
            );

            if (downloadResult.err) {
                Logger.error("Downloading failed", downloadResult.val);
                await this.workspaceManager.deleteExercise(id);
            }

            return Ok.EMPTY;
        } else {
            const result = await downloadFile(
                `${this.tmcApiUrl}core/exercises/${id}/download`,
                archivePath,
                this.tmcDefaultHeaders,
                this.token,
                progressCallback,
            );
            if (result.err) {
                return result;
            }

            const exercisePath = await this.workspaceManager.createExerciseDownloadPath(
                exercise.soft_deadline,
                organizationSlug,
                exercise.checksum,
                detailsResult.val,
            );

            if (exercisePath.err) {
                return exercisePath;
            }

            const extractResult = await this.checkApiResponse(
                this.executeLangsAction({
                    action: "extract-project",
                    archivePath,
                    exerciseFolderPath: exercisePath.val,
                })[0],
                createIs<TmcLangsPath>(),
            );

            if (extractResult.err) {
                Logger.error("Extracting failed", extractResult.val);
                await this.workspaceManager.deleteExercise(id);
            }

            delSync(archivePath, { force: true });

            return Ok.EMPTY;
        }
    }

    public async downloadOldExercise(
        exerciseId: number,
        submissionId: number,
    ): Promise<Result<string, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const exercisePath = this.workspaceManager.getExercisePathById(exerciseId);
        if (exercisePath.err) {
            exercisePath;
        }

        // TODO: Finish insider version when this command is fixed in Langs
        // -- Insider implementation --
        /* if (this.isInsider()) {
            const asd = await this.executeLangsCommand(
                {
                    args: [
                        "download-old-submission",
                        "--exercise-id",
                        exerciseId.toString(),
                        "--submission-id",
                        submissionId.toString(),
                        "--output-path",
                        exercisePath.val,
                    ],
                    core: true,
                    onStderr: (e) => Logger.warn("e", e),
                    onStdout: (o) => Logger.warn("o", JSON.stringify(o)),
                },
                createIs<unknown>(),
                false,
            );
            if (asd.err) {
                return asd;
            }
            return new Ok("Old submission downloaded succesfully");
        } */
        // -- End of insider implementation --

        const exPath = exercisePath.val + "/";
        const userFilePaths = await this.checkApiResponse(
            this.executeLangsAction({
                action: "get-exercise-packaging-configuration",
                exerciseFolderPath: exPath,
            })[0],
            createIs<TmcLangsFilePath>(),
        );

        if (userFilePaths.err) {
            return userFilePaths;
        }

        const archivePath = path.join(`${this.resources.getDataPath()}`, `${submissionId}.zip`);
        const downloadResult = await downloadFile(
            `${this.tmcApiUrl}core/submissions/${submissionId}/download`,
            archivePath,
            this.tmcDefaultHeaders,
            this.token,
        );

        if (downloadResult.err) {
            return downloadResult;
        }

        const oldSubmissionTempPath = path.join(this.resources.getDataPath(), "temp");
        const extractResult = await this.checkApiResponse(
            this.executeLangsAction({
                action: "extract-project",
                archivePath,
                exerciseFolderPath: oldSubmissionTempPath,
            })[0],
            createIs<TmcLangsPath>(),
        );

        if (extractResult.err) {
            return extractResult;
        }

        const closedExPath = this.workspaceManager.getExercisePathById(exerciseId);
        if (closedExPath.err) {
            return closedExPath;
        }

        userFilePaths.val.response.studentFilePaths.forEach((dataPath) => {
            delSync(path.join(closedExPath.val, dataPath), { force: true });
            fs.renameSync(
                path.join(oldSubmissionTempPath, dataPath),
                path.join(closedExPath.val, dataPath),
            );
        });

        delSync(archivePath, { force: true });
        delSync(oldSubmissionTempPath, { force: true });

        return new Ok("Old submission downloaded succesfully");
    }

    /**
     * Runs tests locally for an exercise
     * @param id Id of the exercise
     * @param isInsider To be removed once TMC Lang JAR removed.
     * Insider version toggle.
     */
    public runTests(
        id: number,
        pythonExecutablePath?: string,
    ): [Promise<Result<TmcLangsTestResultsRust, Error>>, () => void] {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }
        const exerciseFolderPath = this.workspaceManager.getExercisePathById(id);
        if (exerciseFolderPath.err) {
            return [Promise.resolve(exerciseFolderPath), (): void => {}];
        }

        const env: { [key: string]: string } = {};
        if (this.isInsider() && pythonExecutablePath) {
            env.TMC_LANGS_PYTHON_EXEC = pythonExecutablePath;
        }
        const outputPath = this.nextTempOutputPath();
        const { interrupt, result } = this.spawnLangsProcess({
            args: [
                "run-tests",
                "--exercise-path",
                exerciseFolderPath.val,
                "--output-path",
                outputPath,
            ],
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

            return this.checkLangsResponse(last, createIs<TmcLangsTestResultsRust>()).map(
                (r) => r.data,
            );
        });

        return [postResult, interrupt];
    }

    /**
     * Archives and submits the specified exercise to the TMC server
     * @param id Exercise id
     */
    public async submitExercise(
        id: number,
        params?: Map<string, string>,
    ): Promise<Result<SubmissionResponse, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }
        const exerciseFolderPath = this.workspaceManager.getExercisePathById(id);

        if (exerciseFolderPath.err) {
            return exerciseFolderPath;
        }

        // -- Insider implementation --
        if (this.isInsider()) {
            const isPaste = params?.has("paste");
            const submitUrl = `${this.tmcApiUrl}core/exercises/${id}/submissions`;
            const args = isPaste
                ? [
                      "paste",
                      "--locale",
                      "eng",
                      "--submission-path",
                      exerciseFolderPath.val,
                      "--submission-url",
                      submitUrl,
                  ]
                : [
                      "submit",
                      "--dont-block",
                      "--submission-path",
                      exerciseFolderPath.val,
                      "--submission-url",
                      submitUrl,
                  ];
            const processResult = await this.executeLangsCommand(
                { args, core: true },
                createIs<SubmissionResponse>(),
            );

            if (processResult.err) {
                return processResult;
            }

            return new Ok(processResult.val.data);
        }
        // -- End of insider implementation --

        const compressResult = await this.checkApiResponse(
            this.executeLangsAction({
                action: "compress-project",
                archivePath: path.join(`${this.resources.getDataPath()}`, `${id}-new.zip`),
                exerciseFolderPath: exerciseFolderPath.val,
            })[0],
            createIs<TmcLangsPath>(),
        );
        if (compressResult.err) {
            return compressResult;
        }

        const archivePath = compressResult.val.response as string;
        const form = new FormData();
        if (params) {
            params.forEach((value: string, key: string) => {
                form.append(key as string, value);
            });
        }
        form.append("submission[file]", fs.createReadStream(archivePath));
        return this.checkApiResponse(
            this.tmcApiRequest(
                `core/exercises/${id}/submissions`,
                false,
                "post",
                form,
                form.getHeaders(),
            ),
            createIs<SubmissionResponse>(),
        );
    }

    /**
     * Submit feedback for a submission, only usable from the submission details view
     * @param feedbackUrl Feedback URL to use, from the submission response
     * @param feedback Feedback to submit, shouldn't be empty
     */
    public async submitSubmissionFeedback(
        feedbackUrl: string,
        feedback: SubmissionFeedback,
    ): Promise<Result<SubmissionFeedbackResponse, Error>> {
        if (this.isInsider()) {
            const feedbackArgs = feedback.status.reduce<string[]>(
                (acc, next) => acc.concat("--feedback", next.question_id.toString(), next.answer),
                [],
            );
            return this.executeLangsCommand(
                {
                    args: ["send-feedback", ...feedbackArgs, "--feedback-url", feedbackUrl],
                    core: true,
                },
                createIs<SubmissionFeedbackResponse>(),
            ).then((res) => res.map((r) => r.data));
        } else {
            const params = new url.URLSearchParams();
            feedback.status.forEach((answer, index) => {
                params.append(`answers[${index}][question_id]`, answer.question_id.toString());
                params.append(`answers[${index}][answer]`, answer.answer);
            });
            return this.checkApiResponse(
                this.tmcApiRequest(feedbackUrl, false, "post", params),
                createIs<SubmissionFeedbackResponse>(),
            );
        }
    }

    /**
     * Function which returns old submissions as list from the server
     */
    public async getOldSubmissions(exerciseId: number): Promise<Result<OldSubmission[], Error>> {
        if (this.isInsider()) {
            return this.executeLangsCommand(
                {
                    args: ["get-exercise-submissions", "--exercise-id", exerciseId.toString()],
                    core: true,
                },
                createIs<OldSubmission[]>(),
            ).then((res) => res.map((r) => r.data));
        } else {
            return this.checkApiResponse(
                this.tmcApiRequest(`exercises/${exerciseId}/users/current/submissions`, false),
                createIs<OldSubmission[]>(),
            );
        }
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
    private async executeLangsCommand<T>(
        langsArgs: RustProcessArgs,
        checker: (object: unknown) => object is T,
        useCache = false,
    ): Promise<Result<LangsResponse<T>, Error>> {
        const cacheKey = langsArgs.args.join("-");
        if (useCache) {
            const cached = this.rustCache.get(cacheKey);
            if (cached && checker(cached.data)) {
                return new Ok({ ...cached, data: cached.data });
            }
            // This should NEVER have to happen
            Logger.error("Cached data didn't match the expected type, re-fetching...");
        }
        const result = await this.spawnLangsProcess(langsArgs).result;
        if (result.err) {
            return result;
        }
        const last = _.last(result.val.stdout);
        if (last === undefined) {
            return new Err(new Error("No langs response received"));
        }
        const checked = this.checkLangsResponse(last, checker);
        if (checked.err) {
            return checked;
        }
        this.rustCache.set(cacheKey, checked.val);
        return new Ok(checked.val);
    }

    /**
     * Checks langs response for generic errors.
     */
    private checkLangsResponse<T>(
        langsResponse: UncheckedLangsResponse,
        checker: (object: unknown) => object is T,
    ): Result<LangsResponse<T>, Error> {
        const { data, result, status } = langsResponse;
        const message = langsResponse.message || "null";
        if (status === "crashed") {
            if (is<string[]>(data)) {
                Logger.error("TMC Langs crashed.", data.join("\n"));
            }
            return new Err(new Error("Langs process crashed: " + message));
        }
        if (result === "error") {
            if (is<string[]>(data)) {
                Logger.error("TMC Langs errored.", data.join("\n"));
            }
            return new Err(new Error(message));
        }
        if (!checker(data)) {
            return new Err(new Error("Unexpected response data type."));
        }
        return new Ok({ ...langsResponse, data, result, status });
    }

    /**
     * Spawns a new tmc-langs-cli process with given arguments.
     *
     * @returns Rust process runner.
     */
    private spawnLangsProcess(commandArgs: RustProcessArgs): RustProcessRunner {
        const { args, core, env, onStderr, onStdout, stdin } = commandArgs;
        const CORE_ARGS = [
            "core",
            "--client-name",
            CLIENT_NAME,
            "--client-version",
            this.resources.extensionVersion,
        ];

        let stderr = "";
        let stdout: UncheckedLangsResponse[] = [];
        let stdoutRaw = "";

        const executable = this.resources.getCliPath();
        Logger.log(JSON.stringify(executable) + " " + args.map((a) => JSON.stringify(a)).join(" "));

        let active = true;
        let interrupted = false;
        const cprocess = cp.spawn(executable, core ? CORE_ARGS.concat(args) : args, {
            env: { ...process.env, ...env, RUST_LOG: "debug" },
        });
        stdin && cprocess.stdin.write(stdin + "\n");

        const processResult = new Promise<number | null>((resolve, reject) => {
            const timeout = setTimeout(() => {
                kill(cprocess.pid);
                reject("Process didn't seem to finish or was taking a really long time.");
            }, TMC_LANGS_TIMEOUT);
            cprocess.on("error", (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            cprocess.on("exit", (code) => {
                clearTimeout(timeout);
                resolve(code);
            });
            cprocess.stderr.on("data", (chunk) => {
                const data = chunk.toString();
                stderr += data;
                onStderr?.(data);
            });
            cprocess.stdout.on("data", (chunk) => {
                const data = chunk.toString();
                try {
                    // Check against broken and output
                    const prepared = `[${stdoutRaw}${data.trim().replace(/}\s*{/g, "},{")}]`;
                    const json = JSON.parse(prepared);
                    if (!is<UncheckedLangsResponse[]>(json)) {
                        Logger.error(
                            "Langs response didn't match expected type, received: ",
                            chunk.toString(),
                        );
                        return;
                    }
                    stdout = stdout.concat(json);
                    stdoutRaw = "";
                    onStdout?.(json[json.length - 1]);
                } catch (e) {
                    Logger.debug(
                        "Failed to parse langs response, data will be appended to next event",
                    );
                    stdoutRaw = stdoutRaw += data;
                }
            });
        });

        const interrupt = (): void => {
            if (active) {
                active = false;
                interrupted = true;
                kill(cprocess.pid);
            }
        };

        const result = (async (): RustProcessRunner["result"] => {
            try {
                await processResult;
            } catch (error) {
                return new Err(new RuntimeError(error));
            }

            if (interrupted) {
                return new Err(new RuntimeError("TMC Langs process was killed."));
            }

            if (stdoutRaw !== "") {
                Logger.warn("Failed to parse some TMC Langs output");
            }

            return new Ok({
                stderr,
                stdout,
            });
        })();

        return { interrupt, result };
    }

    /**
     * Executes external tmc-langs process with given arguments.
     *
     * @deprecated this function works and will be removed anyway with java so there's no point in
     * fixing the copypaste.
     *
     * @param tmcLangsAction Tmc-langs command and arguments
     */
    private executeLangsAction(
        tmcLangsAction: TmcLangsAction,
    ): [Promise<Result<TmcLangsResponse, Error>>, () => void] {
        const action = tmcLangsAction.action;
        let exercisePath = "";
        let outputPath = "";

        switch (tmcLangsAction.action) {
            case "extract-project":
                [exercisePath, outputPath] = [
                    tmcLangsAction.archivePath,
                    tmcLangsAction.exerciseFolderPath,
                ];
                break;
            case "compress-project":
                [outputPath, exercisePath] = [
                    tmcLangsAction.archivePath,
                    tmcLangsAction.exerciseFolderPath,
                ];
                break;
            case "get-exercise-packaging-configuration":
                exercisePath = tmcLangsAction.exerciseFolderPath;
                outputPath = this.nextTempOutputPath();
                break;
        }

        const arg0 = exercisePath ? `--exercisePath="${exercisePath}"` : "";
        const arg1 = `--outputPath="${outputPath}"`;

        const command = `${this.resources.getJavaPath()} -jar "${this.resources.getTmcLangsPath()}" ${action} ${arg0} ${arg1}`;

        Logger.log(command);

        let active = true;
        let error: cp.ExecException | undefined;
        let interrupted = false;
        let [stdoutExec, stderrExec] = ["", ""];

        const cprocess = cp.exec(command, (err, stdout, stderr) => {
            active = false;
            stdoutExec = stdout;
            stderrExec = stderr;
            if (err) {
                Logger.error(`Process raised error: ${command}`, err, stdout, stderr);
                error = err;
            }
        });

        const interrupt = (): void => {
            if (active) {
                Logger.log(`Killing TMC-Langs process ${cprocess.pid}`);
                kill(cprocess.pid);
                interrupted = true;
            }
        };

        const processResult: Promise<Result<[string, string], Error>> = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                interrupt();
                return resolve(
                    new Err(
                        new TimeoutError(
                            "Process didn't seem to finish or was taking a really long time.",
                        ),
                    ),
                );
            }, TMC_LANGS_TIMEOUT);

            cprocess.on("exit", (code) => {
                clearTimeout(timeout);
                if (error) {
                    return resolve(new Err(error));
                } else if (interrupted) {
                    return resolve(new Err(new RuntimeError("TMC-Langs process was killed.")));
                } else if (code !== null && code > 0) {
                    return resolve(new Err(new Error("Unknown error")));
                }
                const stdout = (cprocess.stdout?.read() || "") as string;
                const stderr = (cprocess.stderr?.read() || "") as string;
                return resolve(
                    Ok<[string, string]>([stdout, stderr]),
                );
            });
        });

        return [
            new Promise((resolve) => {
                processResult.then((result) => {
                    if (error) {
                        return resolve(new Err(error));
                    }

                    if (result.err) {
                        return resolve(result);
                    }

                    const stdout = result.val[0] ? result.val[0] : stdoutExec;
                    const stderr = result.val[1] ? result.val[1] : stderrExec;
                    const logs = { stdout, stderr };

                    Logger.log("Logs", stdout, stderr);

                    if (action === "extract-project" || action === "compress-project") {
                        return resolve(new Ok({ response: outputPath, logs }));
                    }

                    const readResult = {
                        response: JSON.parse(fs.readFileSync(outputPath, "utf8")),
                        logs,
                    };
                    // del.sync(outputPath, { force: true });
                    Logger.log("Temp JSON data", readResult.response);
                    if (is<TmcLangsResponse>(readResult)) {
                        return resolve(new Ok(readResult));
                    }

                    Logger.error("Unexpected response JSON type", result.val);
                    showError("Unexpected response JSON type.");
                    return resolve(new Err(new Error("Unexpected response JSON type")));
                });
            }),
            interrupt,
        ];
    }

    /**
     * @deprecated Rust langs should eventually read the output from STDOUT. Java will be
     * completely removed.
     *
     * @returns Next temporary json file for passing to TMC-langs.
     */
    private nextTempOutputPath(): string {
        const next = path.join(
            this.resources.getDataPath(),
            `temp_${this.nextLangsJsonId++ % 10}.json`,
        );
        if (fs.existsSync(next)) {
            delSync(next, { force: true });
        }
        return next;
    }

    /**
     * Unwraps the response, checks the type, and rewraps it with the type error possibly included
     *
     * Note that the current type checking method requires the type checker to be passed as a
     * parameter to allow the correct type predicates to be generated during compilation
     *
     * @param response The response to be typechecked
     * @param typechecker The type checker to be used
     *
     * @returns A type checked response
     */
    private async checkApiResponse<T, U>(
        response: Promise<Result<U, Error>>,
        checker: (object: unknown) => object is T,
    ): Promise<Result<T, Error>> {
        const result = await response;
        if (result.ok) {
            return checker(result.val)
                ? new Ok(result.val)
                : new Err(new ApiError("Incorrect response type"));
        }
        return new Err(result.val);
    }

    /**
     * Performs a HTTP request to hardcoded TMC server.
     *
     * @param endpoint Target API endpoint, can also be a complete URL.
     * @param cache Whether this operation should attempt to return cached data first.
     * @param method HTTP method, defaults to GET.
     * @param body Optional data body for the request.
     * @param headers Headers for the request.
     */
    private async tmcApiRequest(
        endpoint: string,
        cache = false,
        method: "get" | "post" = "get",
        body?: string | FormData | url.URLSearchParams,
        headers: { [key: string]: string } = {},
    ): Promise<Result<TMCApiResponse, Error>> {
        if (cache) {
            const cacheResult = this.cache.get(method + endpoint);
            if (cacheResult) {
                return new Ok(cacheResult);
            }
        }

        let request = {
            body,
            headers,
            method,
            url: endpoint.startsWith("https://") ? endpoint : this.tmcApiUrl + endpoint,
        };

        Object.assign(request.headers, this.tmcDefaultHeaders);

        if (this.token) {
            request = this.token.sign(request);
        }

        try {
            const response = await fetch.default(request.url, request);
            if (response.ok) {
                try {
                    const responseObject = await response.json();
                    if (is<TMCApiResponse>(responseObject)) {
                        if (cache) {
                            this.cache.set(method + endpoint, responseObject);
                        }
                        return new Ok(responseObject);
                    }
                    Logger.error(
                        `Unexpected TMC response type from ${request.url}`,
                        responseObject,
                    );
                    Logger.show();
                    return new Err(new ApiError("Unexpected response type"));
                } catch (error) {
                    return new Err(new ApiError("Response not in JSON format: " + error.name));
                }
            }
            if (response.status === 403) {
                return new Err(new AuthorizationError("403 - Forbidden"));
            }
            const errorText = (await response.json())?.error || (await response.text());
            Logger.error(`${response.status} - ${response.statusText} - ${errorText}`);
            return new Err(
                new ApiError(`${response.status} - ${response.statusText} - ${errorText}`),
            );
        } catch (error) {
            Logger.error("TMC Api request failed with error", error);
            return new Err(new ConnectionError("Connection error: " + error.name));
        }
    }
}

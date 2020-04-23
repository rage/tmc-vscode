import * as cp from "child_process";
import * as ClientOauth2 from "client-oauth2";
import * as del from "del";
import * as FormData from "form-data";
import * as fs from "fs";
import * as fetch from "node-fetch";
import * as path from "path";
import * as url from "url";
import Resources from "../config/resources";
import Storage from "../config/storage";

import { Err, Ok, Result } from "ts-results";
import { createIs, is } from "typescript-is";
import { ApiError, AuthenticationError, AuthorizationError, ConnectionError } from "../errors";
import { displayProgrammerError, downloadFile } from "../utils/";
import {
    Course,
    CourseDetails,
    CourseExercise,
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
    TmcLangsTestResults,
} from "./types";
import WorkspaceManager from "./workspaceManager";
import { ACCESS_TOKEN_URI, CLIENT_ID, CLIENT_SECRET, TMC_API_URL } from "../config/constants";
import { resetExercise } from "../actions";
import { ActionContext } from "../actions/types";

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

    private readonly cache: Map<string, TMCApiResponse>;

    private nextLangsJsonId = 0;

    /**
     * Create the TMC service interaction class, includes setting up OAuth2 information
     */
    constructor(storage: Storage, resources: Resources) {
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
        this.tmcDefaultHeaders = {
            client: "vscode_plugin",
            // eslint-disable-next-line @typescript-eslint/camelcase
            client_version: resources.extensionVersion,
        };
    }

    public setWorkspaceManager(workspaceManager: WorkspaceManager): void {
        if (this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager already assigned");
        }
        this.workspaceManager = workspaceManager;
    }

    /**
     * Attempts to log in with the given credentials, throws an error if an authentication token is already present
     * @param username Username or email
     * @param password Password
     * @returns A boolean determining success, and a human readable error description.
     */
    public async authenticate(username: string, password: string): Promise<Result<void, Error>> {
        if (this.token) {
            throw new Error("Authentication token already exists.");
        }
        try {
            this.token = await this.oauth2.owner.getToken(username, password);
        } catch (err) {
            if (err.code === "EAUTH") {
                return new Err(new AuthenticationError("Incorrect username and/or password"));
            } else if (err.code === "EUNAVAILABLE") {
                return new Err(new ConnectionError("Connection error"));
            }
            console.error(err);
            return new Err(new Error("Unknown error: " + err.code));
        }
        this.storage.updateAuthenticationToken(this.token.data);
        return Ok.EMPTY;
    }

    /**
     * Logs out by deleting the authentication token.
     */
    public deauthenticate(): void {
        this.token = undefined;
        this.storage.updateAuthenticationToken(undefined);
    }

    /**
     * TODO: actually check if the token is valid
     * @returns whether an authentication token is present
     */
    public isAuthenticated(): boolean {
        return this.token !== undefined;
    }

    /**
     * @returns a list of organizations
     */
    public getOrganizations(cache?: boolean): Promise<Result<Organization[], Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest("org.json", cache),
            createIs<Organization[]>(),
        );
    }

    /**
     * @returns one Organization information
     * @param slug Organization slug/id
     */
    public getOrganization(slug: string, cache?: boolean): Promise<Result<Organization, Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`org/${slug}.json`, cache),
            createIs<Organization>(),
        );
    }

    /**
     * Requires an organization to be selected
     * @returns a list of courses belonging to the currently selected organization
     */
    public getCourses(organization: string, cache?: boolean): Promise<Result<Course[], Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`core/org/${organization}/courses`, cache),
            createIs<Course[]>(),
        );
    }

    /**
     * @param id course id
     * @returns a detailed description for the specified course
     */
    public getCourseDetails(id: number, cache?: boolean): Promise<Result<CourseDetails, Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`core/courses/${id}`, cache),
            createIs<CourseDetails>(),
        );
    }

    /**
     *
     * @param id course id
     * @returns return list of courses exercises. Each exercise carry info about available points that can be gained from an exercise
     */
    public getCourseExercises(
        id: number,
        cache?: boolean,
    ): Promise<Result<CourseExercise[], Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`courses/${id}/exercises`, cache),
            createIs<CourseExercise[]>(),
        );
    }

    /**
     * @param id Exercise id
     * @returns A description for the specified exercise
     */
    public async getExerciseDetails(
        id: number,
        cache?: boolean,
    ): Promise<Result<ExerciseDetails, Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`core/exercises/${id}`, cache),
            createIs<ExerciseDetails>(),
        );
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
            this.tmcApiRequest(submissionUrl, false),
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
    ): Promise<Result<void, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }
        const archivePath = path.join(`${this.resources.getDataPath()}`, `${id}.zip`);

        const result = await downloadFile(
            `${this.tmcApiUrl}core/exercises/${id}/download`,
            archivePath,
            this.tmcDefaultHeaders,
            this.token,
        );
        if (result.err) {
            return new Err(result.val);
        }

        const detailsResult = await this.getExerciseDetails(id);
        if (detailsResult.err) {
            return new Err(detailsResult.val);
        }

        const courseResult = await this.getCourseDetails(detailsResult.val.course_id);

        if (courseResult.err) {
            return new Err(courseResult.val);
        }

        const exercise = courseResult.val.course.exercises.find((x) => x.id === id);
        if (!exercise) {
            return new Err(new Error("Exercise somehow missing from course"));
        }

        // TODO: Extract to a different location and handle pass that to ExerciseManager
        const exercisePath = this.workspaceManager.createExerciseDownloadPath(
            exercise.soft_deadline,
            organizationSlug,
            exercise.checksum,
            detailsResult.val,
        );

        if (exercisePath.err) {
            return new Err(exercisePath.val);
        }

        const extractResult = await this.checkApiResponse(
            this.executeLangsAction({
                action: "extract-project",
                archivePath,
                exerciseFolderPath: exercisePath.val,
            }),
            createIs<TmcLangsPath>(),
        );

        if (extractResult.err) {
            this.workspaceManager.deleteExercise(id);
        }

        del.sync(archivePath, { force: true });

        return Ok.EMPTY;
    }

    public async downloadOldExercise(
        context: ActionContext,
        exerciseId: number,
        submissionId: number,
    ): Promise<Result<string, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }

        const archivePath = path.join(`${this.resources.getDataPath()}`, `${submissionId}.zip`);

        const exercisePath = this.workspaceManager.getExercisePathById(exerciseId);

        if (exercisePath.err) {
            return new Err(new Error("Couldn't find exercise path for exercise"));
        }

        const exPath = exercisePath.val + "/";

        const userFilePaths = await this.checkApiResponse(
            this.executeLangsAction({
                action: "get-exercise-packaging-configuration",
                exerciseFolderPath: exPath,
            }),
            createIs<TmcLangsFilePath>(),
        );

        if (userFilePaths.err) {
            return new Err(new Error("Couldn't resolve userfiles from exercisefiles"));
        }

        const downloadResult = await downloadFile(
            `${this.tmcApiUrl}core/submissions/${submissionId}/download`,
            archivePath,
            this.tmcDefaultHeaders,
            this.token,
        );

        if (downloadResult.err) {
            return new Err(downloadResult.val);
        }

        const oldSubmissionTempPath = path.join(this.resources.getDataPath(), "temp");

        const extractResult = await this.checkApiResponse(
            this.executeLangsAction({
                action: "extract-project",
                archivePath,
                exerciseFolderPath: oldSubmissionTempPath,
            }),
            createIs<TmcLangsPath>(),
        );

        if (extractResult.err) {
            return new Err(new Error("Something went wrong while extracting the submission."));
        }

        const resetResult = await resetExercise(context, exerciseId);

        if (resetResult.err) {
            return new Err(new Error("Couldn't reset exercise"));
        }

        const closedExPath = this.workspaceManager.getExercisePathById(exerciseId);

        if (closedExPath.err) {
            return new Err(new Error("?????"));
        }

        userFilePaths.val.response.studentFilePaths.forEach((dataPath) => {
            del.sync(path.join(closedExPath.val, dataPath), { force: true });
            fs.renameSync(
                path.join(oldSubmissionTempPath, dataPath),
                path.join(closedExPath.val, dataPath),
            );
        });

        this.workspaceManager.openExercise(exerciseId);

        del.sync(archivePath, { force: true });
        del.sync(oldSubmissionTempPath, { force: true });

        return new Ok("Old submission downloaded succesfully");
    }

    /**
     * Runs tests locally for an exercise
     * @param id Id of the exercise
     */
    public async runTests(id: number): Promise<Result<TmcLangsTestResults, Error>> {
        if (!this.workspaceManager) {
            throw displayProgrammerError("WorkspaceManager not assinged");
        }
        const exerciseFolderPath = this.workspaceManager.getExercisePathById(id);
        if (exerciseFolderPath.err) {
            return new Err(new Error("???"));
        }

        return this.checkApiResponse(
            this.executeLangsAction({
                action: "run-tests",
                exerciseFolderPath: exerciseFolderPath.val,
            }),
            createIs<TmcLangsTestResults>(),
        );
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
            return new Err(new Error("Couldn't get the exercise path"));
        }

        const compressResult = await this.checkApiResponse(
            this.executeLangsAction({
                action: "compress-project",
                archivePath: path.join(`${this.resources.getDataPath()}`, `${id}-new.zip`),
                exerciseFolderPath: exerciseFolderPath.val,
            }),
            createIs<TmcLangsPath>(),
        );
        if (compressResult.err) {
            return new Err(compressResult.val);
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

    /**
     * Function which returns old submissions as list from the server
     */
    public async fetchOldSubmissionIds(courseId: number): Promise<Result<OldSubmission[], Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`courses/${courseId}/users/current/submissions`, false),
            createIs<OldSubmission[]>(),
        );
    }

    /**
     * Executes external tmc-langs process with given arguments.
     * @param tmcLangsAction Tmc-langs command and arguments
     */
    private async executeLangsAction(
        tmcLangsAction: TmcLangsAction,
    ): Promise<Result<TmcLangsResponse, Error>> {
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
            case "run-tests":
                exercisePath = tmcLangsAction.exerciseFolderPath;
                outputPath = path.join(
                    this.resources.getDataPath(),
                    `temp_${this.nextLangsJsonId++}.json`,
                );
                break;
            case "get-exercise-packaging-configuration":
                exercisePath = tmcLangsAction.exerciseFolderPath;
                outputPath = path.join(
                    this.resources.getDataPath(),
                    `temp_${this.nextLangsJsonId++}.json`,
                );
                break;
        }

        console.log(outputPath);
        const arg0 = exercisePath ? `--exercisePath="${exercisePath}"` : "";
        const arg1 = `--outputPath="${outputPath}"`;

        const command = `${this.resources.getJavaPath()} -jar "${this.resources.getTmcLangsPath()}" ${action} ${arg0} ${arg1}`;

        console.log(command);

        let [stdout, stderr] = ["", ""];
        try {
            [stdout, stderr] = await new Promise((resolve, reject) => {
                cp.exec(command, (err, stdout, stderr) =>
                    err ? reject(err) : resolve([stdout, stderr]),
                );
            });
        } catch (err) {
            return new Err(err);
        }

        const logs = {
            stdout,
            stderr,
        };

        if (action === "extract-project" || action === "compress-project") {
            return new Ok({ response: outputPath, logs });
        }

        const result = { response: JSON.parse(fs.readFileSync(outputPath, "utf8")), logs };
        // del.sync(outputPath, { force: true });
        if (is<TmcLangsResponse>(result)) {
            return new Ok(result);
        }

        console.error(result);

        return new Err(new Error("Unexpected response JSON type"));
    }

    /**
     * Unwraps the response, checks the type, and rewraps it with the type error possibly included
     *
     * Note that the current type checking method requires the type checker to be passed as a parameter
     * to allow the correct type predicates to be generated during compilation
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
     * Performs an HTTP request to the hardcoded TMC server
     *
     * @param endpoint target API endpoint, can also be complete URL
     * @param method HTTP method, defaults to GET
     * @param cache By default returns from cache if method === get & cache === undefined and data exists in cache
     */
    private async tmcApiRequest(
        endpoint: string,
        cache: boolean | undefined,
        method?: "get" | "post",
        body?: string | FormData | url.URLSearchParams,
        headers?: { [key: string]: string },
    ): Promise<Result<TMCApiResponse, Error>> {
        method = method || "get";
        cache = cache === undefined ? method === "get" : cache;

        if (cache) {
            const cacheResult = this.cache.get(method + endpoint);
            if (cacheResult) {
                return new Ok(cacheResult);
            }
        }

        let request = {
            body,
            headers: headers ? headers : {},
            method: method ? method : "get",
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
                        this.cache.set(method + endpoint, responseObject);
                        return new Ok(responseObject);
                    }
                    console.error("Unexpected TMC response type: ");
                    console.error(responseObject);
                    return new Err(new ApiError("Unexpected response type"));
                } catch (error) {
                    return new Err(new ApiError("Response not in JSON format: " + error.name));
                }
            }
            if (response.status === 403) {
                return new Err(new AuthorizationError("403 - Forbidden"));
            }
            const errorText = await response.text();
            return new Err(
                new ApiError(`${response.status} - ${response.statusText} - ${errorText}`),
            );
        } catch (error) {
            return new Err(new ConnectionError("Connection error: " + error.name));
        }
    }
}

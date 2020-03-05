import * as cp from "child_process";
import ClientOauth2 = require("client-oauth2");
import * as FormData from "form-data";
import * as fs from "fs";
import * as fetch from "node-fetch";
import * as url from "url";
import Resources from "../config/resources";
import Storage from "../config/storage";

import { Err, Ok, Result } from "ts-results";
import { createIs, is } from "typescript-is";
import { ApiError, AuthenticationError, AuthorizationError, ConnectionError } from "../errors";
import { downloadFile } from "../utils";
import {
    Course, CourseDetails, ExerciseDetails, Organization, SubmissionFeedback,
    SubmissionFeedbackResponse, SubmissionResponse, SubmissionStatusReport,
    TMCApiResponse, TmcLangsAction, TmcLangsResponse, TmcLangsTestResults,
} from "./types";
import WorkspaceManager from "./workspaceManager";

/**
 * A Class for interacting with the TestMyCode service, including authentication
 */
export default class TMC {

    private readonly oauth2: ClientOauth2;
    private token: ClientOauth2.Token | undefined;
    private readonly storage: Storage;
    private readonly dataPath: string;
    private readonly tmcLangsPath: string;
    private readonly tmcApiUrl: string;
    private readonly tmcDefaultHeaders: { client: string, client_version: string };
    private readonly workspaceManager: WorkspaceManager;

    private readonly cache: Map<string, TMCApiResponse>;

    /**
     * Create the TMC service interaction class, includes setting up OAuth2 information
     */
    constructor(exerciseManager: WorkspaceManager, storage: Storage, resources: Resources) {
        this.oauth2 = new ClientOauth2({
            accessTokenUri: "https://tmc.mooc.fi/oauth/token",
            clientId: "72065a25dc4d3e9decdf8f49174a3e393756478d198833c64f6e5584946394f0",
            clientSecret: "3e6c4df1992e4031d316ea1933e350e9658326a67efb2e65a5b15207bdc09ee8",
        });
        this.storage = storage;
        const authToken = storage.getAuthenticationToken();
        if (authToken) {
            this.token = new ClientOauth2.Token(this.oauth2, authToken);
        }
        this.dataPath = resources.tmcDataFolder;
        this.tmcLangsPath = resources.tmcLangsPath;
        this.tmcApiUrl = "https://tmc.mooc.fi/api/v8/";
        this.cache = new Map();
        this.workspaceManager = exerciseManager;
        this.tmcDefaultHeaders = { client: "vscode_plugin", client_version: resources.extensionVersion };
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
    public deauthenticate() {
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
        return this.checkApiResponse(this.tmcApiRequest("org.json", cache), createIs<Organization[]>());
    }

    /**
     * @returns one Organization information
     * @param slug Organization slug/id
     */
    public getOrganization(slug: string, cache?: boolean): Promise<Result<Organization, Error>> {
        return this.checkApiResponse(this.tmcApiRequest(`org/${slug}.json`, cache), createIs<Organization>());
    }

    /**
     * Requires an organization to be selected
     * @returns a list of courses belonging to the currently selected organization
     */
    public getCourses(organization: string, cache?: boolean): Promise<Result<Course[], Error>> {
        return this.checkApiResponse(
            this.tmcApiRequest(`core/org/${organization}/courses`, cache), createIs<Course[]>(),
        );
    }

    /**
     * @param id course id
     * @returns a detailed description for the specified course
     */
    public getCourseDetails(id: number, cache?: boolean): Promise<Result<CourseDetails, Error>> {
        return this.checkApiResponse(this.tmcApiRequest(`core/courses/${id}`, cache), createIs<CourseDetails>());
    }

    /**
     * @param id Exercise id
     * @returns A description for the specified exercise
     */
    public async getExerciseDetails(id: number, cache?: boolean): Promise<Result<ExerciseDetails, Error>> {
        return this.checkApiResponse(this.tmcApiRequest(`core/exercises/${id}`, cache), createIs<ExerciseDetails>());
    }

    /**
     * Get submission status by url
     * @param submissionUrl Submission url
     */
    public async getSubmissionStatus(submissionUrl: string): Promise<Result<SubmissionStatusReport, Error>> {
        if (!this.token) {
            throw new Error("User not logged in!");
        }
        return this.checkApiResponse(this.tmcApiRequest(submissionUrl, false), createIs<SubmissionStatusReport>());
    }

    /**
     * Downloads exercise with given id and extracts it to the exercise folder.
     * @param id Id of the exercise to download
     * @param organizationSlug Slug for the organization this exercise belongs to.
     * @param reset If the call comes from resetExercise function, this is implemented because we need to be sure that
     * no other extension has generated the folder again.
     */
    public async downloadExercise(id: number, organizationSlug: string, reset?: boolean ):
    Promise<Result<string, Error>> {
        const result = await downloadFile(`${this.tmcApiUrl}core/exercises/${id}/download`,
            `${this.dataPath}/${id}.zip`, undefined, this.tmcDefaultHeaders);
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

        const checksum = courseResult.val.course.exercises.find((x) => x.id === id)?.checksum;

        if (!checksum) {
            return new Err(new Error("Exercise somehow missing from course"));
        }

        // TODO: Extract to a different location and handle pass that to ExerciseManager
        const exercisePath = this.workspaceManager.createExerciseDownloadPath(
            organizationSlug, checksum, detailsResult.val,
        );

        if (exercisePath.err) {
            return new Err(exercisePath.val);
        }

        const extractResult = await this.checkApiResponse(this.executeLangsAction({
            action: "extract-project",
            archivePath: `${this.dataPath}/${id}.zip`,
            exerciseFolderPath: exercisePath.val,
        }), createIs<string>());

        if (extractResult.err) {
            this.workspaceManager.deleteExercise(id);
        }

        // TODO: Return closed path and call open elsewhere
        const openResult = this.workspaceManager.openExercise(id, reset);

        if (openResult.err) {
            console.log("Opening failed");
        }

        return openResult;
    }

    /**
     * Runs tests locally for an exercise
     * @param id Id of the exercise
     */
    public async runTests(id: number): Promise<Result<TmcLangsTestResults, Error>> {
        const exerciseFolderPath = this.workspaceManager.getExerciseDataById(id);
        if (exerciseFolderPath.err) {
            return new Err(new Error("???"));
        }

        return this.checkApiResponse(this.executeLangsAction({
            action: "run-tests",
            exerciseFolderPath: exerciseFolderPath.val.path,
        }), createIs<TmcLangsTestResults>());
    }

    /**
     * Archives and submits the specified exercise to the TMC server
     * @param id Exercise id
     */
    public async submitExercise(id: number): Promise<Result<SubmissionResponse, Error>> {
        const exerciseFolderPath = this.workspaceManager.getExerciseDataById(id);

        if (exerciseFolderPath.err) {
            return new Err(new Error("???"));
        }

        const compressResult = await this.checkApiResponse(this.executeLangsAction({
            action: "compress-project",
            archivePath: `${this.dataPath}/${id}-new.zip`,
            exerciseFolderPath: exerciseFolderPath.val.path,
        }), createIs<string>());
        if (compressResult.err) {
            return new Err(compressResult.val);
        }
        const archivePath = compressResult.val;
        const form = new FormData();
        form.append("submission[file]", fs.createReadStream(archivePath));
        return this.checkApiResponse(this.tmcApiRequest(`core/exercises/${id}/submissions`, false, "post",
            form, form.getHeaders()), createIs<SubmissionResponse>());
    }

    /**
     * Submit feedback for a submission, only usable from the submission details view
     * @param feedbackUrl Feedback URL to use, from the submission response
     * @param feedback Feedback to submit, shouldn't be empty
     */
    public async submitSubmissionFeedback(feedbackUrl: string, feedback: SubmissionFeedback):
        Promise<Result<SubmissionFeedbackResponse, Error>> {
        const params = new url.URLSearchParams();
        feedback.status.forEach((answer, index) => {
            params.append(`answers[${index}][question_id]`, answer.question_id.toString());
            params.append(`answers[${index}][answer]`, answer.answer);
        });
        return this.checkApiResponse(this.tmcApiRequest(feedbackUrl, false, "post", params),
                                     createIs<SubmissionFeedbackResponse>());
    }

    /**
     * Executes external tmc-langs process with given arguments.
     * @param tmcLangsAction Tmc-langs command and arguments
     */
    private async executeLangsAction(tmcLangsAction: TmcLangsAction): Promise<Result<TmcLangsResponse, Error>> {
        const action = tmcLangsAction.action;
        let exercisePath = "";
        let outputPath = "";

        switch (tmcLangsAction.action) {
            case "extract-project":
                [exercisePath, outputPath] = [tmcLangsAction.archivePath, tmcLangsAction.exerciseFolderPath];
                break;
            case "compress-project":
                [outputPath, exercisePath] = [tmcLangsAction.archivePath, tmcLangsAction.exerciseFolderPath];
                break;
            case "run-tests":
                exercisePath = tmcLangsAction.exerciseFolderPath;
                outputPath = `${this.dataPath}/temp.json`;
                break;
        }

        const arg0 = (exercisePath) ? `--exercisePath="${exercisePath}"` : "";
        const arg1 = `--outputPath="${outputPath}"`;

        console.log(`java -jar "${this.tmcLangsPath}" ${action} ${arg0} ${arg1}`);
        try {
            await new Promise(async (resolve, reject) => {
                cp.exec(`java -jar "${this.tmcLangsPath}" ${action} ${arg0} ${arg1}`,
                    (err) => err ? reject(err) : resolve());
            });
        } catch (err) {
            return new Err(err);
        }

        if (action === "extract-project" || action === "compress-project") {
            return new Ok(outputPath);
        }

        const result = JSON.parse(fs.readFileSync(outputPath, "utf8"));
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
    private async checkApiResponse<T, U>(response: Promise<Result<U, Error>>,
                                         checker: (object: any) => object is T): Promise<Result<T, Error>> {
        const result = await response;
        if (result.ok) {
            return checker(result.val) ? new Ok(result.val) : new Err(new ApiError("Incorrect response type"));
        }
        return new Err(result.val);
    }

    /**
     * Performs an HTTP request to the hardcoded TMC server
     * @param endpoint target API endpoint, can also be complete URL
     * @param method HTTP method, defaults to GET
     */
    private async tmcApiRequest(endpoint: string, cache: boolean | undefined,
                                method?: "get" | "post", body?: any, headers?: any):
        Promise<Result<TMCApiResponse, Error>> {

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
            return new Err(new ApiError(`${response.status} - ${response.statusText} - ${errorText}`));
        } catch (error) {
            return new Err(new ConnectionError("Connection error: " + error.name));
        }
    }
}

import * as cp from "child_process";
import ClientOauth2 = require("client-oauth2");
import * as fs from "fs";
import * as fetch from "node-fetch";
import * as vscode from "vscode";
import Resources from "../config/resources";
import Storage from "../config/storage";

import { Err, Ok, Result } from "ts-results";
import { createIs, is } from "typescript-is";
import { ApiError, AuthenticationError, AuthorizationError, ConnectionError } from "../errors";
import { downloadFile } from "../utils";
import { Course, CourseDetails, Organization, TMCApiResponse,
         TmcLangsAction, TmcLangsResponse, TmcLangsTestResults } from "./types";

/**
 * A Class for interacting with the TestMyCode service, including authentication
 */
export default class TMC {

    private readonly oauth2: ClientOauth2;
    private token: ClientOauth2.Token | undefined;
    private readonly storage: Storage;
    private readonly dataPath: string;
    private readonly tmcLangsPath: string;

    /**
     * Create the TMC service interaction class, includes setting up OAuth2 information
     */
    constructor(storage: Storage, extensionContext: vscode.ExtensionContext, resources: Resources) {
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
    public getOrganizations(): Promise<Result<Organization[], Error>> {
        return this.checkApiResponse(this.tmcApiRequest("org.json"), createIs<Organization[]>());
    }

    /**
     * @returns one Organization information
     * @param slug Organization slug/id
     */
    public getOrganization(slug: string): Promise<Result<Organization, Error>> {
        return this.checkApiResponse(this.tmcApiRequest(`org/${slug}.json`), createIs<Organization>());
    }

    /**
     * Requires an organization to be selected
     * @returns a list of courses belonging to the currently selected organization
     */
    public getCourses(): Promise<Result<Course[], Error>> {
        const orgSlug = this.storage.getOrganizationSlug();
        if (!orgSlug) {
            throw new Error("Organization not selected");
        }
        return this.checkApiResponse(this.tmcApiRequest(`core/org/${orgSlug}/courses`), createIs<Course[]>());
    }

    /**
     * @param id course id
     * @returns a detailed description for the specified course
     */
    public getCourseDetails(id: number): Promise<Result<CourseDetails, Error>> {
        return this.checkApiResponse(this.tmcApiRequest(`core/courses/${id}`), createIs<CourseDetails>());
    }

    /**
     * Downloads exercise with given id and extracts it to the exercise folder.
     * @param id Id of the exercise to download
     */
    public async downloadExercise(id: number): Promise<Result<string, Error>> {
        const result = await downloadFile(`https://tmc.mooc.fi/api/v8/core/exercises/${id}/download`, `${this.dataPath}/${id}.zip`);
        if (result.ok) {
            return this.checkApiResponse(this.executeLangsAction({
                action: "extract-project",
                archivePath: `${this.dataPath}/${id}.zip`,
                exerciseFolderPath: `${this.dataPath}/${id}`,
            }), createIs<string>());
        }
        return new Err(result.val);
    }

    /**
     * Temporary: creates a submission archive and returns its path
     * @param id Id of the exercise
     */
    public async prepareSubmissionArchive(id: number): Promise<Result<string, Error>> {
        return this.checkApiResponse(this.executeLangsAction({
            action: "compress-project",
            archivePath: `${this.dataPath}/${id}-new.zip`,
            exerciseFolderPath: `${this.dataPath}/${id}`,
        }), createIs<string>());
    }

    /**
     * Runs tests locally for an exercise
     * @param id Id of the exercise
     */
    public async runTests(id: number): Promise<Result<TmcLangsTestResults, Error>> {
        return this.checkApiResponse(this.executeLangsAction({
            action: "run-tests",
            exerciseFolderPath: `${this.dataPath}/${id}`,
        }), createIs<TmcLangsTestResults>());
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

        console.log(`java -jar ${this.tmcLangsPath} ${action} ${arg0} ${arg1}`);
        cp.execSync(`java -jar ${this.tmcLangsPath} ${action} ${arg0} ${arg1}`);

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
     * @param endpoint target API endpoint
     * @param method HTTP method, defaults to GET
     */
    private async tmcApiRequest(endpoint: string, method?: "get" | "post"): Promise<Result<TMCApiResponse, Error>> {
        let request = {
            headers: {},
            method: method ? method : "get",
            url: `https://tmc.mooc.fi/api/v8/${endpoint}`,
        };

        if (this.token) {
            request = this.token.sign(request);
        }

        try {
            const response = await fetch.default(request.url, request);
            if (response.ok) {
                try {
                    const responseObject = await response.json();
                    if (is<TMCApiResponse>(responseObject)) {
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
            return new Err(new ApiError(response.status + " - " + response.statusText));
        } catch (error) {
            return new Err(new ConnectionError("Connection error: " + error.name));
        }
    }
}

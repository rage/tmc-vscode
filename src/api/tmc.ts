import ClientOauth2 = require("client-oauth2");
import * as fetch from "node-fetch";
import Storage from "../config/storage";

import { Err, Ok, Result } from "ts-results";
import { ApiError, AuthenticationError, ConnectionError } from "../errors";

/**
 * A Class for interacting with the TestMyCode service, including authentication
 */
export default class TMC {

    private oauth2: ClientOauth2;
    private token: ClientOauth2.Token | undefined;
    private storage: Storage;

    /**
     * Create the TMC service interaction class, includes setting up OAuth2 information
     */
    constructor(storage: Storage) {
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
    public async getOrganizations(): Promise<Result<Organization[], Error>> {
        const result = await this.tmcApiRequest("orgs.json");
        return result.ok ? new Ok(result.val as Organization[]) : new Err(result.val);
    }

    /**
     * Requires an organization to be selected
     * @returns a list of courses belonging to the currently selected organization
     */
    public async getCourses(): Promise<Result<Course[], Error>> {
        const orgSlug = this.storage.getOrganizationSlug();
        if (!orgSlug) {
            throw new Error("Organization not selected");
        }
        const result = await this.tmcApiRequest(`core/org/${orgSlug}/courses`);
        return result.ok ? new Ok(result.val as Course[]) : new Err(result.val);
    }

    /**
     * @param id course id
     * @returns a detailed description for the specified course
     */
    public async getCourseDetails(id: number): Promise<Result<CourseDetails, Error>> {
        const result = await this.tmcApiRequest(`core/courses/${id}`);
        return result.ok ? new Ok(result.val as CourseDetails) : new Err(result.val);
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
            return response.ok ?
                new Ok(await response.json() as TMCApiResponse) :
                new Err(new ApiError(response.status + " - " + response.statusText));
        } catch (error) {
            return new Err(new ConnectionError("Connection error: " + error.name));
        }
    }
}

type Course = {
    id: number;
    name: string;
    title: string;
    description: string;
    details_url: string;
    unlock_url: string;
    reviews_url: string;
    comet_url: string;
    spyware_urls: string[];
};

type CourseDetails = {
    course: Course & {
        unlockables: string[],
        exercises: Exercise[],
    };
};

// TODO: use runtime typechecking to verify correctness of this and other types
type Exercise = {
    id: number;
    name: string;
    locked: boolean;
    deadline_description: string | null;
    deadline: string | null;
    soft_deadline: string | null;
    soft_deadline_description: string | null;
    checksum: string;
    return_url: string;
    zip_url: string;
    returnable: boolean;
    requires_review: boolean;
    attempted: boolean;
    completed: boolean;
    reviewed: boolean;
    all_review_points_given: boolean;
    memory_limit: number | null;
    runtime_params: string[];
    valgrind_strategy: string;
    code_review_requests_enabled: boolean;
    run_tests_locally_action_enabled: boolean;
    latest_submission_url?: string;
    latest_submission_id?: number;
    solution_zip_url?: string;
};

type Organization = {
    name: string;
    information: string;
    slug: string;
    logo_path: string;
    pinned: boolean;
};

type TMCApiResponse = Course[] | CourseDetails | Organization[];

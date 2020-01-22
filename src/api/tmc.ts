import ClientOauth2 = require("client-oauth2");
import Storage from "../config/storage";

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
    public async authenticate(username: string, password: string): Promise<{success: boolean, errorDesc: string}> {
        if (this.token) {
            throw new Error("Authentication token already exists.");
        }
        try {
            this.token = await this.oauth2.owner.getToken(username, password);
        } catch (err) {
            if (err.code === "EAUTH") {
                return {success: false, errorDesc: "Authentication error"};
            } else if (err.code === "EUNAVAILABLE") {
                return {success: false, errorDesc: "Connection error"};
            }
            console.error(err);
            return {success: false, errorDesc: "Unknown error"};
        }
        this.storage.updateAuthenticationToken(this.token.data);
        return {success: true, errorDesc: ""};
    }

    /**
     * Logs out by deleting the authentication token.
     */
    public deauthenticate() {
        this.token = undefined;
        this.storage.updateAuthenticationToken(undefined);
    }

    public isAuthenticated(): boolean {
        return this.token !== undefined;
    }
}

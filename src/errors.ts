
export class ConnectionError implements Error {
    public name = "ConnectionError";
    public message = "";
    constructor(message?: string) {
        if (message) {
            this.message = message;
        }
    }
}

export class AuthenticationError implements Error {
    public name = "AuthenticationError";
    public message = "";
    constructor(message?: string) {
        if (message) {
            this.message = message;
        }
    }
}

export class ApiError implements Error {
    public name = "ApiError";
    public message = "";
    constructor(message?: string) {
        if (message) {
            this.message = message;
        }
    }
}

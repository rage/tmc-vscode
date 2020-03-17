class BaseError implements Error {
    public readonly name: string = "BaseError";
    public message: string;
    constructor(message?: string) {
        this.message = message ? message : "";
    }
}

export class ConnectionError extends BaseError {
    public readonly name = "ConnectionError";
}

export class AuthenticationError extends BaseError {
    public readonly name = "AuthenticationError";
}

export class ApiError extends BaseError {
    public readonly name = "ApiError";
}

export class AuthorizationError extends BaseError {
    public readonly name = "AuthorizationError";
}

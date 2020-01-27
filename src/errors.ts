
class BaseError {
    public readonly name: string = "BaseError";
    public message: string;
    constructor(message?: string) {
        this.message = message ? message : "";
    }
}

export class ConnectionError extends BaseError implements Error {
    public readonly name = "ConnectionError";
}

export class AuthenticationError extends BaseError implements Error {
    public readonly name = "AuthenticationError";
}

export class ApiError extends BaseError implements Error {
    public readonly name = "ApiError";
}

export class AuthorizationError extends BaseError implements Error {
    public readonly name = "AuthorizationError";
}

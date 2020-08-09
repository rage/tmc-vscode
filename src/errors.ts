class BaseError extends Error {
    public readonly name: string = "BaseError";
    public details: string;
    constructor(message?: string, details?: string) {
        super(message);
        this.details = details ? details : "";
    }
}

export class ConnectionError extends BaseError {
    public readonly name = "ConnectionError";
}

export class ExerciseExistsError extends BaseError {
    public readonly name = "ExerciseExistsError";
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

export class RuntimeError extends BaseError {
    public readonly name = "RuntimeError";
}

export class TimeoutError extends BaseError {
    public readonly name = "TimeoutError";
}

class BaseError extends Error {
    public readonly name: string = "Base Error";
    public details: string;
    constructor(message?: string, details?: string) {
        super(message);
        this.details = details ? details : "";
    }
}
export class ApiError extends BaseError {
    public readonly name = "API Error";
}
export class AuthenticationError extends BaseError {
    public readonly name = "Authentication Error";
}

export class AuthorizationError extends BaseError {
    public readonly name = "Authorization Error";
}

export class ConnectionError extends BaseError {
    public readonly name = "Connection Error";
}

export class ExerciseExistsError extends BaseError {
    public readonly name = "Exercise Exists Error";
}

export class ForbiddenError extends BaseError {
    public readonly name = "Forbidden Error";
}

export class ObsoleteClientError extends BaseError {
    public readonly name = "Obsolete Client Error";
}
export class RuntimeError extends BaseError {
    public readonly name = "Runtime Error";
}

export class TimeoutError extends BaseError {
    public readonly name = "Timeout Error";
}

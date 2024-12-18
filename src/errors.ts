import { BaseError } from "./shared/shared";

export class ApiError extends BaseError {
    public readonly name = "API Error";
}
export class AuthenticationError extends BaseError {
    public readonly name = "Authentication Error";
}

export class AuthorizationError extends BaseError {
    public readonly name = "Authorization Error";
}

export class BottleneckError extends BaseError {
    public readonly name = "Bottleneck Error";
}

export class ConnectionError extends BaseError {
    public readonly name = "Connection Error";
}

export class EmptyLangsResponseError extends BaseError {
    public readonly name = "Empy Langs Response Error";
}

export class ExerciseExistsError extends BaseError {
    public readonly name = "Exercise Exists Error";
}

export class ForbiddenError extends BaseError {
    public readonly name = "Forbidden Error";
}

export class HaltForReloadError extends BaseError {
    public readonly name = "Reload Required error";
}

export class InvalidTokenError extends BaseError {
    public readonly name = "Invalid Token Error";
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

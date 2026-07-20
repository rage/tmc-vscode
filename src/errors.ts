import { BaseError } from "./shared/shared"

export class ApiError extends BaseError {
  public override readonly name = "API Error"
}
export class AuthenticationError extends BaseError {
  public override readonly name = "Authentication Error"
}

export class AuthorizationError extends BaseError {
  public override readonly name = "Authorization Error"
}

export class BottleneckError extends BaseError {
  public override readonly name = "Bottleneck Error"
}

export class ConnectionError extends BaseError {
  public override readonly name = "Connection Error"
}

export class EmptyLangsResponseError extends BaseError {
  public override readonly name = "Empy Langs Response Error"
}

export class ExerciseExistsError extends BaseError {
  public override readonly name = "Exercise Exists Error"
}

export class ForbiddenError extends BaseError {
  public override readonly name = "Forbidden Error"
}

export class HaltForReloadError extends BaseError {
  public override readonly name = "Reload Required error"
}

export class InvalidTokenError extends BaseError {
  public override readonly name = "Invalid Token Error"
}

export class ObsoleteClientError extends BaseError {
  public override readonly name = "Obsolete Client Error"
}

export class RuntimeError extends BaseError {
  public override readonly name = "Runtime Error"
}

export class TimeoutError extends BaseError {
  public override readonly name = "Timeout Error"
}

export class InitializationError extends BaseError {
  public override readonly name = "Initialization Error"
}

export class ExerciseUpdateError extends BaseError {
  public override readonly name = "Exercise Update Error"
}

export class FileSystemError extends BaseError {
  public override readonly name = "File System Error"
}

export class ExerciseMigrationError extends BaseError {
  public override readonly name = "Exercise Migration Error"
}

export class SpawnError extends BaseError {
  public override readonly name = "Langs Spawn Error"
}

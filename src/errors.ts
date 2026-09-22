import type { BackendKind } from "./shared/shared"
import { backendName, BaseError } from "./shared/shared"
import { formatErrorMessage } from "./utilities/logger"

export class AuthorizationError extends BaseError {
  public override readonly name = "Authorization Error"
}

export class BottleneckError extends BaseError {
  public override readonly name = "Bottleneck Error"
}

export class ConnectionError extends BaseError {
  public override readonly name = "Connection Error"
}

/**
 * Raised when a value in global state no longer matches the schema its migration
 * writes. Callers must fail rather than carry on from an empty value: the blob is the
 * only copy of the user's course catalogue, and the next write would persist the empty
 * one over it. It is left untouched.
 */
export class CorruptStoredDataError extends BaseError {
  public override readonly name = "Corrupt Stored Data Error"
}

export class EmptyLangsResponseError extends BaseError {
  public override readonly name = "Empty Langs Response Error"
}

export class ForbiddenError extends BaseError {
  public override readonly name = "Forbidden Error"
}

/**
 * A courses.mooc.fi session that is valid but does not grant access to programming
 * exercises. Only a fresh login fixes it; nothing about the course is wrong.
 *
 * Distinct from {@link ForbiddenError}, which tmc.mooc.fi returns for a course the user
 * may not see and which therefore does say something about the course.
 */
export class InsufficientScopeError extends BaseError {
  public override readonly name = "Insufficient Scope Error"
}

export class InvalidTokenError extends BaseError {
  public override readonly name = "Invalid Token Error"
}

export class NotEnrolledError extends BaseError {
  public override readonly name = "Not Enrolled Error"
}

/** A submission named an uploaded file whose retention window had elapsed. */
export class UploadExpiredError extends BaseError {
  public override readonly name = "Upload Expired Error"
}

/** A submission named a file the backend has no upload record of: a client bug. */
export class UnknownUploadError extends BaseError {
  public override readonly name = "Unknown Upload Error"
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

export class LangsResponseSchemaError extends BaseError {
  public override readonly name = "Langs Response Schema Error"
}

/** A button offered beside an error notification: its label, and the command pressing it runs. */
export interface ErrorAction {
  label: string
  command: string
}

/** How an error reaches the user: the sentence they read, and what they can do about it. */
export interface ErrorPresentation {
  message: string
  actions: ErrorAction[]
}

/**
 * How to show `error` to the user.
 *
 * Every class whose remedy follows from the class itself states that remedy here, so no
 * call site spells one out and the same failure reads the same way wherever it surfaces.
 * A class with no entry shows its own message and no buttons, which is the right answer
 * for a failure the user cannot act on. The message never carries a stack trace; the
 * output channel takes that.
 *
 * @param backend Names the backend in the sentence, for the errors either backend can
 * raise. Omit it where the caller does not know which one, and the sentence stays
 * backend-neutral.
 */
export function presentationFor(error: Error, backend?: BackendKind): ErrorPresentation {
  const reported = formatErrorMessage(error)
  if (error instanceof InsufficientScopeError) {
    return {
      message:
        `${reported} Your ${backendName("mooc")} session no longer grants access to` +
        " programming exercises. Log in again to continue.",
      actions: [{ label: "Log in", command: "tmc.showMoocLogin" }],
    }
  }
  if (error instanceof NotEnrolledError) {
    const site = backend === undefined ? "" : ` on ${backendName(backend)}`
    return {
      message:
        `${reported} You are no longer enrolled on this course${site}, so its exercises` +
        ` can't be fetched. Enroll on the course again${site}, then reload it here.`,
      actions: [],
    }
  }
  if (error instanceof UploadExpiredError) {
    return {
      message:
        `${reported} The submission's files expired on the server before the submission` +
        " was accepted. Please try again.",
      actions: [],
    }
  }
  if (error instanceof ObsoleteClientError) {
    return {
      message:
        `${reported} This extension is out of date, please update it.` +
        " https://code.visualstudio.com/docs/editor/extension-gallery",
      actions: [],
    }
  }
  return { message: reported, actions: [] }
}

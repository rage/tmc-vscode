import type { RunnableCommand } from "../shared/lib"
import { asSentence, backendName, BaseError } from "../shared/lib"

export class AuthorizationError extends BaseError {
  public override readonly name: string = "Authorization Error"
}

/**
 * tmc.mooc.fi refused the request's credentials: the courses.mooc.fi login, which it may not
 * accept yet, or none at all. Logging in again does not fix the former.
 */
export class TmcLoginNotAcceptedError extends AuthorizationError {
  public override readonly name = "TMC Login Not Accepted Error"
}

export class BottleneckError extends BaseError {
  public override readonly name = "Bottleneck Error"
}

/** A backend could not be reached at all; one that answered with an error status is not this. */
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

/** A mooc exercise's try limit is used up, so the backend accepts no further submission. */
export class OutOfTriesError extends BaseError {
  public override readonly name = "Out Of Tries Error"
}

/** The exercise's hard deadline, or its chapter's, has passed: no further submission counts. */
export class DeadlinePassedError extends BaseError {
  public override readonly name = "Deadline Passed Error"
}

/**
 * The exercise's chapter has not opened yet. Like {@link ExerciseRemovedError}, raised also
 * before asking the backend, for an exercise on disk whose chapter has closed since.
 */
export class ChapterNotOpenError extends BaseError {
  public override readonly name = "Chapter Not Open Error"
}

/**
 * Chapter locking refuses submissions to the exercise's chapter: it is not unlocked yet, or the
 * student has completed and locked it.
 */
export class ChapterLockedError extends BaseError {
  public override readonly name = "Chapter Locked Error"
}

/** Whether `error` is the backend's standing refusal of the exercise, which no retry changes. */
export function isSubmitRefusal(error: Error): boolean {
  return (
    error instanceof OutOfTriesError ||
    error instanceof DeadlinePassedError ||
    error instanceof ChapterNotOpenError ||
    error instanceof ChapterLockedError
  )
}

/** The user denied a courses.mooc.fi device login in the browser. */
export class DeviceLoginDeniedError extends BaseError {
  public override readonly name = "Device Login Denied Error"
}

/** A courses.mooc.fi device login code expired before the user approved it. */
export class DeviceLoginExpiredError extends BaseError {
  public override readonly name = "Device Login Expired Error"
}

export class EmptyLangsResponseError extends BaseError {
  public override readonly name = "Empty Langs Response Error"
}

/** A backend answered 404: what was asked for does not exist, or not for this user. */
export class NotFoundError extends BaseError {
  public override readonly name = "Not Found Error"
  public httpStatus?: number | undefined
}

/** A backend answered with a 5xx status: it was reached, and failed. Worth retrying later. */
export class ServerError extends BaseError {
  public override readonly name = "Server Error"
  public httpStatus?: number | undefined
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

/** Runs `tmc.enrollOnCourse`, which opens the page of a course the student is not enrolled on. */
export const ENROLL_ON_COURSE_COMMAND = "tmc.enrollOnCourse"

/** courses.mooc.fi refused a paste because the exercise was pasted too often recently. */
export class RateLimitedError extends BaseError {
  public override readonly name = "Rate Limited Error"
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
  /** The error status a backend answered with, when that is what failed. */
  public httpStatus?: number | undefined
}

export class TimeoutError extends BaseError {
  public override readonly name = "Timeout Error"
}

export class InitializationError extends BaseError {
  public override readonly name: string = "Initialization Error"
}

/**
 * The TestMyCode tools on disk failed their checksum, so they may be damaged or tampered with,
 * and downloading them again failed. Unlike a plain download failure, the file is there.
 */
export class CliVerificationError extends InitializationError {
  public override readonly name = "CLI Verification Error"

  /**
   * @param cliPath The file that failed verification.
   * @param downloadFailure Why downloading it again failed.
   * @param details The digests and sources that did not match.
   */
  public constructor(
    public readonly cliPath: string,
    downloadFailure: Error,
    details: string,
  ) {
    super(
      "The TestMyCode tools on this computer failed their integrity check, and downloading " +
        `them again failed: ${downloadFailure.message}`,
      details,
    )
  }
}

/**
 * The exercise is on disk, but its course no longer lists it, so nothing on the backend can be
 * done with it. The message names the exercise and is the whole story.
 */
export class ExerciseRemovedError extends BaseError {
  public override readonly name = "Exercise Removed Error"
}

/** The exercise is gone from its backend, such as one removed from the course since download. */
export class ExerciseNotFoundError extends BaseError {
  public override readonly name = "Exercise Not Found Error"
}

export class ExerciseUpdateError extends BaseError {
  public override readonly name = "Exercise Update Error"
}

export class FileSystemError extends BaseError {
  public override readonly name = "File System Error"
}

export class SpawnError extends BaseError {
  public override readonly name = "Langs Spawn Error"
}

export class LangsResponseSchemaError extends BaseError {
  public override readonly name = "Langs Response Schema Error"
}

/** The command that asks to trust the course workspace; see {@link WorkspaceUntrustedError}. */
export const TRUST_COURSE_WORKSPACE_COMMAND = "tmc.trustCourseWorkspace"

/**
 * Running, submitting or sharing exercise code was refused because the window is in Restricted
 * Mode. The refused command may run again once the user trusts the workspace; see
 * `WorkspaceTrustGate`.
 */
export class WorkspaceUntrustedError extends BaseError {
  public override readonly name = "Workspace Untrusted Error"
}

/** The command that opens where the last {@link AiUseRefusedError}'s cause can be fixed. */
export const SHOW_AI_USE_PROBLEM_COMMAND = "tmc.showAiUseProblem"

/**
 * Submitting, testing or pasting an exercise was refused because AI assistance may be on in
 * the window. The message says what to change.
 */
export class AiUseRefusedError extends BaseError {
  public override readonly name = "AI Use Refused Error"

  /**
   * @param remedyLabel Names the button that runs {@link SHOW_AI_USE_PROBLEM_COMMAND}; there is
   * none without it.
   */
  public constructor(
    message: string,
    public readonly remedyLabel?: string,
  ) {
    super(message)
  }
}

/** A button offered beside an error notification: its label, and the command pressing it runs. */
export interface ErrorAction {
  label: string
  command: RunnableCommand
}

/** How an error reaches the user: the sentence they read, and what they can do about it. */
export interface ErrorPresentation {
  message: string
  actions: ErrorAction[]
  /** The operation was held back rather than failed, so the message stands alone as a warning. */
  isHeldBack?: boolean
}

/**
 * The error as one sentence for the user: its message, and nothing else.
 *
 * Deliberately not the logger's formatter, which also appends the class name, `details` —
 * on a CLI failure that is the process's backtrace and the tail of its stderr — the `cause`
 * chain, and the stack. Those diagnose a failure rather than describe it, and a notification
 * is the one place they cannot be scrolled or copied. The logger still writes all of them to
 * the output channel, which the "Show Logs" button reveals.
 */
function userSentence(error: Error): string {
  const trimmed = error.message.trim() || error.name
  // A leading identifier such as "tmc-langs-cli" keeps its case.
  const message = /^[a-z]+(\s|$)/.test(trimmed)
    ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    : trimmed
  return asSentence(message)
}

/**
 * How to show `error` to the user.
 *
 * Every class whose remedy follows from the class itself states that remedy here, so no
 * call site spells one out and the same failure reads the same way wherever it surfaces.
 * A class with no entry shows its own message and no buttons, which is the right answer
 * for a failure the user cannot act on. No message carries diagnostics; see
 * {@link userSentence}. An error a backend raised names that backend where it matters.
 */
/** Whether `error` means the courses.mooc.fi session is gone, which only a new login fixes. */
export function isSessionLost(error: Error): boolean {
  const backend = error instanceof BaseError ? error.backend : undefined
  return (
    error instanceof InvalidTokenError || (error instanceof AuthorizationError && backend !== "tmc")
  )
}

/** What every surface that tells of a lost session says. */
export const SESSION_ENDED_MESSAGE = `Your ${backendName("mooc")} session has ended. Log in again to continue.`

export function presentationFor(error: Error): ErrorPresentation {
  const backend = error instanceof BaseError ? error.backend : undefined
  const reported = userSentence(error)
  if (error instanceof AiUseRefusedError) {
    return {
      message: reported,
      actions: error.remedyLabel
        ? [{ label: error.remedyLabel, command: SHOW_AI_USE_PROBLEM_COMMAND }]
        : [],
    }
  }
  if (error instanceof ExerciseRemovedError || isSubmitRefusal(error)) {
    return { message: reported, actions: [], isHeldBack: true }
  }
  if (error instanceof WorkspaceUntrustedError) {
    return {
      message: reported,
      actions: [{ label: "Trust Course Workspace", command: TRUST_COURSE_WORKSPACE_COMMAND }],
      isHeldBack: true,
    }
  }
  if (error instanceof TmcLoginNotAcceptedError) {
    return {
      message:
        `${backendName("tmc")} did not accept your login. It may not accept` +
        ` ${backendName("mooc")} logins yet.`,
      actions: [],
    }
  }
  if (isSessionLost(error)) {
    return {
      message: SESSION_ENDED_MESSAGE,
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
    }
  }
  if (error instanceof InsufficientScopeError) {
    return {
      message:
        `${reported} Your ${backendName("mooc")} session no longer grants access to` +
        " programming exercises. Log in again to continue.",
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
    }
  }
  if (error instanceof NotEnrolledError) {
    const site = backend === undefined ? "" : ` on ${backendName(backend)}`
    return {
      message:
        `You're no longer enrolled on this course${site}, so its exercises can't be submitted.` +
        ` You can still download them and your earlier submissions. Enroll on the course` +
        ` again${site}, then refresh it here.`,
      actions: [{ label: "Open Course Page", command: ENROLL_ON_COURSE_COMMAND }],
    }
  }
  if (error instanceof UploadExpiredError) {
    // tmc-langs uploads and submits within one invocation and has already retried the
    // upload itself, so submitting afresh is the only step left to suggest.
    return {
      message:
        `${reported} The submission's files expired on the server before the submission` +
        " was accepted. Please try again.",
      actions: [],
    }
  }
  if (error instanceof ExerciseNotFoundError) {
    return {
      message: `${reported} Refresh the courses to see the course's current exercises.`,
      actions: [{ label: "Refresh Courses", command: "tmcTreeView.refreshCourses" }],
    }
  }
  if (error instanceof SpawnError || error instanceof EmptyLangsResponseError) {
    return {
      message:
        `${reported} An antivirus program may be blocking the TestMyCode tools;` +
        " the help page says how to allow them.",
      actions: [{ label: "Show Help", command: "tmc.viewInitializationErrorHelp" }],
    }
  }
  if (error instanceof InitializationError) {
    return {
      message: `${reported} The help page lists what failed and how to fix it.`,
      actions: [{ label: "Show Help", command: "tmc.viewInitializationErrorHelp" }],
    }
  }
  if (error instanceof ObsoleteClientError) {
    return {
      message: `${reported} This extension is out of date, please update it.`,
      actions: [
        { label: "Update Extension", command: "workbench.extensions.action.checkForUpdates" },
      ],
    }
  }
  if (error instanceof ConnectionError && backend !== undefined) {
    return {
      message: `${backendName(backend)} could not be reached. Check your network connection.`,
      actions: [],
    }
  }
  if (
    (error instanceof NotFoundError ||
      error instanceof ServerError ||
      error instanceof RuntimeError) &&
    error.httpStatus !== undefined
  ) {
    // The reported message quotes the raw response body.
    const server = backend === undefined ? "The server" : backendName(backend)
    const retry = error.httpStatus >= 500 ? " Try again later." : ""
    return { message: `${server} returned an error (${error.httpStatus}).${retry}`, actions: [] }
  }
  return { message: reported, actions: [] }
}

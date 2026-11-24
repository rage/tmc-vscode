import type { Kind } from "../shared/langsSchema"
import type { RunnableCommand } from "../shared/lib"
import { asSentence, BaseError, countOf, LOGGED_OUT_MESSAGE } from "../shared/lib"
import { fileProblemOf } from "./utilities/fileProblem"

export class AuthorizationError extends BaseError {
  public override readonly name: string = "Authorization Error"
}

/**
 * tmc.mooc.fi refused the courses.mooc.fi login that courses.mooc.fi itself still accepts, such
 * as one with no linked tmc.mooc.fi account. Logging in again does not fix it.
 */
export class TmcLoginNotAcceptedError extends AuthorizationError {
  public override readonly name = "TMC Login Not Accepted Error"
}

/** tmc.mooc.fi could not have courses.mooc.fi confirm the login just now; the login is fine. */
export class TmcLoginUnconfirmedError extends BaseError {
  public override readonly name = "TMC Login Unconfirmed Error"
}

/** courses.mooc.fi's login service refused this client itself; no new login can fix that. */
export class LoginClientRejectedError extends BaseError {
  public override readonly name = "Login Client Rejected Error"
}

/**
 * A stored tmc.mooc.fi login from an earlier version was refused and has been removed. Later
 * commands use the courses.mooc.fi login, if there is one.
 */
export class LegacyTmcLoginEndedError extends BaseError {
  public override readonly name = "Legacy TMC Login Ended Error"
}

export class BottleneckError extends BaseError {
  public override readonly name = "Bottleneck Error"
}

/** A backend could not be reached at all; one that answered with an error status is not this. */
export class ConnectionError extends BaseError {
  public override readonly name: string = "Connection Error"
}

/** No answer in time: the server may be slow rather than unreachable. */
export class ConnectionTimeoutError extends ConnectionError {
  public override readonly name = "Connection Timeout Error"
}

/** TLS failed, typically a network security product's certificate or a wrong system clock. */
export class CertificateError extends ConnectionError {
  public override readonly name = "Certificate Error"
}

/** A proxy refused the connection or asked for credentials. */
export class ProxyError extends ConnectionError {
  public override readonly name = "Proxy Error"
}

/** The server answered with something unreadable, such as a captive portal's sign-in page. */
export class UnexpectedResponseError extends BaseError {
  public override readonly name = "Unexpected Response Error"
}

/** The server refused the request as invalid; sending it again cannot help. */
export class InvalidRequestError extends BaseError {
  public override readonly name = "Invalid Request Error"
  public httpStatus?: number | undefined
}

/**
 * A value in global state no longer matches the schema its migration writes. Callers must
 * fail rather than continue from an empty value: the blob is the only copy of the user's
 * course catalogue, and the next write would overwrite it. It is left untouched.
 */
export class CorruptStoredDataError extends BaseError {
  public override readonly name = "Corrupt Stored Data Error"
}

/**
 * Data an earlier version stored could not be brought up to the current storage version. What
 * was stored is left as it was, so the next activation tries again. `details` holds the
 * migration log.
 */
export class StoredDataMigrationError extends BaseError {
  public override readonly name = "Stored Data Migration Error"
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

/** The exercise takes no more submissions from the student until a teacher resets it. */
export class ExerciseLockedError extends BaseError {
  public override readonly name = "Exercise Locked Error"
}

/**
 * The exercise's backend no longer serves its course: the student lost access to it, or it was
 * deleted. The exercise stays on disk and its tests still run.
 */
export class CourseAccessLostError extends BaseError {
  public override readonly name = "Course Access Lost Error"
}

/** Whether `error` is the backend's standing refusal of the exercise, which no retry changes. */
export function isSubmitRefusal(error: Error): boolean {
  return (
    error instanceof CourseAccessLostError ||
    error instanceof OutOfTriesError ||
    error instanceof DeadlinePassedError ||
    error instanceof ChapterNotOpenError ||
    error instanceof ChapterLockedError ||
    error instanceof ExerciseLockedError
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

/** The CLI ended without a result: it crashed, ran out of memory or was killed. */
export class EmptyLangsResponseError extends BaseError {
  public override readonly name = "Empty Langs Response Error"
  public exitCode?: number | null
  public signal?: string | null
}

/** The CLI's panic handler reported a bug in the CLI itself. */
export class CliCrashedError extends BaseError {
  public override readonly name = "CLI Crashed Error"
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

/** The server refused access to what was asked for, such as a closed or unpublished course. */
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

/** The server refused a request because too many came recently. */
export class RateLimitedError extends BaseError {
  public override readonly name = "Rate Limited Error"
  /** How long the server asked to wait, when it said. */
  public retryAfterSeconds?: number | undefined
  /** The limit is on pasting the exercise, not on the network's requests. */
  public isPasteLimit?: boolean | undefined
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

/** The CLI could not read or write a file the user can do something about; `path` names it. */
export class FileAccessError extends BaseError {
  public override readonly name = "File Access Error"
}

/** A file TestMyCode keeps on this computer could not be read. */
export class LocalConfigCorruptError extends BaseError {
  public override readonly name = "Local Config Corrupt Error"
}

/** An exercise or submission archive is over a size or entry limit. */
export class ArchiveTooLargeError extends BaseError {
  public override readonly name = "Archive Too Large Error"
}

/** The exercise cannot be worked on in the editor, only on the course page. */
export class UnsupportedExerciseError extends BaseError {
  public override readonly name = "Unsupported Exercise Error"
}

/** A program the exercise needs, such as Python or a JDK, was not found. */
export class ToolchainMissingError extends BaseError {
  public override readonly name = "Toolchain Missing Error"
}

/** A program built from the exercise was blocked or removed, typically by antivirus software. */
export class ExecutableBlockedError extends BaseError {
  public override readonly name = "Executable Blocked Error"
}

/** The exercises folder is missing, such as one on a drive that is not connected. */
export class ProjectsDirUnreachableError extends BaseError {
  public override readonly name = "Projects Dir Unreachable Error"
}

/**
 * Moving the exercises folder failed part way. `cause` is why; the message says where the
 * exercises are now, which can be either folder.
 */
export class ProjectsDirMoveError extends BaseError {
  public override readonly name = "Projects Dir Move Error"

  public constructor(
    public override readonly cause: Error,
    location: string,
  ) {
    super(location)
  }
}

/** The CLI could not be started; `code` is the errno name, such as ENOENT or EACCES. */
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

/** Opens the troubleshooting page for problems on the student's computer or network. */
export const TROUBLESHOOTING_COMMAND = "tmc.openTroubleshooting"

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
 * Not the logger's formatter, whose class name, `details` (a CLI backtrace and stderr tail),
 * `cause` chain and stack cannot be scrolled or copied in a notification. Show Details has them.
 */
function userSentence(error: Error): string {
  const trimmed = error.message.trim() || error.name
  // A leading identifier such as "tmc-langs-cli" keeps its case.
  const message = /^[a-z]+(\s|$)/.test(trimmed)
    ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    : trimmed
  return asSentence(message)
}

/** Whether `error` means the courses.mooc.fi session is gone, which only a new login fixes. */
export function isSessionLost(error: Error): boolean {
  return (
    error instanceof InvalidTokenError ||
    (error instanceof AuthorizationError && !(error instanceof TmcLoginNotAcceptedError))
  )
}

const REPORT_ISSUE_ACTION: ErrorAction = {
  label: "Report an Issue",
  command: "workbench.action.openIssueReporter",
}

const UPDATE_EXTENSION_ACTION: ErrorAction = {
  label: "Update Extension",
  command: "workbench.extensions.action.checkForUpdates",
}

const TROUBLESHOOTING_ACTION: ErrorAction = {
  label: "Troubleshooting",
  command: TROUBLESHOOTING_COMMAND,
}

const SHOW_HELP_ACTION: ErrorAction = {
  label: "Show Help",
  command: "tmc.viewInitializationErrorHelp",
}

function spawnFailurePresentation(error: SpawnError): ErrorPresentation {
  // A security policy refusing to run a file that is there can surface as UNKNOWN.
  const problem = error.code === "UNKNOWN" ? "denied" : fileProblemOf(error)
  switch (problem) {
    case "missing":
      return {
        message:
          "The TestMyCode tools are missing from this computer, perhaps removed by an antivirus program. Restart the extension to download them again.",
        actions: [
          { label: "Download Again", command: "workbench.action.restartExtensionHost" },
          SHOW_HELP_ACTION,
        ],
      }
    case "inUse":
      return {
        message:
          "Another program, such as an antivirus scan, is using the TestMyCode tools. Try again in a moment.",
        actions: [],
      }
    case "denied":
      return {
        message:
          "This computer would not run the TestMyCode tools; a security policy may be blocking " +
          "them. Ask your IT support to allow them.",
        actions: [SHOW_HELP_ACTION],
      }
    default:
      return {
        message: "The TestMyCode tools could not be started. Show Help says what to try.",
        actions: [SHOW_HELP_ACTION, REPORT_ISSUE_ACTION],
      }
  }
}

/** When to try again after a server's Retry-After, rounded up to whole minutes from two on. */
function retryWait(seconds: number | undefined): string {
  if (seconds === undefined) {
    return "in a few minutes"
  }
  return seconds < 120
    ? `in ${countOf(Math.max(1, Math.ceil(seconds)), "second")}`
    : `in ${Math.ceil(seconds / 60)} minutes`
}

/** " (<path>)" naming the file an error is about, or nothing. */
function inPath(error: BaseError): string {
  return error.path ? ` (${error.path})` : ""
}

/**
 * The sentences for tmc-langs error kinds whose CLI message is not written for the student.
 * Kinds missing here are worded by their error class in {@link presentationFor}.
 */
const LANGS_KIND_SENTENCES: Partial<Record<Kind, (error: BaseError) => string>> = {
  "deadline-passed": () =>
    "The deadline of this exercise has passed, so it can no longer be submitted.",
  "out-of-tries": () =>
    "You have no tries left on this exercise, so it can no longer be submitted.",
  "chapter-not-open-yet": () =>
    "This exercise's chapter has not opened yet. Try again once it opens.",
  "chapter-not-unlocked-yet": () =>
    "Complete the chapters before this exercise's chapter to submit it.",
  "chapter-completed-and-locked": () =>
    "This exercise's chapter is locked, so the exercise can no longer be submitted.",
  "exercise-locked": () =>
    "The teacher has locked this exercise, so it can no longer be submitted.",
  "rate-limited": (error) => {
    const wait = retryWait(error instanceof RateLimitedError ? error.retryAfterSeconds : undefined)
    return error instanceof RateLimitedError && error.isPasteLimit
      ? `You have used Get Help on this exercise too often. Try again ${wait}.`
      : `The server is receiving too many requests from your network. Try again ${wait}.`
  },
  "tmc-login-not-accepted": () =>
    "tmc.mooc.fi did not accept your MOOC.fi login. Ask the course staff to check that " +
    "your MOOC.fi account is linked to tmc.mooc.fi.",
  "tmc-login-unconfirmed": () =>
    "courses.mooc.fi could not confirm your login to tmc.mooc.fi just now. Try again in a few minutes.",
  "login-client-rejected": () =>
    "courses.mooc.fi did not accept this version of TestMyCode for logging in. Update the " +
    "extension; if it is up to date, report the problem.",
  "local-config-corrupt": (error) =>
    `A file TestMyCode keeps on this computer could not be read${inPath(error)}.`,
  "archive-too-large": () =>
    "The exercise is larger than allowed. Remove large files, such as data sets or " +
    "build output, from the exercise folder and try again.",
  "unsupported-exercise": () =>
    "This exercise cannot be done in VS Code. Do it on the course page.",
  "file-in-use": (error) =>
    `Another program is using a file TestMyCode needs${inPath(error)}. Close terminals, running ` +
    "programs and other editors using the exercise folder, then try again. Antivirus " +
    "or a sync app such as OneDrive can also hold files for a moment.",
  "permission-denied": (error) =>
    `TestMyCode was not allowed to use a file${inPath(error)}. Check that the exercise folder ` +
    "is not read-only or protected, then try again.",
  "path-too-long": (error) =>
    `A file path is too long for this computer${inPath(error)}. Move the exercises folder ` +
    "closer to the root of the drive, such as C:\\TMC.",
  "disk-full": (error) =>
    `The disk or your home folder quota is full${inPath(error)}. Free some space and try again.`,
  // The CLI's message names the missing program.
  "toolchain-missing": (error) =>
    `${userSentence(error)} If you installed it after starting VS Code, close every VS ` +
    "Code window and start VS Code again.",
  "executable-blocked": () =>
    "A program built from the exercise was blocked or removed, probably by antivirus " +
    "software. Allow the exercises folder in the antivirus program and try again.",
  "projects-dir-unreachable": (error) =>
    `The exercises folder${inPath(error)} cannot be reached. Connect the drive or network ` +
    "folder it is on, or move the exercises folder.",
}

/**
 * How to show `error` to the user.
 *
 * Remedies that follow from the error class live here, so a failure reads the same wherever
 * it surfaces. A class with no entry shows its message and no buttons. No message carries
 * diagnostics; see {@link userSentence}.
 */
export function presentationFor(error: Error): ErrorPresentation {
  const backend = error instanceof BaseError ? error.backend : undefined
  const kindSentence =
    error instanceof BaseError && error.langsKind
      ? LANGS_KIND_SENTENCES[error.langsKind]?.(error)
      : undefined
  const reported = kindSentence ?? userSentence(error)
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
    return { message: reported, actions: [] }
  }
  if (error instanceof LegacyTmcLoginEndedError) {
    return {
      message:
        "Your old tmc.mooc.fi login has ended. TestMyCode now uses your MOOC.fi login; try again.",
      actions: [],
    }
  }
  if (isSessionLost(error)) {
    return {
      message: LOGGED_OUT_MESSAGE,
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
    }
  }
  if (error instanceof InsufficientScopeError) {
    return {
      message: LOGGED_OUT_MESSAGE,
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
    }
  }
  if (error instanceof ForbiddenError && backend === "mooc") {
    return {
      message:
        "You do not have access to this on courses.mooc.fi. The course may be closed or not " +
        "published yet, or your enrollment may have ended.",
      actions: [],
    }
  }
  if (error instanceof LoginClientRejectedError) {
    return {
      message: reported,
      actions: [UPDATE_EXTENSION_ACTION],
    }
  }
  if (error instanceof ProjectsDirUnreachableError) {
    return {
      message: reported,
      actions: [{ label: "Move Exercises Folder", command: "tmc.changeTmcDataPath" }],
    }
  }
  if (
    error instanceof ToolchainMissingError ||
    error instanceof ExecutableBlockedError ||
    error instanceof FileAccessError
  ) {
    return {
      message: reported,
      actions: [TROUBLESHOOTING_ACTION],
    }
  }
  if (error instanceof NotEnrolledError) {
    return {
      message: "You are no longer enrolled on this course. Enroll again, then refresh the course.",
      actions: [{ label: "Enroll Again", command: ENROLL_ON_COURSE_COMMAND }],
    }
  }
  if (error instanceof UploadExpiredError) {
    // tmc-langs uploads and submits within one invocation and has already retried the
    // upload itself, so submitting afresh is the only step left to suggest.
    return {
      message: "The submission expired before the server accepted it. Submit again.",
      actions: [],
    }
  }
  if (error instanceof ExerciseNotFoundError) {
    return {
      message:
        "This exercise is no longer in the course. Refresh the courses to see its exercises.",
      actions: [{ label: "Refresh Courses", command: "tmcTreeView.refreshCourses" }],
    }
  }
  if (error instanceof ProjectsDirMoveError) {
    const why = presentationFor(error.cause)
    // A FileAccessError already names its own remedy.
    const advice =
      error.cause instanceof FileAccessError
        ? ""
        : " Close terminals and programs that use the exercises, then try again."
    return { message: `${why.message}${advice} ${reported}`, actions: why.actions }
  }
  if (error instanceof SpawnError) {
    return spawnFailurePresentation(error)
  }
  if (error instanceof EmptyLangsResponseError) {
    const how = error.signal
      ? `was killed by ${error.signal}`
      : `exited with code ${error.exitCode ?? "unknown"}`
    return {
      message: `The TestMyCode tools stopped unexpectedly (they ${how}). Report an Issue if this keeps happening.`,
      actions: [REPORT_ISSUE_ACTION],
    }
  }
  if (error instanceof CliCrashedError) {
    return {
      message:
        "The TestMyCode tools stopped unexpectedly. Report an Issue and attach the details from Show Details.",
      actions: [REPORT_ISSUE_ACTION],
    }
  }
  if (error instanceof InitializationError) {
    return {
      message: "TestMyCode could not start. Show Help says how to fix this.",
      actions: [SHOW_HELP_ACTION],
    }
  }
  if (error instanceof ObsoleteClientError) {
    return {
      message: "This version of TestMyCode is out of date. Update the extension.",
      actions: [UPDATE_EXTENSION_ACTION],
    }
  }
  if (error instanceof ConnectionTimeoutError && backend !== undefined) {
    return {
      message:
        "The server did not answer in time. It may be busy or the connection slow; try again in a moment.",
      actions: [],
    }
  }
  if (error instanceof CertificateError) {
    return {
      message:
        "The server's certificate was not trusted. Check that this computer's date and time " +
        "are right; a network security product that inspects connections can also cause this.",
      actions: [TROUBLESHOOTING_ACTION],
    }
  }
  if (error instanceof ProxyError) {
    return {
      message:
        "A proxy refused the connection. Check the proxy settings of this computer or VS Code.",
      actions: [TROUBLESHOOTING_ACTION],
    }
  }
  if (error instanceof ConnectionError && backend !== undefined) {
    return {
      message: "Could not reach the server. Check your network connection.",
      actions: [],
    }
  }
  if (error instanceof UnexpectedResponseError) {
    return {
      message:
        "The server's answer could not be read. If your network first shows a web page to " +
        "accept, as on hotel or campus Wi-Fi, open any page in a browser, accept it and try again.",
      actions: [],
    }
  }
  if (error instanceof InvalidRequestError) {
    return {
      message:
        "The server refused the request. Update the extension; if it is up to date, report the problem.",
      actions: [UPDATE_EXTENSION_ACTION],
    }
  }
  if (
    (error instanceof NotFoundError ||
      error instanceof ServerError ||
      error instanceof RuntimeError) &&
    error.httpStatus !== undefined
  ) {
    // The reported message quotes the raw response body, and the status is in Show Details.
    const message =
      error.httpStatus >= 500
        ? "The server ran into a problem. Try again later."
        : "The server refused the request. Try again later."
    return { message, actions: [] }
  }
  return { message: reported, actions: [] }
}

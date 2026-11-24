import type { Kind } from "../../shared/langsSchema"
import type { BackendKind, BaseError } from "../../shared/lib"
import {
  ArchiveTooLargeError,
  AuthorizationError,
  CertificateError,
  ChapterLockedError,
  ChapterNotOpenError,
  ConnectionError,
  ConnectionTimeoutError,
  DeadlinePassedError,
  DeviceLoginDeniedError,
  DeviceLoginExpiredError,
  ExecutableBlockedError,
  ExerciseLockedError,
  ExerciseNotFoundError,
  FileAccessError,
  ForbiddenError,
  InsufficientScopeError,
  InvalidRequestError,
  InvalidTokenError,
  LegacyTmcLoginEndedError,
  LocalConfigCorruptError,
  LoginClientRejectedError,
  NotEnrolledError,
  NotFoundError,
  ObsoleteClientError,
  OutOfTriesError,
  ProjectsDirMoveRefusedError,
  ProjectsDirUnreachableError,
  ProxyError,
  RateLimitedError,
  RuntimeError,
  ServerError,
  TmcLoginNotAcceptedError,
  TmcLoginUnconfirmedError,
  ToolchainMissingError,
  UnexpectedResponseError,
  UnknownUploadError,
  UnsupportedExerciseError,
  UploadExpiredError,
} from "../errors"

type LangsErrorClass = new (message: string, details?: string) => BaseError

const ERROR_CLASS_OF_KIND: Record<Kind, LangsErrorClass> = {
  generic: RuntimeError,
  forbidden: ForbiddenError,
  "not-logged-in": AuthorizationError,
  "connection-error": ConnectionError,
  "connection-timeout": ConnectionTimeoutError,
  "certificate-error": CertificateError,
  "proxy-error": ProxyError,
  "obsolete-client": ObsoleteClientError,
  "invalid-token": InvalidTokenError,
  "not-enrolled": NotEnrolledError,
  "upload-expired": UploadExpiredError,
  "unknown-upload": UnknownUploadError,
  "not-found": NotFoundError,
  "server-error": ServerError,
  "insufficient-scope": InsufficientScopeError,
  "exercise-not-found": ExerciseNotFoundError,
  "rate-limited": RateLimitedError,
  "deadline-passed": DeadlinePassedError,
  "out-of-tries": OutOfTriesError,
  "chapter-not-open-yet": ChapterNotOpenError,
  "chapter-not-unlocked-yet": ChapterLockedError,
  "chapter-completed-and-locked": ChapterLockedError,
  "exercise-locked": ExerciseLockedError,
  "invalid-request": InvalidRequestError,
  "unexpected-response": UnexpectedResponseError,
  "login-client-rejected": LoginClientRejectedError,
  "tmc-login-not-accepted": TmcLoginNotAcceptedError,
  "tmc-login-unconfirmed": TmcLoginUnconfirmedError,
  "device-login-denied": DeviceLoginDeniedError,
  "device-login-expired": DeviceLoginExpiredError,
  "local-config-corrupt": LocalConfigCorruptError,
  "archive-too-large": ArchiveTooLargeError,
  "unsupported-exercise": UnsupportedExerciseError,
  "file-in-use": FileAccessError,
  "permission-denied": FileAccessError,
  "path-too-long": FileAccessError,
  "disk-full": FileAccessError,
  "toolchain-missing": ToolchainMissingError,
  "executable-blocked": ExecutableBlockedError,
  "projects-dir-unreachable": ProjectsDirUnreachableError,
  "projects-dir-move-to-itself": ProjectsDirMoveRefusedError,
  "projects-dir-move-into-itself": ProjectsDirMoveRefusedError,
}

/** What the CLI reported about a failure, beside its message. */
export interface LangsFailure {
  kind: Kind
  /** The file the failure is about. */
  path?: string | undefined
  /** The error status a backend answered with. */
  httpStatus?: number | undefined
  /** How long the server asked to wait before trying again. */
  retryAfterSeconds?: number | undefined
}

/**
 * The error a CLI failure of `failure.kind` is raised as. Its message is the CLI's own;
 * `presentationFor` words it for the student by its `langsKind`.
 *
 * @param backend The backend the failed command talked to: a refused token on tmc.mooc.fi is
 * an old tmc.mooc.fi login ending, not the courses.mooc.fi session.
 */
export function langsError(
  failure: LangsFailure,
  message: string,
  details: string,
  backend: BackendKind | undefined,
): BaseError {
  const { kind, path, httpStatus, retryAfterSeconds } = failure
  const ErrorClass =
    kind === "invalid-token" && backend === "tmc"
      ? LegacyTmcLoginEndedError
      : ERROR_CLASS_OF_KIND[kind]
  const error = new ErrorClass(message, details)
  error.langsKind = kind
  return Object.assign(
    error,
    path === undefined ? {} : { path },
    httpStatus === undefined ? {} : { httpStatus },
    retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
  )
}

import * as cp from "child_process"

import kill from "tree-kill"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { z } from "zod"

import {
  API_CACHE_LIFETIME,
  CLI_PROCESS_TIMEOUT,
  MINIMUM_SUBMISSION_INTERVAL,
  MOOC_BACKEND_URL,
  SUBMIT_PROCESS_TIMEOUT,
  TMC_BACKEND_URL,
} from "../config/constants"
import type { InitializationError } from "../errors"
import {
  AuthorizationError,
  BottleneckError,
  ConnectionError,
  EmptyLangsResponseError,
  ForbiddenError,
  InvalidTokenError,
  LangsResponseSchemaError,
  NotEnrolledError,
  ObsoleteClientError,
  RuntimeError,
  SpawnError,
  TimeoutError,
  UnknownUploadError,
  UploadExpiredError,
} from "../errors"
import type {
  CombinedCourseData,
  Course,
  CourseData,
  CourseDetails,
  CourseExercise,
  CourseInstance,
  DataKind,
  DownloadOrUpdateMoocCourseExercisesResult,
  DownloadOrUpdateTmcCourseExercisesResult,
  ExerciseDetails,
  ExerciseTaskSubmissionStatus,
  LocalExercise,
  LocalMoocExercise,
  LocalTmcExercise,
  MoocCourseProgress,
  MoocDeviceLogin,
  MoocOldSubmissionRestore,
  ExerciseSlideSubmissionListItem,
  Notification,
  Organization,
  OutputData,
  RunResult,
  StatusUpdateData,
  StyleValidationResult,
  Submission,
  SubmissionFeedbackResponse,
  SubmissionFinished,
  TmcExerciseSlide,
} from "../shared/langsSchema"
import { CliNotification, CliOutputData, CliStatusUpdate } from "../shared/langsSchema"
import type { ExerciseIdentifier } from "../shared/shared"
import {
  assertUnreachable,
  BaseError,
  CourseIdentifier,
  makeMoocKind,
  makeTmcKind,
  match,
} from "../shared/shared"
import { Logger, LogLevel } from "../utilities/logger"
import type { SubmissionFeedback } from "./types"

interface Options {
  apiCacheLifetime?: string | undefined
  cliConfigDir?: string | undefined
  timeout?: number | undefined
}

interface ExecutionOptions {
  timeout: number
}

interface LangsProcessArgs {
  args: string[]
  /**
   * Threaded explicitly rather than sniffed from `args[0]`, so an
   * auth-flavored error can be attributed to the right backend. `undefined`
   * for backend-agnostic commands (local ops, settings).
   */
  backend?: "tmc" | "mooc" | undefined
  env?: Record<string, string> | undefined
  /** Which args should be obfuscated in logs. */
  obfuscate?: number[] | undefined
  onStdout?: ((data: StatusUpdateData) => void) | undefined
  /**
   * Surfaces a CLI notification to the user. Set only for commands the user is watching,
   * so a background poll cannot toast.
   */
  onNotification?: ((notification: Notification) => void) | undefined
  stdin?: string | undefined
  processTimeout?: number | undefined
  /** Set on login/logout commands, where an auth-flavored error is expected rather than a lost session. */
  suppressAuthEvents?: boolean | undefined
  onInterruptHandle?: ((interrupt: () => void) => void) | undefined
  /**
   * Registers the process with {@link Langs.killAllProcesses}. Only set for commands with no
   * partial-write failure mode (network-only submit/paste, local test runs) -- a killed
   * download or settings write can corrupt state.
   */
  interruptOnDeactivate?: boolean | undefined
}

/** How an auth failure in a CLI response is attributed. */
interface AuthAttribution {
  /**
   * The backend the command talked to. Only its cached responses are dropped when it
   * rejects our credentials, and it names the site in a not-enrolled message.
   */
  backend?: "tmc" | "mooc" | undefined
  /** Set on login/logout commands, where an auth error means no session was lost. */
  expected?: boolean | undefined
}

interface LangsProcessRunner {
  interrupt: () => void
  result: Promise<Result<OutputData, BaseError>>
  /** Raw stderr collected so far; complete once `result` has settled. */
  getStderr: () => string
}

interface ResponseCacheEntry {
  response: OutputData
  timestamp: number
}

interface CacheOptions {
  forceRefresh?: boolean | undefined
}

interface CacheConfig {
  forceRefresh?: boolean | undefined
  key: string
  /** Optional remapper for assigning parts of the result to different keys. */
  remapper?: ((response: OutputData) => [string, OutputData][]) | undefined
}

/**
 * Builds a response-cache key.
 *
 * Every key starts with the backend, because tmc.mooc.fi and courses.mooc.fi share an id
 * space here — both arrive as strings — and because {@link Langs} drops one backend's
 * entries without touching the other's by matching that prefix.
 *
 * @param resource What the entry holds, e.g. `course-details`. One resource name per CLI
 * output-data kind, so two commands returning the same thing share an entry.
 * @param parts The ids the entry is keyed by, in the order the resource names them.
 */
function cacheKey(
  backend: "tmc" | "mooc",
  resource: string,
  ...parts: (string | number)[]
): string {
  return [backend, resource, ...parts].join(":")
}

/** Bounds the cache so a long session that visits many courses cannot grow it without limit. */
const MAX_CACHED_RESPONSES = 128

/** Long enough for every flag and id the CLI takes; only a settings value exceeds it. */
const MAX_LOGGED_ARG_LENGTH = 120

/**
 * Replaces an oversized argument with its length, so the output channel users paste into
 * bug reports stays readable when a whole settings value goes through argv.
 */
function loggableArg(arg: string): string {
  return arg.length > MAX_LOGGED_ARG_LENGTH ? `<${arg.length} characters>` : arg
}

const organizationsRemapper: CacheConfig["remapper"] = (res) => {
  if (res.data?.["output-data-kind"] === "organizations") {
    return res.data["output-data"].map((x) => [
      cacheKey("tmc", "organization", x.slug),
      { ...res, data: { "output-data-kind": "organization", "output-data": x } },
    ])
  }
  return []
}

/** Ample for the failure diagnostics stderr feeds; a test run can write orders of magnitude more. */
const MAX_RETAINED_STDERR_BYTES = 64 * 1024

/** POSIX has process groups, so a child spawned `detached` can be signalled as a whole tree. */
const HAS_PROCESS_GROUPS = process.platform !== "win32"

/**
 * Kills the CLI process and everything it spawned, doing nothing if it never started.
 *
 * On POSIX the child leads its own process group (see the `detached` spawn option), so one
 * synchronous signal reaches the whole tree and has taken effect before this returns --
 * which is what lets a synchronous `deactivate` stop a submit in flight. Windows has no
 * process groups, so `tree-kill` walks the tree asynchronously there instead.
 */
function killProcessTree(cprocess: cp.ChildProcess): void {
  const pid = cprocess.pid
  // Undefined until the spawn succeeds, and `tree-kill` throws on a non-numeric pid.
  if (pid === undefined) {
    return
  }
  if (!HAS_PROCESS_GROUPS) {
    kill(pid)
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    // ESRCH: the group is already gone, which is the outcome asked for.
  }
}

/**
 * The tail of a CLI process's stderr, kept for the error details a failure attaches.
 *
 * A long-running `run-tests` can write more stderr than the extension host should hold, so
 * older output is dropped once {@link MAX_RETAINED_STDERR_BYTES} is exceeded and `text()`
 * says how much went. The newest output is the part that explains a failure, so the tail is
 * what survives; the most recent chunk is always kept whole.
 */
class BoundedStderr {
  private readonly _chunks: string[] = []
  private _retainedBytes = 0
  private _droppedBytes = 0
  private _text: string | undefined

  public push(chunk: string): void {
    this._chunks.push(chunk)
    this._retainedBytes += Buffer.byteLength(chunk)
    while (this._retainedBytes > MAX_RETAINED_STDERR_BYTES && this._chunks.length > 1) {
      const droppedBytes = Buffer.byteLength(this._chunks.shift() as string)
      this._retainedBytes -= droppedBytes
      this._droppedBytes += droppedBytes
    }
    this._text = undefined
  }

  public text(): string {
    if (this._text === undefined) {
      const tail = this._chunks.join("\n")
      this._text =
        this._droppedBytes === 0
          ? tail
          : `[…${this._droppedBytes} bytes of earlier stderr dropped…]\n${tail}`
    }
    return this._text
  }
}

/**
 * A Class that provides an interface to all langs functionality.
 */
export default class Langs {
  // Per-backend: tmc.mooc.fi and courses.mooc.fi are unrelated servers, so one must not throttle the other.
  private _nextTmcSubmissionAllowedTimestamp: number
  private _nextMoocSubmissionAllowedTimestamp: number
  private readonly _options: Options
  private readonly _responseCache: Map<string, ResponseCacheEntry>
  private _onLogout?: (expected: boolean) => void
  private _onMoocLogin?: () => void
  private _onMoocLogout?: (expected: boolean) => void
  private _onNotification?: (notification: Notification) => void
  /** Messages already surfaced; the CLI repeats a plugin's warning on every run. */
  private readonly _shownNotifications = new Set<string>()

  private readonly _activeInterrupts = new Set<() => void>()

  /**
   * Creates a new instance of the langs interface class.
   */
  public constructor(
    private readonly cliPath: string,
    private readonly clientName: string,
    private readonly clientVersion: string,
    options?: Options,
  ) {
    this._nextTmcSubmissionAllowedTimestamp = 0
    this._nextMoocSubmissionAllowedTimestamp = 0
    this._options = { ...options }
    this._responseCache = new Map()
  }

  /**
   * Kills every CLI process opted in via `interruptOnDeactivate` (submit, paste and local
   * test runs); downloads, extraction, and settings/credentials writes are left running so a
   * window reload can't leave them half-written.
   *
   * Safe to call from a synchronous `deactivate`: each kill is a single syscall that has
   * taken effect by the time it returns.
   */
  public killAllProcesses(): void {
    const interrupts = Array.from(this._activeInterrupts)
    Logger.info(`Killing ${interrupts.length} active CLI process(es)`)
    for (const interrupt of interrupts) {
      interrupt()
    }
  }

  /**
   * Sets the callback to an event. Will overwrite previous callback for the specified event.
   *
   * `expected` is true for a deliberate logout, false when the backend rejected the credentials mid-session.
   *
   * @param event Event to subscribe to.
   * @param callback Eventhandler to invoke on event.
   */
  public on(event: "mooc-login", callback: () => void): void
  public on(event: "logout" | "mooc-logout", callback: (expected: boolean) => void): void
  public on(event: "notification", callback: (notification: Notification) => void): void
  public on(
    event: "logout" | "mooc-login" | "mooc-logout" | "notification",
    callback: (() => void) | ((expected: boolean) => void) | ((notification: Notification) => void),
  ): void {
    switch (event) {
      case "logout":
        this._onLogout = callback as (expected: boolean) => void
        break
      case "mooc-login":
        this._onMoocLogin = callback as () => void
        break
      case "mooc-logout":
        this._onMoocLogout = callback as (expected: boolean) => void
        break
      case "notification":
        this._onNotification = callback as (notification: Notification) => void
        break
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Authentication commands
  // ---------------------------------------------------------------------------------------------

  /**
   * Whether the tmc backend can be authenticated, via `tmc logged-in`: either a
   * stored tmc token or a usable courses.mooc.fi access token counts.
   */
  public async isAuthenticated(options?: ExecutionOptions): Promise<Result<boolean, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("logged-in"),
        processTimeout: options?.timeout,
      },
      null,
    )
    return res.andThen<boolean, Error>((x) => {
      switch (x.result) {
        case "logged-in":
          return Ok(true)
        case "not-logged-in":
          return Ok(false)
        default:
          return Err(new Error(`Unexpected langs result: ${x.result}`))
      }
    })
  }

  /**
   * Removes the stored tmc token (`tmc logout`). The courses.mooc.fi credentials
   * are untouched, so the user can still be authenticated afterwards.
   */
  public async deauthenticate(): Promise<Result<void, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("logout"),
        suppressAuthEvents: true,
      },
      null,
    )
    return res.andThen(() => {
      this._clearBackendCache("tmc")
      this._onLogout?.(true)
      return Ok.EMPTY
    })
  }

  /**
   * Logs in via OAuth2 device authorization (RFC 8628) using `mooc login`.
   * The CLI emits a `mooc-device-login` update with the verification
   * URL/user code before blocking on approval, surfaced via `onDeviceCode`;
   * it rejects on deny/expiry (`not-logged-in`). No `processTimeout`: the
   * user may take minutes to approve in the browser. `interrupt` kills the
   * process; nothing is persisted until login succeeds.
   *
   * @param onDeviceCode Called with the verification URL/user code once the
   * CLI emits it.
   */
  public authenticateMooc(onDeviceCode: (info: MoocDeviceLogin) => void): {
    result: Promise<Result<void, BaseError | InitializationError>>
    interrupt: () => void
  } {
    const onStdout = (res: StatusUpdateData): void => {
      if (res["update-data-kind"] === "mooc-device-login" && res.data) {
        onDeviceCode(res.data)
      }
    }
    const process = this._spawnLangsProcess({
      backend: "mooc",
      args: this._moocCmd("login"),
      onStdout,
    })
    if (process.err) {
      return { result: Promise.resolve(process), interrupt: (): void => {} }
    }
    const { interrupt, result, getStderr } = process.val
    const loginResult = result.then((res) =>
      res
        .andThen((x) =>
          this._checkLangsResponse(x, null, { backend: "mooc", expected: true }, getStderr()),
        )
        .map(() => {
          this._onMoocLogin?.()
          return undefined
        }),
    )
    return { result: loginResult, interrupt }
  }

  /** Mirrors `isAuthenticated` for the mooc backend (`mooc logged-in`). */
  public async isMoocAuthenticated(options?: ExecutionOptions): Promise<Result<boolean, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "mooc",
        args: this._moocCmd("logged-in"),
        processTimeout: options?.timeout,
      },
      null,
    )
    return res.andThen<boolean, Error>((x) => {
      switch (x.result) {
        case "logged-in":
          return Ok(true)
        case "not-logged-in":
          return Ok(false)
        default:
          return Err(new Error(`Unexpected langs result: ${x.result}`))
      }
    })
  }

  /** Mirrors `deauthenticate` for the mooc backend (`mooc logout`); fires `mooc-logout` with `expected: true`. */
  public async deauthenticateMooc(): Promise<Result<void, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "mooc",
        args: this._moocCmd("logout"),
        suppressAuthEvents: true,
      },
      null,
    )
    return res.andThen(() => {
      this._clearBackendCache("mooc")
      this._onMoocLogout?.(true)
      return Ok.EMPTY
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Non-core commands
  // ---------------------------------------------------------------------------------------------

  /**
   * Clears given exercise from extra files such as build files. Uses TMC-langs `clean` command
   * internally.
   *
   * @param id ID of the exercise to clean.
   */
  public async clean(exercisePath: string): Promise<Result<void, Error>> {
    const res = await this._executeLangsCommand(
      { args: ["clean", "--exercise-path", exercisePath] },
      null,
    )
    return res.err ? res : Ok.EMPTY
  }

  /**
   * Lists every exercise in the projects directory, from both backends, in one call.
   *
   * Each entry is tagged with the backend it came from and carries the ids needed to
   * place it — an exercise id on both arms, and a course id on the mooc arm (TMC course
   * configs store no course id). Prefer {@link listLocalCourseExercises} when only one
   * course's exercises are wanted.
   */
  public async listLocalExercises(): Promise<Result<LocalExercise[], Error>> {
    const res = await this._executeLangsCommand(
      { args: ["list-local-exercises", "--client-name", this.clientName] },
      "local-exercises",
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Lists local exercises for a given course. Dispatches on the backend: a core
   * `list-local-tmc-course-exercises` keyed by course slug for TMC, or
   * `mooc list-local-course-exercises` keyed by course id (mooc configs store
   * no slug). Both return entries
   * with an `exercise-slug` and an `exercise-path`, the fields the workspace manager
   * needs.
   *
   * @param courseKind Which backend the course belongs to.
   * @param courseIdentifier Course slug for TMC, course id (UUID) for mooc.
   */
  public async listLocalCourseExercises(
    courseKind: "tmc" | "mooc",
    courseIdentifier: string,
  ): Promise<Result<(LocalTmcExercise | LocalMoocExercise)[], Error>> {
    if (courseKind === "mooc") {
      const res = await this._executeLangsCommand(
        {
          backend: "mooc",
          args: this._moocCmd("list-local-course-exercises", "--course-id", courseIdentifier),
        },
        "local-mooc-exercises",
      )
      return res.map((x) => x.data["output-data"])
    }
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: [
          "list-local-tmc-course-exercises",
          "--client-name",
          this.clientName,
          "--course-slug",
          courseIdentifier,
        ],
      },
      "local-tmc-exercises",
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Runs local tests for given exercise. Uses TMC-langs `run-tests` command internally.
   *
   * @param exercisePath Path to the exercise to test.
   * @param pythonExecutablePath Optional path to Python executable to use instead of the one
   * detected in PATH.
   */
  public runTests(
    exercisePath: string,
    pythonExecutablePath?: string,
  ): {
    process: Promise<Result<RunResult, BaseError | InitializationError>>
    interrupt: () => void
  } {
    const env: Record<string, string> = {}
    if (pythonExecutablePath) {
      env.TMC_LANGS_PYTHON_EXEC = pythonExecutablePath
    }
    const process = this._spawnLangsProcess({
      args: ["run-tests", "--exercise-path", exercisePath],
      env,
      onNotification: (notification) => this._showNotification(notification),
      processTimeout: CLI_PROCESS_TIMEOUT,
      interruptOnDeactivate: true,
    })
    if (process.err) {
      return { process: Promise.resolve(process), interrupt: (): void => {} }
    }
    const { interrupt, result, getStderr } = process.val
    const postResult = result.then((res) =>
      res
        .andThen((x) => this._checkLangsResponse(x, "test-result", {}, getStderr()))
        .map((x) => x.data["output-data"]),
    )

    return { process: postResult, interrupt }
  }

  public runCheckstyle(exercisePath: string): {
    process: Promise<Result<StyleValidationResult | null, BaseError>>
    interrupt: () => void
  } {
    const process = this._spawnLangsProcess({
      args: ["checkstyle", "--locale", "en", "--exercise-path", exercisePath],
      onNotification: (notification) => this._showNotification(notification),
      processTimeout: CLI_PROCESS_TIMEOUT,
      interruptOnDeactivate: true,
    })
    if (process.err) {
      return { process: Promise.resolve(process), interrupt: (): void => {} }
    }
    const { interrupt, result, getStderr } = process.val
    const checkstyleResult = result.then((res) =>
      res
        .andThen((x) => this._checkLangsResponse(x, "validation", {}, getStderr()))
        .map((x) => x.data["output-data"]),
    )
    return { process: checkstyleResult, interrupt }
  }

  // ---------------------------------------------------------------------------------------------
  // Settings commands
  // ---------------------------------------------------------------------------------------------

  /**
   * Migrates exercise under TMC-langs's management. The new location will be determined by
   * langs's `projects-dir` setting.
   */
  public async migrateExercise(
    courseSlug: string,
    exerciseChecksum: string,
    exerciseId: number,
    exercisePath: string,
    exerciseSlug: string,
  ): Promise<Result<void, Error>> {
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd(
          "migrate",
          "--exercise-path",
          exercisePath,
          "--course-slug",
          courseSlug,
          "--exercise-id",
          `${exerciseId}`,
          "--exercise-slug",
          exerciseSlug,
          "--exercise-checksum",
          exerciseChecksum,
        ),
      },
      null,
    )
    return res.err ? res : Ok.EMPTY
  }

  /**
   * Moves this instance's projects directory on disk. Uses TMC-langs `settings move-projects-dir`
   * setting internally.
   *
   * @param newDirectory New location for projects directory.
   * @param onUpdate Progress callback.
   */
  public async moveProjectsDirectory(
    newDirectory: string,
    onUpdate?: (value: { percent: number; message?: string }) => void,
  ): Promise<Result<void, Error>> {
    const onStdout = (res: StatusUpdateData): void => {
      onUpdate?.({
        percent: res["percent-done"],
        message: res.message ?? undefined,
      })
    }
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd("move-projects-dir", newDirectory),
        onStdout,
      },
      null,
    )
    return res.err ? res : Ok.EMPTY
  }

  /**
   * Gets the value for given key and asserts it's type. Uses TMC-langs `settings get` command
   * internally.
   */
  public async getSetting<T>(
    key: string,
    checker: (object: unknown) => object is T,
  ): Promise<Result<T | undefined, Error>> {
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd("get", key),
      },
      "config-value",
    )
    return res.andThen<T | undefined, Error>((x) => {
      const data = x.data?.["output-data"]
      if (data === undefined || data === null) {
        return Ok(undefined)
      }
      return checker(data) ? Ok(data) : Err(new Error("Invalid object type."))
    })
  }

  /**
   * Sets a value for given key in stored settings. Uses TMC-langs `settings set` command
   * internally.
   */
  public async setSetting(key: string, value: unknown): Promise<Result<void, Error>> {
    // Base64 rather than raw JSON: the value goes through argv, where quoting rules differ
    // per platform and a course's closed-exercise list is long enough to matter.
    const encoded = Buffer.from(JSON.stringify(value)).toString("base64")
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd("set", key, encoded, "--base64"),
      },
      null,
    )
    return res.err ? res : Ok.EMPTY
  }

  /**
   * Resets all settings back to initial values. Uses TMC-langs `settings reset` command
   * internally.
   */
  public async resetSettings(): Promise<Result<void, Error>> {
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd("reset"),
      },
      null,
    )
    return res.err ? res : Ok.EMPTY
  }

  /**
   * Unsets the value of given key in stored settings. Uses TMC-langs `settings unset` command
   * internally.
   */
  public async unsetSetting(key: string): Promise<Result<void, Error>> {
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd("unset", key),
      },
      null,
    )
    return res.err ? res : Ok.EMPTY
  }

  // ---------------------------------------------------------------------------------------------
  // Core commands
  // ---------------------------------------------------------------------------------------------

  /**
   * Lists the locally downloaded exercises of `backend` that have a newer version on the server.
   *
   * The result is cached per backend; `forceRefresh` bypasses that cache. A caller
   * wanting both backends calls this twice, so one server being unreachable does not
   * discard the other's answer.
   */
  public async checkExerciseUpdates(
    backend: "tmc" | "mooc",
    options?: CacheOptions,
  ): Promise<Result<ExerciseIdentifier[], Error>> {
    const cacheConfig = {
      forceRefresh: options?.forceRefresh,
      key: cacheKey(backend, "exercise-updates"),
    }
    if (backend === "mooc") {
      const res = await this._executeLangsCommand(
        { backend, args: this._moocCmd("check-exercise-updates") },
        "mooc-updated-exercises",
        cacheConfig,
      )
      return res.map((x) =>
        x.data["output-data"].map((exercise) => makeMoocKind({ moocExerciseId: exercise.id })),
      )
    }
    const res = await this._executeLangsCommand(
      { backend, args: this._tmcCmd("check-exercise-updates") },
      "updated-exercises",
      cacheConfig,
    )
    return res.map((x) =>
      x.data["output-data"].map((exercise) => makeTmcKind({ tmcExerciseId: exercise.id })),
    )
  }

  /**
   * Downloads multiple exercises to TMC-langs' configured project directory. Uses TMC-langs
   * `download-or-update-course-exercises` core command internally.
   *
   * tmc and mooc are independent servers: each leg runs regardless of the
   * other's outcome, with failures reported via `tmcError`/`moocError`
   * instead of aborting the unaffected leg.
   *
   * @param ids Ids of the exercises to download.
   * @param downloadTemplate Flag for downloading exercise template instead of latest submission.
   */
  public async downloadExercises(
    ids: ExerciseIdentifier[],
    downloadTemplate: boolean,
    onDownloaded: (value: { id: ExerciseIdentifier; percent: number; message?: string }) => void,
    moocCourseId?: string,
    onInterruptHandle?: (interrupt: () => void) => void,
  ): Promise<{
    tmc: DownloadOrUpdateTmcCourseExercisesResult
    mooc: DownloadOrUpdateMoocCourseExercisesResult
    tmcError?: Error | undefined
    moocError?: Error | undefined
  }> {
    const onStdout = (res: StatusUpdateData): void => {
      if (
        res["update-data-kind"] === "client-update-data" &&
        res.data?.["client-update-data-kind"] === "exercise-download"
      ) {
        onDownloaded({
          id: makeTmcKind({ tmcExerciseId: res.data.id }),
          percent: res["percent-done"],
          message: res.message ?? undefined,
        })
      } else if (
        // Mooc reports progress under its own status-update kind; mirror the tmc branch above.
        res["update-data-kind"] === "mooc-client-update-data" &&
        res.data?.["client-update-data-kind"] === "exercise-download"
      ) {
        onDownloaded({
          id: makeMoocKind({ moocExerciseId: res.data.id }),
          percent: res["percent-done"],
          message: res.message ?? undefined,
        })
      }
    }
    const downloadTemplateArg = downloadTemplate ? ["--download-template"] : []
    const tmcIds = ids
      .map((id) =>
        match(
          id,
          (tmc) => tmc.tmcExerciseId,
          () => null,
        ),
      )
      .filter((id) => id !== null)
    const moocIds = ids
      .map((id) =>
        match(
          id,
          () => null,
          (mooc) => mooc.moocExerciseId,
        ),
      )
      .filter((id) => id !== null)

    let tmcOutputData: DownloadOrUpdateTmcCourseExercisesResult | null = null
    let tmcError: Error | undefined
    if (tmcIds.length > 0) {
      const tmcRes = await this._executeLangsCommand(
        {
          backend: "tmc",
          args: this._tmcCmd(
            "download-or-update-course-exercises",
            ...downloadTemplateArg,
            "--exercise-id",
            ...tmcIds.map((id) => id.toString()),
          ),
          onStdout,
          onInterruptHandle,
        },
        "tmc-exercise-download",
      )
      const tmcMappedRes = tmcRes.andThen((x) => {
        this._responseCache.delete(cacheKey("tmc", "exercise-updates"))
        return Ok(x.data["output-data"])
      })
      if (tmcMappedRes.err) {
        // Don't abort — the mooc leg is independent and still runs; report via `tmcError`.
        Logger.error("Failed to download/update tmc exercises.", tmcMappedRes.val)
        tmcError = tmcMappedRes.val
      } else {
        tmcOutputData = tmcMappedRes.val
      }
    }

    let moocOutputData: DownloadOrUpdateMoocCourseExercisesResult | null = null
    let moocError: Error | undefined
    if (moocIds.length > 0) {
      const moocRes = await this._executeLangsCommand(
        {
          // NB: no --download-template here. The mooc bulk-download subcommand
          // has no template concept and rejects the flag (clap error); it is
          // tmc-only. See the mooc MoocCommand::DownloadOrUpdateCourseExercises
          // definition in tmc-langs-cli.
          //
          // --course-id, when known, lets the CLI fetch just that course's
          // slides instead of scanning every enrolled course to locate each
          // exercise.
          backend: "mooc",
          args: this._moocCmd(
            "download-or-update-course-exercises",
            ...(moocCourseId ? ["--course-id", moocCourseId] : []),
            "--exercise-id",
            ...moocIds,
          ),
          onStdout,
          onInterruptHandle,
        },
        "mooc-exercise-download",
      )
      const moocMappedRes = moocRes.andThen((x) => {
        this._responseCache.delete(cacheKey("mooc", "exercise-updates"))
        return Ok(x.data["output-data"])
      })
      if (moocMappedRes.err) {
        // Mirrors the tmc leg: don't discard tmc's already-collected results.
        Logger.error("Failed to download/update mooc exercises.", moocMappedRes.val)
        moocError = moocMappedRes.val
      } else {
        moocOutputData = moocMappedRes.val
      }
    }

    const tmcExercises = tmcOutputData ?? { downloaded: [], skipped: [], failed: [] }
    const moocExercises = moocOutputData ?? { downloaded: [], skipped: [], failed: [] }
    return { tmc: tmcExercises, mooc: moocExercises, tmcError, moocError }
  }

  /**
   * Downloads user's old submission for a given exercise. Optionally submits the current state
   * of the exercise beforehand. Uses TMC-langs `download-old-submission` core command internally.
   *
   * @param exerciseId  Id of the exercise.
   * @param exercisePath Filepath where the old submission should be downloaded to.
   * @param submissionId Id of the exercise submission to download.
   * @param saveOldState Whether to submit the current state of the exercise beforehand.
   */
  public async downloadTmcOldSubmission(
    exerciseId: number,
    exercisePath: string,
    submissionId: number,
    saveOldState: boolean,
    _progressCallback?: (downloadedPct: number, increment: number) => void,
  ): Promise<Result<void, Error>> {
    const saveOldStateArg = saveOldState ? ["--save-old-state"] : []
    const args = this._tmcCmd(
      "download-old-submission",
      "--submission-id",
      submissionId.toString(),
      ...saveOldStateArg,
      "--exercise-id",
      exerciseId.toString(),
      "--output-path",
      exercisePath,
    )
    const res = await this._executeLangsCommand({ args, backend: "tmc" }, null)
    return res.err ? res : Ok.EMPTY
  }

  /**
   * Restores a past mooc submission at `exercisePath`.
   *
   * Resolves to `nothing-to-download` for a submission the server has no files
   * for, which only an exercise type with no files at all can be. Nothing on disk
   * (or on the server) is touched in that case, `saveOldState` included.
   */
  public async downloadMoocOldSubmission(
    exerciseId: string,
    exercisePath: string,
    submissionId: string,
    saveOldState: boolean,
    _progressCallback?: (downloadedPct: number, increment: number) => void,
  ): Promise<Result<MoocOldSubmissionRestore, Error>> {
    const saveOldStateArg = saveOldState ? ["--save-old-state"] : []
    const args = this._moocCmd(
      "download-old-submission",
      "--submission-id",
      submissionId,
      ...saveOldStateArg,
      "--exercise-id",
      exerciseId,
      "--output-path",
      exercisePath,
    )
    const res = await this._executeLangsCommand(
      { args, backend: "mooc" },
      "mooc-old-submission-restore",
    )
    return res.map((output) => output.data["output-data"])
  }

  /**
   * Gets all courses of the given organization. Results may vary depending on the user account's
   * priviledges. Uses TMC-langs `get-courses` core command internally.
   *
   * @param organization Slug of the organization.
   * @returns Array of the organization's courses.
   */
  public async getCourses(
    organization: string,
    options?: CacheOptions,
  ): Promise<Result<Course[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-courses", "--organization", organization),
      },
      "courses",
      {
        forceRefresh: options?.forceRefresh,
        key: cacheKey("tmc", "organization-courses", organization),
      },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets user-specific data of the given course. Uses TMC-langs `get-course-data` core
   * command internally.
   *
   * @param courseId Id to the course.
   * @returns A combination of getCourseDetails, getCourseExercises, getCourseSettings.
   */
  public async getTmcCourseData(
    courseId: number,
    options?: CacheOptions,
  ): Promise<Result<CombinedCourseData, Error>> {
    const remapper: CacheConfig["remapper"] = (response) => {
      if (response.data?.["output-data-kind"] !== "combined-course-data") {
        return []
      }
      const { details, exercises, settings } = response.data["output-data"]
      return [
        [
          cacheKey("tmc", "course-details", courseId),
          {
            ...response,
            data: { "output-data-kind": "course-details", "output-data": details },
          },
        ],
        [
          cacheKey("tmc", "course-exercises", courseId),
          {
            ...response,
            data: { "output-data-kind": "course-exercises", "output-data": exercises },
          },
        ],
        [
          cacheKey("tmc", "course-settings", courseId),
          {
            ...response,
            data: { "output-data-kind": "course-data", "output-data": settings },
          },
        ],
      ]
    }
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-course-data", "--course-id", courseId.toString()),
      },
      "combined-course-data",
      {
        forceRefresh: options?.forceRefresh,
        key: cacheKey("tmc", "course-data", courseId),
        remapper,
      },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets a mooc course with its exercise slides. Two sequential CLI calls
   * (`mooc course`, `mooc course-exercises`) — mooc has no combined endpoint
   * like tmc's `combined-course-data`. Each is cached by course id; pass
   * `{ forceRefresh: true }` to bypass.
   */
  public async getMoocCourseInstanceData(
    courseId: string,
    options?: CacheOptions,
  ): Promise<Result<[CourseInstance, TmcExerciseSlide[]], Error>> {
    const courseRes = await this._executeLangsCommand(
      { backend: "mooc", args: this._moocCmd("course", "--course-id", courseId) },
      "mooc-course",
      { forceRefresh: options?.forceRefresh, key: cacheKey("mooc", "course", courseId) },
    )
    if (courseRes.err) {
      return courseRes
    }
    const exercisesRes = await this._executeLangsCommand(
      { backend: "mooc", args: this._moocCmd("course-exercises", "--course-id", courseId) },
      "mooc-exercise-slides",
      { forceRefresh: options?.forceRefresh, key: cacheKey("mooc", "course-exercises", courseId) },
    )
    if (exercisesRes.err) {
      return exercisesRes
    }
    return Ok([courseRes.val.data["output-data"], exercisesRes.val.data["output-data"]])
  }

  /**
   * Per-exercise progress (points, completion) for a mooc course via
   * `mooc course-progress`. Course totals are derived by summing the
   * per-exercise entries, not returned separately.
   *
   * @param courseId The course UUID.
   */
  public async getMoocCourseProgress(courseId: string): Promise<Result<MoocCourseProgress, Error>> {
    const res = await this._executeLangsCommand(
      { backend: "mooc", args: this._moocCmd("course-progress", "--course-id", courseId) },
      "mooc-course-progress",
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets user-specific details of the given course. Uses TMC-langs `get-course-details` core
   * command internally.
   *
   * @param courseId Id to the course.
   * @returns Details of the course.
   */
  public async getCourseDetails(
    courseId: CourseIdentifier,
    options?: CacheOptions,
  ): Promise<Result<CourseDetails | CourseInstance, Error>> {
    if (courseId.kind === "tmc") {
      const res = await this._executeLangsCommand(
        {
          backend: "tmc",
          args: this._tmcCmd(
            "get-course-details",
            "--course-id",
            CourseIdentifier.toString(courseId),
          ),
        },
        "course-details",
        {
          forceRefresh: options?.forceRefresh,
          key: cacheKey("tmc", "course-details", CourseIdentifier.toString(courseId)),
        },
      )
      return res.map((x) => x.data["output-data"])
    } else if (courseId.kind === "mooc") {
      // The mooc CLI has no `get-course-details` subcommand; `course` returns the
      // course itself. Callers use this only as a connectivity probe (a failed
      // result flips the course-details view into offline mode), so the returned
      // MoocCourse shape is sufficient. It shares getMoocCourseInstanceData's entry,
      // being the same command against the same course.
      const res = await this._executeLangsCommand(
        {
          backend: "mooc",
          args: this._moocCmd("course", "--course-id", CourseIdentifier.toString(courseId)),
        },
        "mooc-course",
        {
          forceRefresh: options?.forceRefresh,
          key: cacheKey("mooc", "course", CourseIdentifier.toString(courseId)),
        },
      )
      return res.map((x) => x.data["output-data"])
    }
    assertUnreachable(courseId)
  }

  /**
   * Gets exercises of the given course. Each exercise includes information about available and
   * awarded points. Uses TMC-langs `get-course-exercises` core command internally.
   *
   * @param courseId Id of the course.
   * @returns Array of the course's exercises.
   */
  public async getCourseExercises(
    courseId: number,
    options?: CacheOptions,
  ): Promise<Result<CourseExercise[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-course-exercises", "--course-id", courseId.toString()),
      },
      "course-exercises",
      { forceRefresh: options?.forceRefresh, key: cacheKey("tmc", "course-exercises", courseId) },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets general course info of the given course. Uses TMC-langs `get-course-settings` core
   * command internally.
   *
   * @param courseId Id of the course.
   * @returns Info of the course.
   */
  public async getCourseSettings(
    courseId: number,
    options?: CacheOptions,
  ): Promise<Result<CourseData, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-course-settings", "--course-id", courseId.toString()),
      },
      "course-data",
      { forceRefresh: options?.forceRefresh, key: cacheKey("tmc", "course-settings", courseId) },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets details of the given exercise. Uses TMC-langs `get-exercise-details` core command
   * internally.
   *
   * @param exerciseId Id of the exercise.
   * @returns Details of the exercise.
   */
  public async getExerciseDetails(
    exerciseId: number,
    options?: CacheOptions,
  ): Promise<Result<ExerciseDetails, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-exercise-details", "--exercise-id", exerciseId.toString()),
      },
      "exercise-details",
      { forceRefresh: options?.forceRefresh, key: cacheKey("tmc", "exercise-details", exerciseId) },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets user's old submissions for the given exercise. Uses TMC-langs `get-exercise-submissions`
   * core command internally.
   *
   * @param exerciseId Id of the exercise.
   * @returns Array of old submissions.
   */
  public async getTmcOldSubmissions(exerciseId: number): Promise<Result<Submission[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-exercise-submissions", "--exercise-id", exerciseId.toString()),
      },
      "submissions",
    )
    return res.map((x) => x.data["output-data"])
  }

  public async getMoocOldSubmissions(
    exerciseId: string,
  ): Promise<Result<ExerciseSlideSubmissionListItem[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "mooc",
        args: this._moocCmd("get-exercise-submissions", "--exercise-id", exerciseId),
      },
      "mooc-submissions",
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets data of the given organization. Uses TMC-langs `get-organization` core command
   * internally.
   *
   * @param organizationSlug Slug of the organization.
   * @returns Organization matching the given slug.
   */
  public async getOrganization(
    organizationSlug: string,
    options?: CacheOptions,
  ): Promise<Result<Organization, Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-organization", "--organization", organizationSlug),
      },
      "organization",
      {
        forceRefresh: options?.forceRefresh,
        key: cacheKey("tmc", "organization", organizationSlug),
      },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Gets all organizations. Uses TMC-langs `get-organizations` core command internally.
   *
   * @returns A list of organizations.
   */
  public async getTmcOrganizations(options?: CacheOptions): Promise<Result<Organization[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("get-organizations"),
      },
      "organizations",
      {
        forceRefresh: options?.forceRefresh,
        key: cacheKey("tmc", "organizations"),
        remapper: organizationsRemapper,
      },
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Reverts given exercise to its original template. Optionally submits the current state
   * of the exercise beforehand. Uses TMC-langs `reset-exercise` core command internally.
   *
   * @param exerciseId Id of the exercise.
   * @param saveOldState Whether to submit current state of the exercise before reseting it.
   */
  public async resetExercise(
    exerciseId: ExerciseIdentifier,
    exercisePath: string,
    saveOldState: boolean,
  ): Promise<Result<void, Error>> {
    return match(
      exerciseId,
      async (tmc) => {
        const saveOldStateArg = saveOldState ? ["--save-old-state"] : []
        const args = this._tmcCmd(
          "reset-exercise",
          ...saveOldStateArg,
          "--exercise-id",
          tmc.tmcExerciseId.toString(),
          "--exercise-path",
          exercisePath,
        )
        const res = await this._executeLangsCommand({ args, backend: "tmc" }, null)
        return res.err ? res : Ok.EMPTY
      },
      async (mooc) => {
        // Mirrors the tmc leg above, against the mooc `reset-exercise`
        // subcommand. The CLI re-downloads the stub archive before clearing the
        // directory, so a failed download can't wipe the student's work.
        const saveOldStateArg = saveOldState ? ["--save-old-state"] : []
        const args = this._moocCmd(
          "reset-exercise",
          ...saveOldStateArg,
          "--exercise-id",
          mooc.moocExerciseId,
          "--exercise-path",
          exercisePath,
        )
        const res = await this._executeLangsCommand({ args, backend: "mooc" }, null)
        return res.err ? res : Ok.EMPTY
      },
    )
  }

  /**
   * Submits an exercise to server and waits for test results. Uses TMC-langs `submit` core
   * command internally.
   *
   * This function can only be called once per `MINIMUM_SUBMISSION_INTERVAL` and this limitation
   * is shared with `submitTmcExerciseToPaste()`.
   *
   * @param exerciseId Id of the exercise.
   * @param progressCallback Optional callback function that can be used to get status reports.
   */
  public async submitTmcExerciseAndWaitForResults(
    exerciseId: number,
    exercisePath: string,
    progressCallback?: (progressPct: number, message?: string) => void,
    onSubmissionUrl?: (url: string) => void,
  ): Promise<Result<SubmissionFinished, Error>> {
    const now = Date.now()
    if (now < this._nextTmcSubmissionAllowedTimestamp) {
      return Err(new BottleneckError("This command can't be executed at the moment."))
    }
    this._nextTmcSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL

    const onStdout = (res: StatusUpdateData): void => {
      progressCallback?.(100 * res["percent-done"], res.message ?? undefined)
      if (
        res["update-data-kind"] === "client-update-data" &&
        res.data?.["client-update-data-kind"] === "posted-submission"
      ) {
        onSubmissionUrl?.(res.data.show_submission_url)
      }
    }

    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd(
          "submit",
          "--submission-path",
          exercisePath,
          "--exercise-id",
          String(exerciseId),
        ),
        onStdout,
        onNotification: (notification) => this._showNotification(notification),
        processTimeout: SUBMIT_PROCESS_TIMEOUT,
        interruptOnDeactivate: true,
      },
      "submission-finished",
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Submits a mooc exercise and waits for its grading, the mooc twin of
   * {@link submitTmcExerciseAndWaitForResults}. The CLI resolves the slide and
   * task ids from the exercise id and owns the poll loop, so this only needs the
   * exercise id and path; it returns the terminal grading status.
   *
   * Shares its `MINIMUM_SUBMISSION_INTERVAL` throttle with
   * `submitMoocExerciseToPaste()`; per-backend, so tmc submit/paste is unaffected.
   *
   * @param exerciseId Mooc exercise id (a UUID string).
   * @param exercisePath Path to the local exercise directory.
   * @param progressCallback Optional callback for progress reports during grading.
   */
  public async submitMoocExerciseAndWaitForResults(
    exerciseId: string,
    exercisePath: string,
    progressCallback?: (progressPct: number, message?: string) => void,
  ): Promise<Result<ExerciseTaskSubmissionStatus, Error>> {
    const now = Date.now()
    if (now < this._nextMoocSubmissionAllowedTimestamp) {
      return Err(new BottleneckError("This command can't be executed at the moment."))
    }
    this._nextMoocSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL

    const onStdout = (res: StatusUpdateData): void => {
      progressCallback?.(100 * res["percent-done"], res.message ?? undefined)
    }

    const res = await this._executeLangsCommand(
      {
        backend: "mooc",
        args: this._moocCmd(
          "submit",
          "--exercise-id",
          exerciseId,
          "--submission-path",
          exercisePath,
        ),
        onStdout,
        onNotification: (notification) => this._showNotification(notification),
        processTimeout: SUBMIT_PROCESS_TIMEOUT,
        interruptOnDeactivate: true,
      },
      "mooc-submission-status",
    )
    return res.map((x) => x.data["output-data"])
  }

  /**
   * Submits given exercise to TMC Paste and provides a link to it. Uses TMC-langs `paste` core
   * command internally.
   *
   * This function can only be called once per `MINIMUM_SUBMISSION_INTERVAL` and this limitation
   * is shared with `submitTmcExerciseAndWaitForResults()`.
   *
   * @param exerciseId Id of the exercise.
   * @returns TMC paste link.
   */
  public async submitTmcExerciseToPaste(
    exerciseId: number,
    exercisePath: string,
  ): Promise<Result<string, Error>> {
    const now = Date.now()
    if (now < this._nextTmcSubmissionAllowedTimestamp) {
      return Err(new BottleneckError("This command can't be executed at the moment."))
    }
    this._nextTmcSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL

    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd(
          "paste",
          "--exercise-id",
          exerciseId.toString(),
          "--submission-path",
          exercisePath,
        ),
        processTimeout: CLI_PROCESS_TIMEOUT,
        interruptOnDeactivate: true,
      },
      "new-submission",
    )
    return res.map((x) => x.data["output-data"].paste_url)
  }
  /**
   * Submits a mooc exercise and shares it, returning a public paste link, the
   * mooc twin of {@link submitTmcExerciseToPaste}. The CLI `mooc paste`
   * subcommand submits (non-blocking) then shares the resulting submission in
   * one shot, resolving the slide/task ids from the exercise id.
   *
   * Shares its `MINIMUM_SUBMISSION_INTERVAL` throttle with
   * `submitMoocExerciseAndWaitForResults()`; per-backend, so tmc submit/paste is unaffected.
   *
   * @param exerciseId Mooc exercise id (a UUID string).
   * @param exercisePath Path to the local exercise directory.
   * @returns The paste link.
   */
  public async submitMoocExerciseToPaste(
    exerciseId: string,
    exercisePath: string,
  ): Promise<Result<string, Error>> {
    const now = Date.now()
    if (now < this._nextMoocSubmissionAllowedTimestamp) {
      return Err(new BottleneckError("This command can't be executed at the moment."))
    }
    this._nextMoocSubmissionAllowedTimestamp = now + MINIMUM_SUBMISSION_INTERVAL

    const res = await this._executeLangsCommand(
      {
        backend: "mooc",
        args: this._moocCmd(
          "paste",
          "--exercise-id",
          exerciseId,
          "--submission-path",
          exercisePath,
        ),
        processTimeout: CLI_PROCESS_TIMEOUT,
        interruptOnDeactivate: true,
      },
      "mooc-paste",
    )
    return res.map((x) => x.data["output-data"].paste_url)
  }

  /**
   * Submits feedback for an exercise. Uses TMC-langs `send-feedback` core command internally.
   *
   * @param feedbackUrl URL for feedback. Usually provided by a successful exercise submission.
   * @param feedback Feedback to submit.
   * @returns Response from submitting the feedback.
   */
  public async submitSubmissionFeedback(
    feedbackUrl: string,
    feedback: SubmissionFeedback,
  ): Promise<Result<SubmissionFeedbackResponse, Error>> {
    const feedbackArgs = feedback.status.reduce<string[]>(
      (acc, next) => acc.concat("--feedback", next.question_id.toString(), next.answer),
      [],
    )
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("send-feedback", "--feedback-url", feedbackUrl, ...feedbackArgs),
      },
      "submission-feedback-response",
    )
    return res.map((r) => r.data["output-data"])
  }

  /**
   * Lists the courses.mooc.fi courses the user is enrolled in. The backend keys
   * enrollments by (user, course, instance) and can therefore return the same
   * course twice when a user has two live enrollments of it; since the extension
   * keys courses by course id, the list is de-duplicated by `id` (keeping the
   * first occurrence) so the same course never appears — or is added — twice.
   */
  public async getEnrolledMoocCourseInstances(): Promise<Result<CourseInstance[], Error>> {
    const res = await this._executeLangsCommand(
      { backend: "mooc", args: this._moocCmd("courses") },
      "mooc-courses",
    )
    return res.map((r) => {
      const seen = new Set<string>()
      return r.data["output-data"].filter((course) => {
        if (seen.has(course.id)) {
          return false
        }
        seen.add(course.id)
        return true
      })
    })
  }

  /**
   * Constructs the base arguments for all `mooc` subcommands.
   *
   * @param rest The rest of the arguments.
   * @returns The complete arguments.
   */
  private _moocCmd(...rest: string[]): string[] {
    return ["mooc", "--client-name", this.clientName].concat(rest)
  }

  /**
   * Constructs the base arguments for all `tmc` subcommands.
   *
   * @param rest The rest of the arguments.
   * @returns The complete arguments.
   */
  private _tmcCmd(...rest: string[]): string[] {
    return ["tmc", "--client-name", this.clientName, "--client-version", this.clientVersion].concat(
      rest,
    )
  }

  /**
   * Constructs the base arguments for all `settings` subcommands.
   *
   * @param rest The rest of the arguments.
   * @returns The complete arguments.
   */
  private _settingsCmd(...rest: string[]): string[] {
    return ["settings", "--client-name", this.clientName].concat(rest)
  }

  /**
   * Executes a tmc-langs-cli process to completion and validates the final response.
   *
   * @param langsArgs Command arguments passed to `_spawnLangsProcess`.
   * @param outputDataKind Expected `output-data-kind` of the result.
   * @param cacheConfig Cache options.
   */
  private async _executeLangsCommand<T extends DataKind["output-data-kind"] | null>(
    langsArgs: LangsProcessArgs,
    outputDataKind: T,
    cacheConfig?: CacheConfig,
  ): Promise<
    Result<OutputData & { data: T extends null ? null : { "output-data-kind": T } }, Error>
  > {
    const key = cacheConfig?.key
    const currentTime = Date.now()
    if (!cacheConfig?.forceRefresh && key) {
      const cachedEntry = this._readCachedResponse(key)
      if (cachedEntry) {
        const { response, timestamp } = cachedEntry
        const cachedDataLifeLeft = timestamp + API_CACHE_LIFETIME - currentTime
        if (cachedDataLifeLeft > 0 && dataMatchesKind(response, outputDataKind)) {
          const prettySecondsLeft = Math.ceil(cachedDataLifeLeft / 1000)
          Logger.info(`Using cached data for key: ${key}. Still valid for ${prettySecondsLeft}s`)
          return Ok(response)
        }
        Logger.debug(`Discarding invalidated cache data for key: ${key}`)
        this._responseCache.delete(key)
      }
    }

    const process = this._spawnLangsProcess(langsArgs)
    if (process.err) {
      return process
    }
    langsArgs.onInterruptHandle?.(process.val.interrupt)
    const auth: AuthAttribution = {
      backend: langsArgs.backend,
      expected: langsArgs.suppressAuthEvents,
    }
    const { result, getStderr } = process.val
    const res = await result
    return res
      .andThen((x) => this._checkLangsResponse(x, outputDataKind, auth, getStderr()))
      .andThen((x) => {
        if (x && key) {
          this._writeCachedResponse(key, { response: x, timestamp: currentTime })
          cacheConfig?.remapper?.(x).forEach(([remappedKey, response]) => {
            this._writeCachedResponse(remappedKey, { response, timestamp: currentTime })
          })
        }
        return Ok(x)
      })
  }

  /** Reads an entry and marks it most recently used, so {@link _writeCachedResponse} evicts it last. */
  private _readCachedResponse(key: string): ResponseCacheEntry | undefined {
    const entry = this._responseCache.get(key)
    if (entry) {
      // A Map iterates in insertion order, so re-inserting moves the entry to the back.
      this._responseCache.delete(key)
      this._responseCache.set(key, entry)
    }
    return entry
  }

  /** Stores an entry, evicting the least recently used ones once the cache is over its cap. */
  private _writeCachedResponse(key: string, entry: ResponseCacheEntry): void {
    this._responseCache.delete(key)
    this._responseCache.set(key, entry)
    for (const oldest of this._responseCache.keys()) {
      if (this._responseCache.size <= MAX_CACHED_RESPONSES) {
        break
      }
      this._responseCache.delete(oldest)
    }
  }

  /**
   * Drops every cached response belonging to `backend`, leaving the other backend's alone:
   * the two servers are unrelated, so one rejecting our credentials says nothing about the
   * other's data. An unattributed failure drops everything, having ruled nothing out.
   */
  private _clearBackendCache(backend: "tmc" | "mooc" | undefined): void {
    if (backend === undefined) {
      this._responseCache.clear()
      return
    }
    const prefix = `${backend}:`
    for (const key of this._responseCache.keys()) {
      if (key.startsWith(prefix)) {
        this._responseCache.delete(key)
      }
    }
  }

  /**
   * Checks langs response for generic errors.
   *
   * @param auth How an auth failure in this response is attributed; see {@link AuthAttribution}.
   */
  private _checkLangsResponse<T extends DataKind["output-data-kind"] | null>(
    langsResponse: OutputData,
    outputDataKind: T,
    auth: AuthAttribution = {},
    stderr = "",
  ): Result<OutputData & { data: T extends null ? null : { "output-data-kind": T } }, BaseError> {
    // The CLI's panic handler emits `status: "crashed"` with no data, so narrowing on the
    // expected data kind first would misreport every panic and discard its message.
    if (langsResponse.status === "crashed") {
      Logger.error("Langs process crashed.", langsResponse.message)
      return Err(new BaseError(langsResponse.message || "Langs process crashed.", stderr))
    }
    if (!dataMatchesKind(langsResponse, outputDataKind)) {
      // Not the envelope: a `logged-in` response carries a live OAuth token.
      Logger.error(
        "Unexpected TMC-langs response.",
        `result: ${langsResponse.result}, output-data-kind: ${langsResponse.data?.["output-data-kind"]}`,
      )
      return Err(new BaseError("Unexpected TMC-langs response.", stderr))
    }
    if (langsResponse.result !== "error") {
      return Ok(langsResponse)
    }
    if (langsResponse.data?.["output-data-kind"] !== "error") {
      Logger.error("Unexpected data in error response.", JSON.stringify(langsResponse, null, 2))
      return Err(new BaseError("Unexpected data in error response", stderr))
    }

    // after this point, we know we have an error
    const data = langsResponse.data
    const message = langsResponse.message
    const errorKind = data["output-data"].kind
    // `trace` is the CLI's own reported backtrace; `stderr` is what the process wrote.
    // Neither alone has been enough to diagnose a failure, so every error carries both.
    const details = [data["output-data"].trace.join("\n"), stderr].filter(Boolean).join("\n\n")
    switch (errorKind) {
      case "connection-error":
        return Err(new ConnectionError(message, details))
      case "forbidden":
        return Err(new ForbiddenError(message, details))
      case "not-enrolled": {
        // Not hardcoded to courses.mooc.fi: this error kind can come from either backend.
        const siteName =
          auth.backend === "tmc"
            ? "tmc.mooc.fi"
            : auth.backend === "mooc"
              ? "courses.mooc.fi"
              : "the server"
        return Err(
          new NotEnrolledError(
            `You are no longer enrolled on this course on ${siteName}, so its` +
              ` exercises can't be fetched. Enroll on the course again from` +
              ` ${siteName}, then reload the course here.`,
            details,
          ),
        )
      }
      case "upload-expired":
        // The CLI uploads and submits within one invocation and already retried the upload
        // once, so retrying the submit is the only action left to suggest.
        return Err(
          new UploadExpiredError(
            `${message}\nThe submission's files expired on the server before the` +
              ` submission was accepted. Please try again.`,
            details,
          ),
        )
      case "unknown-upload":
        // Never a race: the backend has no record of a file the CLI named for
        // this exercise. Surfaced as-is so it is diagnosable rather than retried.
        return Err(new UnknownUploadError(message, details))
      case "invalid-token":
        this._clearBackendCache(auth.backend)
        if (!auth.expected) {
          this._fireUnexpectedLogout(auth.backend)
        }
        return Err(new InvalidTokenError(message))
      case "not-logged-in":
        this._clearBackendCache(auth.backend)
        if (!auth.expected) {
          this._fireUnexpectedLogout(auth.backend)
        }
        return Err(new AuthorizationError(message, details))
      case "obsolete-client":
        return Err(
          new ObsoleteClientError(
            message +
              "\nYour TMC Extension is out of date, please update it." +
              "\nhttps://code.visualstudio.com/docs/editor/extension-gallery",
            details,
          ),
        )
    }

    return Err(new RuntimeError(message, details))
  }

  /**
   * Passes a CLI notification on to the `notification` subscriber, at most once per
   * distinct message: the plugin that warns about an outdated Python repeats it on every
   * test run, and identical toasts would stack.
   */
  private _showNotification(notification: Notification): void {
    if (this._shownNotifications.has(notification.message)) {
      return
    }
    this._shownNotifications.add(notification.message)
    this._onNotification?.(notification)
  }

  /** Fires the unexpected-logout (`expected: false`) event for `target`, used when credentials were rejected rather than removed deliberately. */
  private _fireUnexpectedLogout(target?: "tmc" | "mooc"): void {
    if (target === "tmc") {
      this._onLogout?.(false)
    } else if (target === "mooc") {
      this._onMoocLogout?.(false)
    }
  }

  /**
   * Spawns a new tmc-langs-cli process with given arguments.
   *
   * @returns Rust process runner.
   */
  private _spawnLangsProcess(
    commandArgs: LangsProcessArgs,
  ): Result<LangsProcessRunner, InitializationError | SpawnError> {
    const {
      args,
      env,
      obfuscate,
      onStdout,
      onNotification,
      stdin,
      processTimeout,
      interruptOnDeactivate,
    } = commandArgs

    let theResult: OutputData | undefined
    let stdoutBuffer = ""
    // Last schema-validation failure, if any — lets a process that ends without
    // output data report *why* instead of a generic "no result data" message.
    let lastSchemaFailure: LangsSchemaFailure | undefined

    const loggableCommand = [this.cliPath]
      .concat(args.map((x, i) => (obfuscate?.includes(i) ? "***" : loggableArg(x))))
      .map((x) => JSON.stringify(x))
      .join(" ")

    // override settings with environment variables, mainly for testing
    const tmcBackendUrl = process.env.TMC_LANGS_TMC_ROOT_URL ?? TMC_BACKEND_URL
    const moocBackendUrl = process.env.TMC_LANGS_MOOC_ROOT_URL ?? MOOC_BACKEND_URL
    const tmcLangsConfigDir = process.env.TMC_LANGS_CONFIG_DIR ?? this._options.cliConfigDir
    // The tmc path authenticates with the courses.mooc.fi access token too, so
    // the mooc OAuth knobs belong on every command, `tmc` ones included. Without
    // TMC_LANGS_MOOC_TRUST_LOCALHOST the CLI attaches no bearer to a localhost
    // backend, which would silently make the mock-backend tiers unauthenticated.
    const moocEnv: Record<string, string> = {}
    for (const key of ["TMC_LANGS_MOOC_CLIENT_ID", "TMC_LANGS_MOOC_TRUST_LOCALHOST"] as const) {
      const value = process.env[key]
      if (value !== undefined) {
        moocEnv[key] = value
      }
    }

    Logger.info(`Running ${loggableCommand}`)
    Logger.debug(`TMC backend at ${tmcBackendUrl}`)
    Logger.debug(`MOOC backend at ${moocBackendUrl}`)
    Logger.debug(`Config dir at ${tmcLangsConfigDir}`)

    // debug pulls in j4rs/JNI spam, so only ask for it when the user opted into verbose
    const cliLogLevel = Logger.level === LogLevel.Verbose ? "debug" : "info"

    let active = true
    let interrupted = false
    let spawnFailure: Error | undefined
    let cprocess
    const startTime = Date.now()
    try {
      cprocess = cp.spawn(this.cliPath, args, {
        // Gives the child its own process group, so {@link killProcessTree} can reach the
        // plugins it spawns (Maven, pytest) with one signal. No-op on Windows.
        detached: HAS_PROCESS_GROUPS,
        env: {
          ...process.env,
          ...env,
          RUST_LOG: `${cliLogLevel},rustls=warn,reqwest=warn`,
          TMC_LANGS_TMC_ROOT_URL: tmcBackendUrl,
          TMC_LANGS_MOOC_ROOT_URL: moocBackendUrl,
          TMC_LANGS_CONFIG_DIR: tmcLangsConfigDir,
          ...moocEnv,
        },
      })
    } catch (error) {
      return Err(new SpawnError(error, "Failed to run tmc-langs-cli"))
    }
    // Chunk boundaries fall wherever the pipe buffer does, so a decode per chunk splits
    // multi-byte characters -- Finnish exercise names, Java failure messages -- into
    // replacement characters while leaving the JSON syntactically valid. An encoding on
    // the stream makes Node hold an incomplete sequence until the rest of it arrives.
    cprocess.stdout.setEncoding("utf8")
    cprocess.stderr.setEncoding("utf8")
    if (stdin) {
      // A CLI reading stdin blocks until EOF, so the write has to be closed. The listener
      // keeps an EPIPE from a child that exited early off the unhandled-error path.
      cprocess.stdin.on("error", (error) => Logger.warn("Failed to write to langs stdin", error))
      cprocess.stdin.end(stdin + "\n")
    }

    const stderr = new BoundedStderr()
    const processResult = new Promise<number | null>((resolve, reject) => {
      let resultCode: number | undefined
      let stdoutEnded = false

      const timeout =
        processTimeout &&
        setTimeout(() => {
          killProcessTree(cprocess)
          reject(
            new TimeoutError("Process didn't seem to finish or was taking a really long time."),
          )
        }, processTimeout)

      cprocess.on("error", (error) => {
        active = false
        if (timeout) {
          clearTimeout(timeout)
        }
        // macOS error -88 indicates an architecture (Rosetta) mismatch
        if ("errno" in error && error.errno === -88) {
          error.message = `A compatibility error was detected.
If you're on macOS: Try installing Rosetta by running \`softwareupdate --install-rosetta\` in the terminal. (See https://support.apple.com/en-us/102527).
${error.message}`
        }
        spawnFailure = error
        reject(error)
      })
      cprocess.stderr.on("data", (data: string) => {
        // per-line at debug to keep j4rs/JNI spam out of the log; the failure paths
        // below attach the collected stderr to the error they return
        Logger.debug("stderr", data)
        stderr.push(data)
      })
      cprocess.stdout.on("end", () => {
        stdoutEnded = true
        if (resultCode !== undefined) {
          if (timeout) {
            clearTimeout(timeout)
          }
          resolve(resultCode)
        }
      })
      cprocess.on("exit", (code) => {
        // The pid is free for the OS to reuse from here on, so a retained `interrupt`
        // closure must not signal it.
        active = false
        resultCode = code ?? 0
        Logger.info(
          `Process exited with code ${resultCode} after ${Date.now() - startTime}ms: ${loggableCommand}`,
        )
        if (stdoutEnded) {
          if (timeout) {
            clearTimeout(timeout)
          }
          resolve(code)
        }
      })
      cprocess.stdout.on("data", (chunk: string) => {
        const decoded = decodeLangsStdout(stdoutBuffer, chunk)
        stdoutBuffer = decoded.carry
        for (const event of decoded.events) {
          switch (event.kind) {
            case "output-data":
              theResult = event.output
              break
            case "status-update":
              onStdout?.(event.update)
              break
            case "notification": {
              const { message } = event.notification
              if (event.notification["notification-kind"] === "warning") {
                Logger.warn(message)
              } else {
                Logger.info(message)
              }
              onNotification?.(event.notification)
              break
            }
            case "schema-mismatch":
              lastSchemaFailure = event.failure
              Logger.error(
                "TMC-langs response didn't match expected type:",
                event.failure.issueSummary,
              )
              Logger.debug("Rejected output shape:", JSON.stringify(event.failure.shape))
              break
            case "unparseable":
              Logger.warn(
                `Discarded a ${event.lineLength}-character TMC-langs output line that is not JSON`,
              )
              break
          }
        }
      })
    })

    const result = (async (): LangsProcessRunner["result"] => {
      try {
        await processResult
      } catch (error) {
        if (spawnFailure) {
          // ENOENT/EACCES/EPERM arrive here rather than as a `cp.spawn` throw, and
          // `activate` gates its antivirus-exception advice on this class.
          return Err(new SpawnError(spawnFailure, stderr.text()))
        }
        if (error instanceof TimeoutError) {
          return Err(new TimeoutError(error.message, stderr.text()))
        }
        return Err(new RuntimeError(error as string, stderr.text()))
      }

      if (interrupted) {
        return Err(new RuntimeError("TMC Langs process was killed.", stderr.text()))
      }

      if (stdoutBuffer !== "") {
        Logger.warn(`Discarded ${stdoutBuffer.length} characters of unterminated TMC-langs output`)
      }

      if (theResult) {
        return Ok(theResult)
      }
      if (lastSchemaFailure) {
        return Err(
          new LangsResponseSchemaError(
            `Langs process ended without result data because its output didn't match the ` +
              `expected schema (output-kind: ${JSON.stringify(lastSchemaFailure.outputKind)}): ` +
              `${lastSchemaFailure.issueSummary}`,
          ),
        )
      }
      return Err(
        new EmptyLangsResponseError("Langs process ended without result data.", stderr.text()),
      )
    })()

    const interrupt = (): void => {
      if (active) {
        active = false
        interrupted = true
        killProcessTree(cprocess)
      }
    }
    if (interruptOnDeactivate) {
      this._activeInterrupts.add(interrupt)
      void result.finally(() => this._activeInterrupts.delete(interrupt))
    }
    return Ok({ interrupt, result, getStderr: (): string => stderr.text() })
  }
}

/** A stdout line the CLI's output contract rejected, described without its values. */
export interface LangsSchemaFailure {
  /** `z.prettifyError`'s paths and messages. */
  issueSummary: string
  /** The line's `output-kind`, when it is a string. */
  outputKind: string | undefined
  /** The line's JSON with every value replaced by its type. */
  shape: unknown
}

/** One decoded line of the CLI's newline-delimited stdout. */
export type LangsStdoutEvent =
  | { kind: "output-data"; output: OutputData }
  | { kind: "status-update"; update: StatusUpdateData }
  | { kind: "notification"; notification: Notification }
  | { kind: "schema-mismatch"; failure: LangsSchemaFailure }
  | { kind: "unparseable"; lineLength: number }

export interface LangsStdoutDecoding {
  /** The chunk's unterminated tail; pass it back as `carry` with the next chunk. */
  carry: string
  events: LangsStdoutEvent[]
}

/**
 * Splits one chunk of the CLI's stdout into whole lines and classifies each one.
 *
 * Pure, and deliberately silent. The `logged-in` envelope carries a live OAuth token and
 * the output channel is what users are asked to paste into bug reports, so a rejected line
 * is described by shape alone and callers have no payload to log.
 *
 * @param carry The previous chunk's unterminated tail; `""` at the start of the stream.
 */
export function decodeLangsStdout(carry: string, chunk: string): LangsStdoutDecoding {
  const events: LangsStdoutEvent[] = []
  const lines = (carry + chunk).split("\n")
  const tail = lines.pop() ?? ""
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Node's parse errors quote the input, so only the size of the rejected line escapes.
      events.push({ kind: "unparseable", lineLength: trimmed.length })
      continue
    }
    events.push(classifyCliOutputLine(parsed))
  }
  return { carry: tail, events }
}

/** The line's `output-kind`, when the line is an object carrying one as a string. */
function readOutputKind(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== "object" || !("output-kind" in parsed)) {
    return undefined
  }
  const outputKind = (parsed as Record<string, unknown>)["output-kind"]
  return typeof outputKind === "string" ? outputKind : undefined
}

function schemaMismatch(
  parsed: unknown,
  outputKind: string | undefined,
  issueSummary: string,
): LangsStdoutEvent {
  return {
    kind: "schema-mismatch",
    failure: { issueSummary, outputKind, shape: redactedShape(parsed) },
  }
}

/**
 * Validates one parsed stdout line against the single contract branch its `output-kind`
 * names, so a `status-update` is never first measured against the 44-way `output-data`
 * payload union, and a rejection names one branch rather than all three.
 */
function classifyCliOutputLine(parsed: unknown): LangsStdoutEvent {
  const outputKind = readOutputKind(parsed)
  switch (outputKind) {
    case "output-data": {
      const validation = CliOutputData.safeParse(parsed)
      return validation.success
        ? { kind: "output-data", output: validation.data }
        : schemaMismatch(parsed, outputKind, z.prettifyError(validation.error))
    }
    case "status-update": {
      const validation = CliStatusUpdate.safeParse(parsed)
      return validation.success
        ? { kind: "status-update", update: validation.data }
        : schemaMismatch(parsed, outputKind, z.prettifyError(validation.error))
    }
    case "notification": {
      const validation = CliNotification.safeParse(parsed)
      return validation.success
        ? { kind: "notification", notification: validation.data }
        : schemaMismatch(parsed, outputKind, z.prettifyError(validation.error))
    }
  }
  // Every branch pins `output-kind` to a literal, so nothing else can match the contract
  // and no branch's issues are worth listing.
  return schemaMismatch(parsed, outputKind, "unrecognized output-kind")
}

// These name a variant of the output contract rather than anything the user typed or the
// backend issued, so they survive redaction; without them a drift report cannot say which
// variant drifted.
const CONTRACT_DISCRIMINATOR_KEYS = new Set([
  "output-kind",
  "output-data-kind",
  "update-data-kind",
  "client-update-data-kind",
  "result",
  "status",
])

const MAX_SHAPE_DEPTH = 6

/** Replaces every value in `value` with its JSON type, so key names can be logged safely. */
function redactedShape(value: unknown, depth = 0): unknown {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return value.length === 0 || depth >= MAX_SHAPE_DEPTH
      ? []
      : [redactedShape(value[0], depth + 1)]
  }
  if (typeof value !== "object") {
    return typeof value
  }
  if (depth >= MAX_SHAPE_DEPTH) {
    return "object"
  }
  const shape: Record<string, unknown> = {}
  for (const [key, member] of Object.entries(value)) {
    shape[key] =
      CONTRACT_DISCRIMINATOR_KEYS.has(key) && typeof member === "string"
        ? member
        : redactedShape(member, depth + 1)
  }
  return shape
}

/**
 * Type guard for OutputData with the data matching the given `output-data-kind`.
 *
 * @param data The `OutputData` with unknown result data.
 * @param kind The expected `output-data-kind`. If `null`, doesn't check `output-data`.
 */
function dataMatchesKind<T extends DataKind["output-data-kind"] | null>(
  data: OutputData,
  kind: T,
): data is OutputData & { data: T extends null ? null : { "output-data-kind": T } } {
  return (
    kind === null ||
    data.data?.["output-data-kind"] === kind ||
    data.data?.["output-data-kind"] === "error"
  )
}

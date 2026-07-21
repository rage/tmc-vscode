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
  TMC_BACKEND_URL,
} from "../config/constants"
import type { InitializationError } from "../errors"
import {
  AuthenticationError,
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
  LocalMoocExercise,
  LocalTmcExercise,
  MoocCourseProgress,
  MoocDeviceLogin,
  ExerciseSlideSubmissionListItem,
  Organization,
  OutputData,
  RunResult,
  StatusUpdateData,
  StyleValidationResult,
  Submission,
  SubmissionFeedbackResponse,
  SubmissionFinished,
  TmcExerciseSlide,
  UpdatedExercise,
} from "../shared/langsSchema"
import { CliOutput } from "../shared/langsSchema"
import {
  assertUnreachable,
  BaseError,
  CourseIdentifier,
  ExerciseIdentifier,
  makeMoocKind,
  makeTmcKind,
  match,
} from "../shared/shared"
import { Logger } from "../utilities/logger"
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
  onStderr?: ((data: string) => void) | undefined
  onStdout?: ((data: StatusUpdateData) => void) | undefined
  stdin?: string | undefined
  processTimeout?: number | undefined
  /** Set on login/logout commands, where an auth-flavored error is expected rather than a lost session. */
  suppressAuthEvents?: boolean | undefined
  onInterruptHandle?: ((interrupt: () => void) => void) | undefined
}

interface LangsProcessRunner {
  interrupt: () => void
  result: Promise<Result<OutputData, BaseError>>
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

const organizationsRemapper: CacheConfig["remapper"] = (res) => {
  if (res.data?.["output-data-kind"] === "organizations") {
    return res.data["output-data"].map((x) => [
      `organization-${x.slug}`,
      { ...res, data: { "output-data-kind": "organization", "output-data": x } },
    ])
  }
  return []
}

/**
 * A Class that provides an interface to all langs functionality.
 */
export default class Langs {
  private static readonly _exerciseUpdatesCacheKey = "exercise-updates"
  private static readonly _moocExerciseUpdatesCacheKey = "mooc-exercise-updates"

  // Per-backend: tmc.mooc.fi and courses.mooc.fi are unrelated servers, so one must not throttle the other.
  private _nextTmcSubmissionAllowedTimestamp: number
  private _nextMoocSubmissionAllowedTimestamp: number
  private readonly _options: Options
  private readonly _responseCache: Map<string, ResponseCacheEntry>
  private _onLogin?: () => void
  private _onLogout?: (expected: boolean) => void
  private _onMoocLogin?: () => void
  private _onMoocLogout?: (expected: boolean) => void

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
   * Sets the callback to an event. Will overwrite previous callback for the specified event.
   *
   * `expected` is true for a deliberate logout, false when the backend rejected the credentials mid-session.
   *
   * @param event Event to subscribe to.
   * @param callback Eventhandler to invoke on event.
   */
  public on(event: "login" | "mooc-login", callback: () => void): void
  public on(event: "logout" | "mooc-logout", callback: (expected: boolean) => void): void
  public on(
    event: "login" | "logout" | "mooc-login" | "mooc-logout",
    callback: (() => void) | ((expected: boolean) => void),
  ): void {
    switch (event) {
      case "login":
        this._onLogin = callback as () => void
        break
      case "logout":
        this._onLogout = callback as (expected: boolean) => void
        break
      case "mooc-login":
        this._onMoocLogin = callback as () => void
        break
      case "mooc-logout":
        this._onMoocLogout = callback as (expected: boolean) => void
        break
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Authentication commands
  // ---------------------------------------------------------------------------------------------

  /**
   * Authenticates user to TMC services. Uses TMC-langs `login` core command internally.
   *
   * This operation will fails if wrong credentials are provided or if the user is already signed
   * in.
   *
   * @param username Username or email.
   * @param password Password.
   */
  public async authenticate(username: string, password: string): Promise<Result<void, Error>> {
    if (!username || !password) {
      return Err(new AuthenticationError("Username and password may not be empty."))
    }
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("login", "--base64", "--email", username, "--stdin"),
        obfuscate: [8],
        stdin: Buffer.from(password).toString("base64"),
        suppressAuthEvents: true,
      },
      null,
    )
    return res
      .mapErr((x) => new AuthenticationError(x.message))
      .andThen(() => {
        this._onLogin?.()
        return Ok.EMPTY
      })
  }

  /**
   * Returns user's current authentication status. Uses TMC-langs `logged-in` core command
   * internally.
   *
   * @returns Boolean indicating if the user is authenticated.
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
   * Deauthenticates current user. Uses TMC-langs `logout` core command internally.
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
      this._responseCache.clear()
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
      onStderr: (data) => Logger.info("Rust Langs", data),
    })
    if (process.err) {
      return { result: Promise.resolve(process), interrupt: (): void => {} }
    }
    const { interrupt, result } = process.val
    const loginResult = result.then((res) =>
      res
        .andThen((x) => this._checkLangsResponse(x, null))
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
      this._responseCache.clear()
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
   * Lists local exercises for a given course. Dispatches on the backend: the TMC
   * `list-local-course-exercises` core command (keyed by course slug) or the
   * `mooc list-local-course-exercises` subcommand (keyed by course id, since mooc
   * configs store no slug). Both return entries with an `exercise-slug` and an
   * `exercise-path`, the fields the workspace manager needs.
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
          "list-local-course-exercises",
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
    progressCallback?: (progressPct: number, message?: string) => void,
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
      onStdout: (data) => progressCallback?.(100 * data["percent-done"], data.message ?? undefined),
      onStderr: (data) => Logger.info("Rust Langs", data),
      processTimeout: CLI_PROCESS_TIMEOUT,
    })
    if (process.err) {
      return { process: Promise.resolve(process), interrupt: (): void => {} }
    }
    const { interrupt, result } = process.val
    const postResult = result.then((res) =>
      res
        .andThen((x) => this._checkLangsResponse(x, "test-result"))
        .map((x) => x.data["output-data"]),
    )

    return { process: postResult, interrupt }
  }

  public runCheckstyle(
    exercisePath: string,
    progressCallback?: (progressPct: number, message?: string) => void,
  ): {
    process: Promise<Result<StyleValidationResult | null, BaseError>>
    interrupt: () => void
  } {
    const process = this._spawnLangsProcess({
      args: ["checkstyle", "--locale", "en", "--exercise-path", exercisePath],
      onStdout: (data) => progressCallback?.(100 * data["percent-done"], data.message ?? undefined),
      onStderr: (data) => Logger.info("Rust Langs", data),
      processTimeout: CLI_PROCESS_TIMEOUT,
    })
    if (process.err) {
      return { process: Promise.resolve(process), interrupt: (): void => {} }
    }
    const { interrupt, result } = process.val
    const checkstyleResult = result.then((res) =>
      res
        .andThen((x) => this._checkLangsResponse(x, "validation"))
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
    const res = await this._executeLangsCommand(
      {
        args: this._settingsCmd("set", key, JSON.stringify(value)),
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
   * Checks for updates for all exercises in this client's context. Uses TMC-langs
   * `check-exercise-updates` core command internally.
   */
  public async checkTmcExerciseUpdates(
    options?: CacheOptions,
  ): Promise<Result<UpdatedExercise[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "tmc",
        args: this._tmcCmd("check-exercise-updates"),
      },
      "updated-exercises",
      { forceRefresh: options?.forceRefresh, key: Langs._exerciseUpdatesCacheKey },
    )
    return res.map((x) => x.data["output-data"])
  }

  public async checkMoocExerciseUpdates(options?: CacheOptions): Promise<Result<string[], Error>> {
    const res = await this._executeLangsCommand(
      {
        backend: "mooc",
        args: this._moocCmd("check-exercise-updates"),
      },
      "mooc-updated-exercises",
      { forceRefresh: options?.forceRefresh, key: Langs._moocExerciseUpdatesCacheKey },
    )
    return res.map((x) => x.data["output-data"])
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
        this._responseCache.delete(Langs._exerciseUpdatesCacheKey)
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
        this._responseCache.delete(Langs._exerciseUpdatesCacheKey)
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

  public async downloadMoocOldSubmission(
    exerciseId: string,
    exercisePath: string,
    submissionId: string,
    saveOldState: boolean,
    _progressCallback?: (downloadedPct: number, increment: number) => void,
  ): Promise<Result<void, Error>> {
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
    const res = await this._executeLangsCommand({ args, backend: "mooc" }, null)
    return res.err ? res : Ok.EMPTY
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
        key: `organization-${organization}-courses`,
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
          `course-${courseId}-details`,
          {
            ...response,
            data: { "output-data-kind": "course-details", "output-data": details },
          },
        ],
        [
          `course-${courseId}-exercises`,
          {
            ...response,
            data: { "output-data-kind": "course-exercises", "output-data": exercises },
          },
        ],
        [
          `course-${courseId}-settings`,
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
      { forceRefresh: options?.forceRefresh, key: `course-${courseId}-data`, remapper },
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
      { forceRefresh: options?.forceRefresh, key: `mooc-course-${courseId}` },
    )
    if (courseRes.err) {
      return courseRes
    }
    const exercisesRes = await this._executeLangsCommand(
      { backend: "mooc", args: this._moocCmd("course-exercises", "--course-id", courseId) },
      "mooc-exercise-slides",
      { forceRefresh: options?.forceRefresh, key: `mooc-course-exercises-${courseId}` },
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
          key: `course-${CourseIdentifier.toString(courseId)}-details`,
        },
      )
      return res.map((x) => x.data["output-data"])
    } else if (courseId.kind === "mooc") {
      // The mooc CLI has no `get-course-details` subcommand; `course` returns the
      // course itself. Callers use this only as a connectivity probe (a failed
      // result flips the course-details view into offline mode), so the returned
      // MoocCourse shape is sufficient.
      const res = await this._executeLangsCommand(
        {
          backend: "mooc",
          args: this._moocCmd("course", "--course-id", CourseIdentifier.toString(courseId)),
        },
        "mooc-course",
        {
          forceRefresh: options?.forceRefresh,
          key: `course-${CourseIdentifier.toString(courseId)}-details`,
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
      { forceRefresh: options?.forceRefresh, key: `course-${courseId}-exercises` },
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
      { forceRefresh: options?.forceRefresh, key: `course-${courseId}-settings` },
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
      { forceRefresh: options?.forceRefresh, key: `exercise-${exerciseId}-details` },
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
      { forceRefresh: options?.forceRefresh, key: `organization-${organizationSlug}` },
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
        key: "organizations",
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
    exerciseId: ExerciseIdentifier,
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
          ExerciseIdentifier.toString(exerciseId),
        ),
        onStdout,
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
          exerciseId.toString(),
          "--submission-path",
          exercisePath,
        ),
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
    const cacheKey = cacheConfig?.key
    const currentTime = Date.now()
    if (!cacheConfig?.forceRefresh && cacheKey) {
      const cachedEntry = this._responseCache.get(cacheKey)
      if (cachedEntry) {
        const { response, timestamp } = cachedEntry
        const cachedDataLifeLeft = timestamp + API_CACHE_LIFETIME - currentTime
        if (cachedDataLifeLeft > 0 && dataMatchesKind(response, outputDataKind)) {
          const prettySecondsLeft = Math.ceil(cachedDataLifeLeft / 1000)
          Logger.info(
            `Using cached data for key: ${cacheKey}. Still valid for ${prettySecondsLeft}s`,
          )
          return Ok(response)
        }
        Logger.debug(`Discarding invalidated cache data for key: ${cacheKey}`)
        this._responseCache.delete(cacheKey)
      }
    }

    const process = this._spawnLangsProcess(langsArgs)
    if (process.err) {
      return process
    }
    langsArgs.onInterruptHandle?.(process.val.interrupt)
    // Attribute a lost-session error to the command's backend so the right logout event fires.
    const authEventTarget = langsArgs.suppressAuthEvents ? undefined : langsArgs.backend
    const res = await process.val.result
    return res
      .andThen((x) => this._checkLangsResponse(x, outputDataKind, authEventTarget))
      .andThen((x) => {
        if (x && cacheKey) {
          this._responseCache.set(cacheKey, { response: x, timestamp: currentTime })
          cacheConfig?.remapper?.(x).forEach(([key, response]) => {
            this._responseCache.set(key, { response, timestamp: currentTime })
          })
        }
        return Ok(x)
      })
  }

  /**
   * Checks langs response for generic errors.
   *
   * @param authEventTarget Backend whose unexpected-logout event to fire on an auth error; undefined fires none.
   */
  private _checkLangsResponse<T extends DataKind["output-data-kind"] | null>(
    langsResponse: OutputData,
    outputDataKind: T,
    authEventTarget?: "tmc" | "mooc",
  ): Result<OutputData & { data: T extends null ? null : { "output-data-kind": T } }, BaseError> {
    if (!dataMatchesKind(langsResponse, outputDataKind)) {
      Logger.error("Unexpected TMC-langs response.", langsResponse)
      return Err(new BaseError("Unexpected TMC-langs response."))
    }
    if (langsResponse.status === "crashed") {
      Logger.error("Langs process crashed.", langsResponse.message, langsResponse.data)
      return Err(new BaseError("Langs process crashed."))
    }
    if (langsResponse.result !== "error") {
      return Ok(langsResponse)
    }
    if (langsResponse.data?.["output-data-kind"] !== "error") {
      Logger.error("Unexpected data in error response.", JSON.stringify(langsResponse, null, 2))
      return Err(new BaseError("Unexpected data in error response"))
    }

    // after this point, we know we have an error
    const data = langsResponse.data
    const message = langsResponse.message
    const traceString = data["output-data"].trace.join("\n")
    const errorKind = data["output-data"].kind
    switch (errorKind) {
      case "connection-error":
        return Err(new ConnectionError(message, traceString))
      case "forbidden":
        return Err(new ForbiddenError(message, traceString))
      case "not-enrolled": {
        // Not hardcoded to courses.mooc.fi: this error kind can come from either backend.
        const siteName =
          authEventTarget === "tmc"
            ? "tmc.mooc.fi"
            : authEventTarget === "mooc"
              ? "courses.mooc.fi"
              : "the server"
        return Err(
          new NotEnrolledError(
            `You are no longer enrolled on this course on ${siteName}, so its` +
              ` exercises can't be fetched. Enroll on the course again from` +
              ` ${siteName}, then reload the course here.`,
            traceString,
          ),
        )
      }
      case "invalid-token":
        this._responseCache.clear()
        this._fireUnexpectedLogout(authEventTarget)
        return Err(new InvalidTokenError(message))
      case "not-logged-in":
        this._responseCache.clear()
        this._fireUnexpectedLogout(authEventTarget)
        return Err(new AuthorizationError(message, traceString))
      case "obsolete-client":
        return Err(
          new ObsoleteClientError(
            message +
              "\nYour TMC Extension is out of date, please update it." +
              "\nhttps://code.visualstudio.com/docs/editor/extension-gallery",
            traceString,
          ),
        )
    }

    return Err(new RuntimeError(message, traceString))
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
    const { args, env, obfuscate, onStderr, onStdout, stdin, processTimeout } = commandArgs

    let theResult: OutputData | undefined
    let stdoutBuffer = ""
    // Last CliOutput schema-validation failure, if any — lets a process that ends without
    // output data report *why* instead of a generic "no result data" message.
    let lastSchemaValidationFailure: { issueSummary: string; outputKind: unknown } | undefined

    const obfuscatedArgs = args.map((x, i) => (obfuscate?.includes(i) ? "***" : x))
    const loggableCommand = [this.cliPath]
      .concat(obfuscatedArgs)
      .map((x) => JSON.stringify(x))
      .join(" ")

    // override settings with environment variables, mainly for testing
    const tmcBackendUrl = process.env.TMC_LANGS_TMC_ROOT_URL ?? TMC_BACKEND_URL
    const moocBackendUrl = process.env.TMC_LANGS_MOOC_ROOT_URL ?? MOOC_BACKEND_URL
    const tmcLangsConfigDir = process.env.TMC_LANGS_CONFIG_DIR ?? this._options.cliConfigDir

    Logger.info(`Running ${loggableCommand}`)
    Logger.debug(`TMC backend at ${tmcBackendUrl}`)
    Logger.debug(`MOOC backend at ${moocBackendUrl}`)
    Logger.debug(`Config dir at ${tmcLangsConfigDir}`)

    let active = true
    let interrupted = false
    let cprocess
    try {
      cprocess = cp.spawn(this.cliPath, args, {
        env: {
          ...process.env,
          ...env,
          RUST_LOG: "debug,rustls=warn,reqwest=warn",
          TMC_LANGS_TMC_ROOT_URL: tmcBackendUrl,
          TMC_LANGS_MOOC_ROOT_URL: moocBackendUrl,
          TMC_LANGS_CONFIG_DIR: tmcLangsConfigDir,
        },
      })
    } catch (error) {
      return Err(new SpawnError(error, "Failed to run tmc-langs-cli"))
    }
    if (stdin) {
      cprocess.stdin.write(stdin + "\n")
    }

    const stderr: string[] = []
    const processResult = new Promise<number | null>((resolve, reject) => {
      let resultCode: number | undefined
      let stdoutEnded = false

      const timeout =
        processTimeout &&
        setTimeout(() => {
          kill(cprocess.pid as number)
          reject("Process didn't seem to finish or was taking a really long time.")
        }, processTimeout)

      cprocess.on("error", (error) => {
        if (timeout) {
          clearTimeout(timeout)
        }
        // macOS error -88 indicates an architecture (Rosetta) mismatch
        if ("errno" in error && error.errno === -88) {
          error.message = `A compatibility error was detected.
If you're on macOS: Try installing Rosetta by running \`softwareupdate --install-rosetta\` in the terminal. (See https://support.apple.com/en-us/102527).
${error.message}`
        }
        reject(error)
      })
      cprocess.stderr.on("data", (chunk) => {
        const data = chunk.toString()
        Logger.warn("stderr", data)
        stderr.push(data)
        onStderr?.(data)
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
        resultCode = code ?? 0
        if (stdoutEnded) {
          if (timeout) {
            clearTimeout(timeout)
          }
          resolve(code)
        }
      })
      cprocess.stdout.on("data", (chunk) => {
        const data = chunk.toString()
        const parts = (stdoutBuffer + data).split("\n")
        stdoutBuffer = parts.pop() || ""
        for (const part of parts) {
          try {
            const trimmed = part.trim()
            if (!trimmed) {
              continue
            }
            const json = JSON.parse(trimmed)
            const validation = CliOutput.safeParse(json)
            if (!validation.success) {
              const issueSummary = z.prettifyError(validation.error)
              const outputKind =
                json && typeof json === "object" && "output-kind" in json
                  ? (json as { "output-kind": unknown })["output-kind"]
                  : undefined
              lastSchemaValidationFailure = { issueSummary, outputKind }
              Logger.error("TMC-langs response didn't match expected type:", issueSummary)
              Logger.debug(json)
              continue
            }
            const output = validation.data

            switch (output["output-kind"]) {
              case "output-data":
                theResult = output
                break
              case "status-update":
                onStdout?.(output)
                break
              case "notification":
                break
              default:
                Logger.error("TMC-langs returned invalid `output-kind`:", output["output-kind"])
                Logger.debug(output)
            }
          } catch (e) {
            Logger.warn(`Failed to parse TMC-langs output`, e)
            Logger.debug(part)
          }
        }
      })
    })

    const result = (async (): LangsProcessRunner["result"] => {
      try {
        await processResult
      } catch (error) {
        return Err(new RuntimeError(error as string))
      }

      if (interrupted) {
        return Err(new RuntimeError("TMC Langs process was killed."))
      }

      if (stdoutBuffer !== "") {
        Logger.warn("Failed to parse some TMC Langs output")
        Logger.debug(stdoutBuffer)
      }

      if (theResult) {
        return Ok(theResult)
      }
      if (lastSchemaValidationFailure) {
        return Err(
          new LangsResponseSchemaError(
            `Langs process ended without result data because its output didn't match the ` +
              `expected schema (output-kind: ${JSON.stringify(lastSchemaValidationFailure.outputKind)}): ` +
              `${lastSchemaValidationFailure.issueSummary}`,
          ),
        )
      }
      return Err(
        new EmptyLangsResponseError(
          `Langs process ended without result data. stderr: {${stderr.join("\n")}}`,
        ),
      )
    })()

    const interrupt = (): void => {
      if (active) {
        active = false
        interrupted = true
        kill(cprocess.pid as number)
      }
    }
    const res = { interrupt, result }
    return Ok(res)
  }
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

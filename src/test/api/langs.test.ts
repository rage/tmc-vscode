import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { OutputData, OutputResult } from "../../../shared/langsSchema"
import { CliOutputData } from "../../../shared/langsSchema"
import type { BaseError } from "../../../shared/lib"
import { makeMoocKind, makeTmcKind } from "../../../shared/lib"
import Langs, { decodeLangsStdout } from "../../api/langs"
import { LOGIN_PROCESS_TIMEOUT, MINIMUM_SUBMISSION_INTERVAL } from "../../config/constants"
import {
  ArchiveTooLargeError,
  AuthorizationError,
  CertificateError,
  ConnectionTimeoutError,
  ExecutableBlockedError,
  FileAccessError,
  InvalidRequestError,
  LegacyTmcLoginEndedError,
  LocalConfigCorruptError,
  LoginClientRejectedError,
  ProjectsDirUnreachableError,
  ProxyError,
  TmcLoginUnconfirmedError,
  ToolchainMissingError,
  UnexpectedResponseError,
  UnsupportedExerciseError,
  ChapterLockedError,
  ExerciseLockedError,
  ChapterNotOpenError,
  ConnectionError,
  DeadlinePassedError,
  DeviceLoginDeniedError,
  DeviceLoginExpiredError,
  ExerciseNotFoundError,
  ForbiddenError,
  InsufficientScopeError,
  InvalidTokenError,
  NotEnrolledError,
  NotFoundError,
  isSessionLost,
  presentationFor,
  ObsoleteClientError,
  OutOfTriesError,
  RateLimitedError,
  RuntimeError,
  ServerError,
  TmcLoginNotAcceptedError,
  UnknownUploadError,
  UploadExpiredError,
} from "../../errors"
import { courseData, courseDetails, moocCourse, submissionFinished } from "../fixtures/cliOutput"
import { idOfMoocCourse, idOfMoocExercise, idOfTmcExercise } from "../fixtures/identifiers"

// `_spawnLangsProcess` is private; casting to `any` stubs it without spawning the CLI.

// Records each invocation's argv and short-circuits before spawning.
function spyOnSpawn(langs: Langs): { args: string[] }[] {
  const calls: { args: string[] }[] = []
  // oxlint-disable-next-line typescript/no-explicit-any
  vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
    calls.push(commandArgs as { args: string[] })
    return Err(new Error("stopped before spawning a real process"))
  })
  return calls
}

// Stubs the spawn with a caller-provided response per invocation.
function stubSpawn(
  langs: Langs,
  respond: (callIndex: number, args: string[]) => Result<OutputData, BaseError>,
  stderr = "",
): { args: string[] }[] {
  const calls: { args: string[] }[] = []
  // oxlint-disable-next-line typescript/no-explicit-any
  vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
    const args = (commandArgs as { args: string[] }).args
    const index = calls.length
    calls.push({ args })
    return Ok({
      interrupt: (): void => {},
      result: Promise.resolve(respond(index, args)),
      getStderr: (): string => stderr,
    })
  })
  return calls
}

// Fixtures go through the schema `Langs` validates CLI stdout with, so a payload the CLI
// could not emit fails where it is written.
function cliOutput(value: unknown): OutputData {
  return CliOutputData.parse(value)
}

function errorOutput(
  kind: unknown,
  message = "boom",
  trace = ["trace line"],
  httpStatus?: number,
): OutputData {
  return cliOutput({
    "output-kind": "output-data",
    status: "finished",
    message,
    result: "error",
    data: {
      "output-data-kind": "error",
      "output-data": {
        kind,
        trace,
        ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
      },
    },
  })
}

const TASK_SUBMISSION_ID = "6f1f5a52-4c1b-4a4e-9b8e-0d6c3f3c2a11"
const SLIDE_ID = "0b7e3d2c-9a51-4f7e-8f55-2c7a1e6d9b40"
const moocSubmitted = {
  task_submission_id: TASK_SUBMISSION_ID,
  slide_submission_id: SLIDE_ID,
  exercise_page_url: null,
}

function dataOutput(kind: string, data: unknown): OutputData {
  return cliOutput({
    "output-kind": "output-data",
    status: "finished",
    message: "ok",
    result: "executed-command",
    data: { "output-data-kind": kind, "output-data": data },
  })
}

// The `tmc-config` payload keeps settings in a flattened table the contract does not
// declare, so `cliOutput` would drop them; the real decoder keeps them.
function decodedOutput(line: unknown): OutputData {
  const { events } = decodeLangsStdout("", JSON.stringify(line) + "\n")
  const output = events.flatMap((event) => (event.kind === "output-data" ? [event.output] : []))
  expect(output).toHaveLength(1)
  return output[0] as OutputData
}

/** An output with no data: an `executed-command` reporting nothing, or a login-state result. */
function nullOutput(message = "ok", result: OutputResult = "executed-command"): OutputData {
  return cliOutput({
    "output-kind": "output-data",
    status: "finished",
    message,
    result,
    data: null,
  })
}

// The mooc contract types ids as UUIDs; these are valid v4 UUIDs ending in `n`.
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

const MOOC_RESTORE_TARGET = makeMoocKind({ exerciseId: "ex-uuid", submissionId: "sub-uuid" })

function newLangs(): Langs {
  return new Langs("dummy-cli-path", "test-client", "1.0.0")
}

afterEach(function () {
  vi.restoreAllMocks()
})

suite("Langs class arg building", function () {
  test("getTmcCourseData builds the tmc --course-id from the numeric course id", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getTmcCourseData(42)
    const args = calls[0]?.args ?? []
    expect(args[0]).toBe("tmc")
    expect(args[args.indexOf("--course-id") + 1]).toBe("42")
  })

  test("checkExerciseUpdates (mooc)", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.checkExerciseUpdates("mooc")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "check-exercise-updates",
    ])
  })

  test("getEnrolledMoocCourses", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getEnrolledMoocCourses()
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "courses",
    ])
  })

  test("setSetting passes the value base64-encoded", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.setSetting("closed-exercises-for:course", ["part01-01", "part01-02"])
    expect(calls[0]?.args).toEqual([
      "settings",
      "--client-name",
      "test-client",
      "set",
      "closed-exercises-for:course",
      Buffer.from('["part01-01","part01-02"]').toString("base64"),
      "--base64",
    ])
  })

  test("listSettings reads the whole settings file in one command", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.listSettings()
    expect(calls[0]?.args).toEqual(["settings", "--client-name", "test-client", "list"])
  })

  test("listSettings returns the keys the contract leaves undeclared", async function () {
    const langs = newLangs()
    const settings = {
      projects_dir: "/projects",
      "closed-exercises-for:tmc:python": ["part01-01"],
      "closed-exercises-for:mooc:course-uuid": [],
    }
    stubSpawn(langs, () =>
      Ok(
        decodedOutput({
          "output-kind": "output-data",
          status: "finished",
          message: "retrieved settings",
          result: "executed-command",
          data: { "output-data-kind": "tmc-config", "output-data": settings },
        }),
      ),
    )
    const result = await langs.listSettings()
    expect(result.ok).toBe(true)
    expect(result.unwrap()).toEqual(settings)
  })

  test("getOldSubmissions builds the mooc command from a mooc exercise id", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getOldSubmissions(idOfMoocExercise("ex-uuid"))
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "get-exercise-submissions",
      "--exercise-id",
      "ex-uuid",
    ])
  })

  test("getMoocCourseData fetches the course, its slides and progress in one command", async function () {
    const langs = newLangs()
    const combined = {
      course: { ...moocCourse, id: uuid(1) },
      slides: [],
      progress: { course_id: uuid(1), exercises: [], closed_chapters: [] },
    }
    const calls = stubSpawn(langs, () => Ok(dataOutput("mooc-combined-course-data", combined)))
    const result = await langs.getMoocCourseData(uuid(1))
    expect(calls.map((x) => x.args)).toEqual([
      [
        "mooc",
        "--client-name",
        "test-client",
        "--client-version",
        "1.0.0",
        "course-data",
        "--course-id",
        uuid(1),
      ],
    ])
    expect(result.unwrap()).toEqual(combined)
  })

  test("paste builds the mooc command from a mooc exercise id", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.paste(idOfMoocExercise("ex-uuid"), "/path/to/ex")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "paste",
      "--exercise-id",
      "ex-uuid",
      "--submission-path",
      "/path/to/ex",
    ])
  })

  test("submitMoocExercise submits without waiting for the grading", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.submitMoocExercise("ex-uuid", "/path/to/ex")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "submit",
      "--dont-block",
      "--exercise-id",
      "ex-uuid",
      "--submission-path",
      "/path/to/ex",
    ])
  })

  test("submitMoocExercise returns the submission's ids", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-finished", moocSubmitted)))
    const result = await langs.submitMoocExercise("ex-uuid", "/path/to/ex")
    expect(result.unwrap()).toEqual(moocSubmitted)
  })

  test.each([
    ["submitMoocExercise", (langs: Langs) => langs.submitMoocExercise("ex-uuid", "/path/to/ex")],
    ["paste", (langs: Langs) => langs.paste(idOfMoocExercise("ex-uuid"), "/path/to/ex")],
  ] as const)("%s reports the exercise being gone", async function (_name, call) {
    const langs = newLangs()
    const line =
      "HTTP error 404 Not Found for https://courses.mooc.fi/api/v0/exercise-services/client/" +
      'exercises/ex-uuid: {"title":"Not Found"}. Obsolete client: false.'
    stubSpawn(langs, () => Ok(errorOutput("exercise-not-found", line, [`Caused by: ${line}`], 404)))
    const result = await call(langs)
    expect(result.val).toBeInstanceOf(ExerciseNotFoundError)
    expect((result.val as Error).message).toBe(line)
    expect(presentationFor(result.val as Error).message).toBe(
      "This exercise is no longer in the course. Refresh the courses to see its exercises.",
    )
    expect((result.val as ExerciseNotFoundError).details).toContain(line)
  })

  test("waitForMoocGrading polls the task submission's grading", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.waitForMoocGrading(TASK_SUBMISSION_ID)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "wait-for-grading",
      "--submission-id",
      TASK_SUBMISSION_ID,
    ])
  })

  test("waitForMoocGrading returns the grading status", async function () {
    const langs = newLangs()
    const grading = {
      status: "grading",
      grading: {
        grading_progress: "FullyGraded",
        score_given: 1,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: "2026-07-21T00:00:01Z",
        feedback_text: "All tests passed",
        exercise_progress: null,
        test_results: null,
        submission_page_url: null,
      },
    }
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-status", grading)))
    const result = await langs.waitForMoocGrading(TASK_SUBMISSION_ID)
    expect(result.unwrap()).toEqual(grading)
  })

  test("waitForMoocGrading is not throttled like a submit", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-status", { status: "no-grading-yet" })))
    expect((await langs.waitForMoocGrading(TASK_SUBMISSION_ID)).ok).toBe(true)
    expect((await langs.waitForMoocGrading(TASK_SUBMISSION_ID)).ok).toBe(true)
  })

  test("waitForMoocGrading forwards progress updates", async function () {
    const langs = newLangs()
    // oxlint-disable-next-line typescript/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      const { onStdout } = commandArgs as {
        onStdout?: (data: unknown) => void
      }
      onStdout?.({
        "update-data-kind": "none",
        "percent-done": 0.5,
        message: "Grading in progress",
      })
      return Ok({
        interrupt: (): void => {},
        getStderr: (): string => "",
        result: Promise.resolve(
          Ok(dataOutput("mooc-submission-status", { status: "no-grading-yet" })) as Result<
            OutputData,
            BaseError
          >,
        ),
      })
    })
    const progress: { fraction: number; message: string | undefined }[] = []
    await langs.waitForMoocGrading(TASK_SUBMISSION_ID, (fraction, message) =>
      progress.push({ fraction, message }),
    )
    expect(progress).toEqual([{ fraction: 0.5, message: "Grading in progress" }])
  })

  test("getOldSubmissions parses the mooc-submissions list", async function () {
    const langs = newLangs()
    stubSpawn(langs, () =>
      Ok(
        dataOutput("mooc-submissions", [
          {
            id: uuid(2),
            exercise_id: uuid(9),
            created_at: "2026-07-21T12:00:00Z",
            score_given: 1,
            grading_progress: "FullyGraded",
            kind: "submission",
            is_shared: false,
          },
          {
            id: uuid(1),
            exercise_id: uuid(9),
            created_at: "2026-07-21T10:00:00Z",
            score_given: 0,
            grading_progress: "Failed",
            kind: "submission",
            is_shared: false,
          },
        ]),
      ),
    )
    const listed = (await langs.getOldSubmissions(idOfMoocExercise("ex-uuid"))).unwrap()
    if (listed.kind !== "mooc") {
      throw new Error("expected the mooc listing")
    }
    const { submissions } = listed.data
    expect(submissions).toHaveLength(2)
    expect(submissions[0]?.id).toBe(uuid(2))
    expect(submissions[0]?.grading_progress).toBe("FullyGraded")
    expect(submissions[1]?.score_given).toBe(0)
  })

  test("restoreSubmission includes --save-old-state when asked", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.restoreSubmission(MOOC_RESTORE_TARGET, "/path", true)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "download-old-submission",
      "--submission-id",
      "sub-uuid",
      "--save-old-state",
      "--exercise-id",
      "ex-uuid",
      "--output-path",
      "/path",
    ])
  })

  test("restoreSubmission reports a submission with no downloadable files", async function () {
    // The CLI reports `nothing-to-download` rather than failing.
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-old-submission-restore", "nothing-to-download")))
    const result = await langs.restoreSubmission(MOOC_RESTORE_TARGET, "/path", true)
    expect(result.ok).toBe(true)
    expect(result.unwrap()).toBe("nothing-to-download")
  })

  test("restoreSubmission reports a restored submission", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-old-submission-restore", "restored")))
    const result = await langs.restoreSubmission(MOOC_RESTORE_TARGET, "/path", false)
    expect(result.unwrap()).toBe("restored")
  })

  test("restoreSubmission reads a tmc restore, which reports no outcome, as restored", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput()))
    const result = await langs.restoreSubmission(
      makeTmcKind({ exerciseId: 7, submissionId: 3 }),
      "/path",
      false,
    )
    expect(result.unwrap()).toBe("restored")
    expect(calls[0]?.args.slice(-6)).toEqual([
      "--submission-id",
      "3",
      "--exercise-id",
      "7",
      "--output-path",
      "/path",
    ])
  })

  test("downloadMoocExercises runs the mooc subcommand", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] })),
    )
    await langs.downloadMoocExercises(["exercise-uuid"], undefined, () => {})
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "download-or-update-course-exercises",
      "--exercise-id",
      "exercise-uuid",
    ])
  })

  test("downloadMoocExercises forwards --course-id when a course id is given", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] })),
    )
    await langs.downloadMoocExercises(["exercise-uuid"], "course-uuid", () => {})
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "download-or-update-course-exercises",
      "--course-id",
      "course-uuid",
      "--exercise-id",
      "exercise-uuid",
    ])
  })

  test("resetExercise routes tmc ids through the tmc reset-exercise command", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput()))
    const result = await langs.resetExercise(idOfTmcExercise(42), "/path/to/ex", false)
    expect(result.ok).toBe(true)
    expect(calls[0]?.args).toEqual([
      "tmc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "reset-exercise",
      "--exercise-id",
      "42",
      "--exercise-path",
      "/path/to/ex",
    ])
  })

  test("resetExercise routes mooc ids through the mooc reset-exercise command", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput()))
    const result = await langs.resetExercise(idOfMoocExercise("ex-uuid"), "/path/to/ex", false)
    expect(result.ok).toBe(true)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "reset-exercise",
      "--exercise-id",
      "ex-uuid",
      "--exercise-path",
      "/path/to/ex",
    ])
  })

  test("resetExercise includes --save-old-state when asked (mooc)", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput()))
    await langs.resetExercise(idOfMoocExercise("ex-uuid"), "/path/to/ex", true)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "reset-exercise",
      "--save-old-state",
      "--exercise-id",
      "ex-uuid",
      "--exercise-path",
      "/path/to/ex",
    ])
  })

  test("downloadMoocExercises forwards per-exercise progress updates", async function () {
    const langs = newLangs()
    // oxlint-disable-next-line typescript/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      const { onStdout } = commandArgs as { onStdout?: (data: unknown) => void }
      onStdout?.({
        "update-data-kind": "mooc-client-update-data",
        "percent-done": 0.5,
        message: "Downloading exercise",
        data: {
          "client-update-data-kind": "exercise-download",
          id: "ex-uuid",
          path: "/path/to/ex",
        },
      })
      return Ok({
        interrupt: (): void => {},
        getStderr: (): string => "",
        result: Promise.resolve(
          Ok(
            dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] }),
          ) as Result<OutputData, BaseError>,
        ),
      })
    })
    const downloaded: { id: unknown; fraction: number; message?: string | undefined }[] = []
    await langs.downloadMoocExercises(["ex-uuid"], undefined, (value) => downloaded.push(value))
    expect(downloaded).toHaveLength(1)
    expect(downloaded[0]?.fraction).toBe(0.5)
    expect(downloaded[0]?.message).toBe("Downloading exercise")
    expect(downloaded[0]?.id).toEqual(idOfMoocExercise("ex-uuid"))
  })

  test("moveProjectsDirectory forwards the CLI's completion fraction unscaled", async function () {
    const langs = newLangs()
    // oxlint-disable-next-line typescript/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      const { onStdout } = commandArgs as { onStdout?: (data: unknown) => void }
      onStdout?.({
        "update-data-kind": "none",
        "percent-done": 0.25,
        message: "Moving exercises",
      })
      return Ok({
        interrupt: (): void => {},
        getStderr: (): string => "",
        result: Promise.resolve(Ok(nullOutput()) as Result<OutputData, BaseError>),
      })
    })
    const updates: { fraction: number; message?: string | undefined }[] = []
    await langs.moveProjectsDirectory("/new/dir", (update) => updates.push(update))
    expect(updates).toEqual([{ fraction: 0.25, message: "Moving exercises" }])
  })

  test("authenticate builds the `mooc login` command", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    langs.authenticate(() => {})
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "login",
    ])
  })

  // The device flow can take minutes; the CLI reports the code's expiry itself.
  test("authenticate outlasts the device code", async function () {
    const langs = newLangs()
    let captured: { processTimeout?: number } | undefined
    // oxlint-disable-next-line typescript/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      captured = commandArgs as { processTimeout?: number }
      return Err(new Error("stopped before spawning a real process"))
    })
    langs.authenticate(() => {})
    expect(captured?.processTimeout).toBe(LOGIN_PROCESS_TIMEOUT)
  })

  test("authenticate surfaces the device-login status update and resolves on success", async function () {
    const langs = newLangs()
    const deviceInfo = {
      verification_uri: "https://courses.mooc.fi/oauth_device",
      verification_uri_complete: "https://courses.mooc.fi/oauth_device?user_code=ABCD-EFGH",
      user_code: "ABCD-EFGH",
      expires_in: 900,
      interval: 5,
    }
    // oxlint-disable-next-line typescript/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      const { onStdout } = commandArgs as { onStdout?: (data: unknown) => void }
      onStdout?.({
        "update-data-kind": "mooc-device-login",
        finished: false,
        message: "Waiting for device authorization",
        "percent-done": 0,
        time: 0,
        data: deviceInfo,
      })
      return Ok({
        interrupt: (): void => {},
        getStderr: (): string => "",
        result: Promise.resolve(
          Ok({
            "output-kind": "output-data",
            status: "finished",
            message: "logged in",
            result: "logged-in",
            data: null,
          }) as Result<OutputData, BaseError>,
        ),
      })
    })
    const seen: unknown[] = []
    const { result } = langs.authenticate((info) => seen.push(info))
    const res = await result
    expect(res.ok).toBe(true)
    expect(seen).toEqual([deviceInfo])
  })

  test.each([
    ["device-login-denied", DeviceLoginDeniedError],
    ["device-login-expired", DeviceLoginExpiredError],
  ] as const)("authenticate reports %s as its own error", async function (kind, errorClass) {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, () => Ok(errorOutput(kind)))
    const { result } = langs.authenticate(() => {})
    const res = await result
    expect(res.err).toBe(true)
    expect(res.val).toBeInstanceOf(errorClass)
    expect(onLogout).not.toHaveBeenCalled()
  })

  test("getStudentFilePaths reads the exercise's packaging configuration", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(
        dataOutput("exercise-packaging-configuration", {
          student_file_paths: ["src", "lib/helper.py"],
          exercise_file_paths: ["test"],
        }),
      ),
    )
    const res = await langs.getStudentFilePaths("/p/hello_world")
    expect(calls[0]?.args).toEqual([
      "get-exercise-packaging-configuration",
      "--exercise-path",
      "/p/hello_world",
    ])
    expect(res.unwrap()).toEqual(["src", "lib/helper.py"])
  })

  test("listLocalExercises asks for every course and both backends in one call", async function () {
    const langs = newLangs()
    const tmcExercise = {
      "course-slug": "python-course",
      "course-id": 1,
      "exercise-slug": "hello_world",
      "exercise-id": 1,
      "exercise-path": "/p/hello_world",
    }
    const moocExercise = {
      "course-slug": "mooc-python-course",
      "course-id": uuid(1),
      "exercise-slug": "mooc_hello",
      "exercise-id": uuid(2),
      "exercise-path": "/p/mooc_hello",
    }
    const calls = stubSpawn(langs, () =>
      Ok(
        dataOutput("local-exercises", [
          { backend: "tmc", ...tmcExercise },
          { backend: "mooc", ...moocExercise },
        ]),
      ),
    )
    const res = await langs.listLocalExercises()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual(["list-local-exercises", "--client-name", "test-client"])
    expect(res.unwrap()).toEqual([
      { backend: "tmc", ...tmcExercise },
      { backend: "mooc", ...moocExercise },
    ])
  })
})

suite("Langs cross-backend independence", function () {
  test("a tmc submission throttle does not block a mooc submission", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("submission-finished", submissionFinished)))
    const firstTmc = await langs.submitTmcExerciseAndWaitForResults(1, "/path/to/ex")
    expect(firstTmc.ok).toBe(true)

    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-finished", moocSubmitted)))
    const mooc = await langs.submitMoocExercise("ex-uuid", "/path/to/ex")
    expect(mooc.ok).toBe(true)
  })

  test("a mooc submission throttle does not block a tmc submission", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-finished", moocSubmitted)))
    const firstMooc = await langs.submitMoocExercise("ex-uuid", "/path/to/ex")
    expect(firstMooc.ok).toBe(true)

    stubSpawn(langs, () => Ok(dataOutput("submission-finished", submissionFinished)))
    const tmc = await langs.submitTmcExerciseAndWaitForResults(1, "/path/to/ex")
    expect(tmc.ok).toBe(true)
  })

  test("downloadTmcExercises reports each exercise by id and path", async function () {
    const langs = newLangs()
    const exercise = { id: 1, "course-slug": "c", "exercise-slug": "e", path: "/p/e" }
    stubSpawn(langs, () =>
      Ok(
        dataOutput("tmc-exercise-download", {
          downloaded: [exercise],
          skipped: [],
          failed: [[{ ...exercise, id: 2, path: "/p/f" }, ["no space left"]]],
        }),
      ),
    )
    const result = await langs.downloadTmcExercises([1, 2], true, () => {})
    expect(result.unwrap()).toEqual({
      downloaded: [{ id: idOfTmcExercise(1), path: "/p/e" }],
      skipped: [],
      failed: [[{ id: idOfTmcExercise(2), path: "/p/f" }, ["no space left"], undefined]],
    })
  })

  // A call that never reached the server submitted nothing, so it must not cost a retry.
  test("a submission that never reached the backend frees its throttle slot", async function () {
    const langs = newLangs()
    stubSpawn(langs, (i) =>
      i === 0
        ? Ok(errorOutput("connection-error"))
        : Ok(dataOutput("mooc-submission-finished", moocSubmitted)),
    )
    expect((await langs.submitMoocExercise("ex-uuid", "/path/to/ex")).err).toBe(true)
    expect((await langs.submitMoocExercise("ex-uuid", "/path/to/ex")).ok).toBe(true)
  })

  test("a submission the backend refused keeps its throttle slot", async function () {
    vi.useFakeTimers()
    try {
      const langs = newLangs()
      const calls = stubSpawn(langs, () => Ok(errorOutput("server-error", "boom", ["trace"], 500)))
      await langs.submitMoocExercise("ex-uuid", "/path/to/ex")
      void langs.submitMoocExercise("ex-uuid", "/path/to/ex")
      await vi.advanceTimersByTimeAsync(MINIMUM_SUBMISSION_INTERVAL - 1)
      expect(calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test("a mooc paste or backup right after a submission waits for nothing", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, (_i, args) =>
      args.includes("submit")
        ? Ok(dataOutput("mooc-submission-finished", moocSubmitted))
        : args.includes("paste")
          ? Ok(dataOutput("mooc-paste", { paste_url: "https://courses.example/paste" }))
          : Ok(dataOutput("mooc-old-submission-restore", "restored")),
    )
    expect((await langs.submitMoocExercise("ex-uuid", "/path/to/ex")).ok).toBe(true)

    vi.useFakeTimers()
    try {
      expect((await langs.paste(idOfMoocExercise("ex-uuid"), "/path/to/ex")).ok).toBe(true)
      expect((await langs.resetExercise(idOfMoocExercise("ex-uuid"), "/path/to/ex", true)).ok).toBe(
        true,
      )
      expect(calls).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  test("a submission right after another waits out the interval, then goes through", async function () {
    vi.useFakeTimers()
    try {
      const langs = newLangs()
      const calls = stubSpawn(langs, () =>
        Ok(dataOutput("mooc-submission-finished", moocSubmitted)),
      )
      expect((await langs.submitMoocExercise("ex-uuid", "/path/to/ex")).ok).toBe(true)

      const second = langs.submitMoocExercise("ex-uuid", "/path/to/ex")
      await vi.advanceTimersByTimeAsync(MINIMUM_SUBMISSION_INTERVAL - 1)
      expect(calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)

      expect((await second).ok).toBe(true)
      expect(calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

suite("Langs error-kind mapping", function () {
  const cases: [unknown, new (...args: never[]) => Error][] = [
    ["connection-error", ConnectionError],
    ["forbidden", ForbiddenError],
    ["insufficient-scope", InsufficientScopeError],
    ["exercise-not-found", ExerciseNotFoundError],
    ["invalid-token", InvalidTokenError],
    ["not-logged-in", AuthorizationError],
    ["obsolete-client", ObsoleteClientError],
    ["not-enrolled", NotEnrolledError],
    ["upload-expired", UploadExpiredError],
    ["unknown-upload", UnknownUploadError],
    ["rate-limited", RateLimitedError],
    ["deadline-passed", DeadlinePassedError],
    ["out-of-tries", OutOfTriesError],
    ["chapter-not-open-yet", ChapterNotOpenError],
    ["chapter-not-unlocked-yet", ChapterLockedError],
    ["chapter-completed-and-locked", ChapterLockedError],
    ["exercise-locked", ExerciseLockedError],
    ["device-login-denied", DeviceLoginDeniedError],
    ["device-login-expired", DeviceLoginExpiredError],
    ["not-found", NotFoundError],
    ["server-error", ServerError],
    ["generic", RuntimeError],
  ]
  for (const [kind, errorClass] of cases) {
    test(`maps ${String(kind)} to ${errorClass.name}`, async function () {
      const langs = newLangs()
      stubSpawn(langs, () => Ok(errorOutput(kind)))
      const result = await langs.getEnrolledMoocCourses()
      expect(result.err).toBe(true)
      expect(result.val).toBeInstanceOf(errorClass)
    })

    // invalid-token is a clean signal that needs no diagnostics.
    if (kind !== "invalid-token") {
      test(`${String(kind)} carries the CLI trace and the process stderr`, async function () {
        const langs = newLangs()
        stubSpawn(langs, () => Ok(errorOutput(kind)), "stderr line")
        const result = await langs.getEnrolledMoocCourses()
        const details = (result.val as BaseError).details ?? ""
        expect(details).toContain("trace line")
        expect(details).toContain("stderr line")
      })
    }
  }

  test.each([
    ["deadline-passed", "The deadline of this exercise has passed"],
    ["out-of-tries", "You have no tries left on this exercise"],
    ["chapter-not-open-yet", "This exercise's chapter has not opened yet"],
    ["chapter-not-unlocked-yet", "Complete the chapters before this exercise's chapter"],
    ["chapter-completed-and-locked", "This exercise's chapter is locked"],
    ["exercise-locked", "The teacher has locked this exercise"],
  ])("a %s refusal says so plainly, never as a lost login", async function (kind, message) {
    const onLogout = vi.fn()
    const langs = newLangs()
    langs.on("logout", onLogout)
    stubSpawn(langs, () => Ok(errorOutput(kind, "422 from https://courses.mooc.fi/…")))
    const result = await langs.getEnrolledMoocCourses()
    expect(presentationFor(result.val as Error).message).toContain(message)
    expect(isSessionLost(result.val as Error)).toBe(false)
    expect(onLogout).not.toHaveBeenCalled()
  })

  test("an underscoped session is not a course the user may not see", async function () {
    // `updateCourse` persists a `ForbiddenError` as a disabled course.
    const langs = newLangs()
    stubSpawn(langs, () => Ok(errorOutput("insufficient-scope")))
    const result = await langs.getEnrolledMoocCourses()
    expect(result.val).not.toBeInstanceOf(ForbiddenError)
  })

  test.each([
    ["not-found", NotFoundError, 404],
    ["server-error", ServerError, 503],
    ["generic", RuntimeError, 409],
  ] as const)(
    "%s carries the HTTP status the CLI reports",
    async function (kind, errorClass, status) {
      const langs = newLangs()
      stubSpawn(langs, () => Ok(errorOutput(kind, "Failed to get courses", undefined, status)))
      const result = await langs.getEnrolledMoocCourses()
      expect(result.val).toBeInstanceOf(errorClass)
      expect((result.val as NotFoundError | ServerError | RuntimeError).httpStatus).toBe(status)
    },
  )

  test("a cause the CLI lists twice in a row appears once in the details", async function () {
    const langs = newLangs()
    const trace = ["Caused by: outer", "Caused by: inner", "Caused by: inner"]
    stubSpawn(langs, () => Ok(errorOutput("generic", "outer", trace)))
    const result = await langs.getEnrolledMoocCourses()
    expect((result.val as RuntimeError).details).toBe("Caused by: outer\nCaused by: inner")
  })

  test("an error the CLI reports no HTTP status for has none", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(errorOutput("generic", "HTTP error 404 quoted in a message")))
    const result = await langs.getEnrolledMoocCourses()
    expect((result.val as RuntimeError).httpStatus).toBeUndefined()
  })

  test("an error kind carries the CLI's message and no remediation of its own", async function () {
    // `presentationFor` owns the user-facing sentences.
    for (const kind of [
      "forbidden",
      "not-enrolled",
      "upload-expired",
      "obsolete-client",
      "deadline-passed",
      "rate-limited",
      "file-in-use",
      "toolchain-missing",
    ]) {
      const langs = newLangs()
      stubSpawn(langs, () => Ok(errorOutput(kind, "Failed to get course")))
      const result = await langs.getEnrolledMoocCourses()
      expect((result.val as Error).message).toBe("Failed to get course")
    }
  })

  test("an error names the backend the command talked to", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(errorOutput("server-error", "boom", ["trace"], 503)))

    const mooc = await langs.getEnrolledMoocCourses()
    const tmc = await langs.getTmcOrganizations()
    const local = await langs.listLocalExercises()

    expect((mooc.val as BaseError).backend).toBe("mooc")
    expect((tmc.val as BaseError).backend).toBe("tmc")
    expect((local.val as BaseError).backend).toBeUndefined()
  })

  test("a crashed process is reported as an error", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok({ ...dataOutput("mooc-courses", []), status: "crashed" }))
    const result = await langs.getEnrolledMoocCourses()
    expect(result.err).toBe(true)
  })

  test("invalid-token fires the logout event and keeps the other backend's cache", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    let organizationsCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("get-organizations")) {
        organizationsCalls += 1
        return Ok(dataOutput("organizations", []))
      }
      return Ok(errorOutput("invalid-token"))
    })

    // Prime the cache, hit an invalid-token error, then re-request.
    await langs.getTmcOrganizations()
    expect(organizationsCalls).toBe(1)
    await langs.getTmcOrganizations() // served from cache
    expect(organizationsCalls).toBe(1)

    const result = await langs.getEnrolledMoocCourses()
    expect(result.val).toBeInstanceOf(InvalidTokenError)
    expect(onLogout).toHaveBeenCalledExactlyOnceWith(false, result.val)

    // tmc.mooc.fi did not reject anything, so its data is still good.
    await langs.getTmcOrganizations()
    expect(organizationsCalls).toBe(1)
  })

  test("invalid-token drops the failing backend's own cached data", async function () {
    const langs = newLangs()
    let courseCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("courses")) {
        return Ok(errorOutput("invalid-token"))
      }
      courseCalls += 1
      return Ok(
        dataOutput("mooc-combined-course-data", {
          course: { ...moocCourse, id: uuid(1) },
          slides: [],
          progress: { course_id: uuid(1), exercises: [] },
        }),
      )
    })

    await langs.getMoocCourseData(uuid(1))
    await langs.getMoocCourseData(uuid(1))
    expect(courseCalls).toBe(1)

    expect((await langs.getEnrolledMoocCourses()).err).toBe(true)

    await langs.getMoocCourseData(uuid(1))
    expect(courseCalls).toBe(2)
  })

  test("tmc.mooc.fi refusing the courses.mooc.fi login is no lost session", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, () => Ok(errorOutput("tmc-login-not-accepted")))

    const tmc = await langs.getTmcOrganizations()
    expect(tmc.val).toBeInstanceOf(TmcLoginNotAcceptedError)
    expect(onLogout).not.toHaveBeenCalled()
  })

  test("a refused legacy tmc.mooc.fi login is not reported as logged out", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, () => Ok(errorOutput("invalid-token")))

    const tmc = await langs.getTmcOrganizations()
    expect(tmc.val).toBeInstanceOf(LegacyTmcLoginEndedError)
    expect(onLogout).not.toHaveBeenCalled()
  })

  test("a 429 names the wait, and only a paste blames Get Help", async function () {
    const langs = newLangs()
    const limited = cliOutput({
      "output-kind": "output-data",
      status: "finished",
      message: "boom",
      result: "error",
      data: {
        "output-data-kind": "error",
        "output-data": {
          kind: "rate-limited",
          trace: [],
          retry_after_secs: 90,
          request_id: "req-1",
        },
      },
    })
    stubSpawn(langs, () => Ok(limited))

    const courses = await langs.getEnrolledMoocCourses()
    expect(courses.val).toBeInstanceOf(RateLimitedError)
    expect((courses.val as Error).message).toBe("boom")
    expect(presentationFor(courses.val as Error).message).toBe(
      "The server is receiving too many requests from your network. Try again in 90 seconds.",
    )
    expect((courses.val as RateLimitedError).details).toContain("request id: req-1")

    const paste = await langs.paste(idOfMoocExercise("ex"), "/ex")
    expect(presentationFor(paste.val as Error).message).toBe(
      "You have used Get Help on this exercise too often. Try again in 90 seconds.",
    )
  })

  test("a not-logged-in from either backend ends the session", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, () => Ok(errorOutput("not-logged-in")))

    const tmc = await langs.getTmcOrganizations()
    expect(tmc.val).toBeInstanceOf(AuthorizationError)
    expect(tmc.val).not.toBeInstanceOf(TmcLoginNotAcceptedError)
    expect(onLogout).toHaveBeenCalledExactlyOnceWith(false, tmc.val)
  })

  test.each([
    ["connection-timeout", ConnectionTimeoutError],
    ["certificate-error", CertificateError],
    ["proxy-error", ProxyError],
    ["login-client-rejected", LoginClientRejectedError],
    ["tmc-login-unconfirmed", TmcLoginUnconfirmedError],
    ["unexpected-response", UnexpectedResponseError],
    ["invalid-request", InvalidRequestError],
    ["local-config-corrupt", LocalConfigCorruptError],
    ["archive-too-large", ArchiveTooLargeError],
    ["unsupported-exercise", UnsupportedExerciseError],
    ["toolchain-missing", ToolchainMissingError],
    ["executable-blocked", ExecutableBlockedError],
    ["projects-dir-unreachable", ProjectsDirUnreachableError],
    ["file-in-use", FileAccessError],
    ["permission-denied", FileAccessError],
    ["path-too-long", FileAccessError],
    ["disk-full", FileAccessError],
  ] as const)("%s maps to its own error, never a lost session", async (kind, errorClass) => {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, () => Ok(errorOutput(kind)))

    const result = await langs.getEnrolledMoocCourses()
    expect(result.val).toBeInstanceOf(errorClass)
    expect(onLogout).not.toHaveBeenCalled()
  })

  test("deauthenticate removes both credentials and fires the logout event as expected", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    const calls = stubSpawn(langs, () => Ok(nullOutput("logged out", "logged-out")))

    const result = await langs.deauthenticate()

    expect(result.ok).toBe(true)
    expect(calls.map((x) => x.args)).toEqual([
      ["tmc", "--client-name", "test-client", "--client-version", "1.0.0", "logout"],
      ["mooc", "--client-name", "test-client", "--client-version", "1.0.0", "logout"],
    ])
    expect(onLogout).toHaveBeenCalledExactlyOnceWith(true)
  })

  test("deauthenticate removes the mooc credentials only once tmc's logout has read them", async function () {
    const langs = newLangs()
    let isTmcLogoutDone = false
    let wasTmcLogoutDoneAtMoocLogout: boolean | undefined
    // oxlint-disable-next-line typescript/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      const isTmc = (commandArgs as { args: string[] }).args[0] === "tmc"
      if (!isTmc) {
        wasTmcLogoutDoneAtMoocLogout = isTmcLogoutDone
      }
      return Ok({
        interrupt: (): void => {},
        result: Promise.resolve().then(() => {
          isTmcLogoutDone ||= isTmc
          return Ok(nullOutput("logged out", "logged-out"))
        }),
        getStderr: (): string => "",
      })
    })

    expect((await langs.deauthenticate()).ok).toBe(true)
    expect(wasTmcLogoutDoneAtMoocLogout).toBe(true)
  })

  test("a failed deauthenticate fires no logout event, expected or not", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, (i) => Ok(i === 0 ? nullOutput() : errorOutput("not-logged-in")))

    const result = await langs.deauthenticate()

    expect(result.err).toBe(true)
    expect(onLogout).not.toHaveBeenCalled()
  })

  test("a logout whose revocation failed is done once no login remains", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, (i) =>
      Ok(
        i === 0
          ? nullOutput()
          : i === 1
            ? errorOutput("connection-error")
            : nullOutput("not logged in", "not-logged-in"),
      ),
    )

    const result = await langs.deauthenticate()

    expect(result.ok).toBe(true)
    expect(onLogout).toHaveBeenCalledExactlyOnceWith(true)
  })

  test("isAuthenticated is true on stored courses.mooc.fi credentials without asking tmc", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput("currently logged in", "logged-in")))

    expect((await langs.isAuthenticated()).val).toBe(true)
    expect(calls.map((c) => c.args)).toEqual([
      ["mooc", "--client-name", "test-client", "--client-version", "1.0.0", "logged-in"],
    ])
  })

  test("getMoocAccountId reads the account mooc logged-in reports, if it does", async function () {
    const langs = newLangs()
    const withAccount = {
      ...nullOutput("currently logged in", "logged-in"),
      data: {
        "output-data-kind": "mooc-current-user",
        "output-data": { id: uuid(7), name: null, email: null },
      },
    } satisfies OutputData
    stubSpawn(langs, (i) =>
      Ok(i === 0 ? withAccount : nullOutput("currently logged in", "logged-in")),
    )

    expect((await langs.getMoocAccountId()).val).toBe(uuid(7))
    expect((await langs.getMoocAccountId()).val).toBeUndefined()
  })

  test("isAuthenticated falls back to a stored tmc token", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, (i) =>
      Ok(
        i === 0
          ? nullOutput("currently not logged in", "not-logged-in")
          : nullOutput("currently logged in", "logged-in"),
      ),
    )

    expect((await langs.isAuthenticated()).val).toBe(true)
    expect(calls[1]?.args).toEqual([
      "tmc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "logged-in",
    ])
  })

  test("isAuthenticated returns false when neither backend has a session", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput("currently not logged in", "not-logged-in")))

    expect((await langs.isAuthenticated()).val).toBe(false)
    expect(calls).toHaveLength(2)
  })

  test("isAuthenticated does not guess from tmc when the mooc check fails", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(errorOutput("generic")))

    expect((await langs.isAuthenticated()).err).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

suite("Langs response cache", function () {
  test("serves a second call from cache without re-spawning", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, () => {
      callCount += 1
      return Ok(
        dataOutput("mooc-exercise-updates", {
          updated: [uuid(callCount)],
          removed: [],
          unchecked_courses: [],
        }),
      )
    })
    const first = await langs.checkExerciseUpdates("mooc")
    const second = await langs.checkExerciseUpdates("mooc")
    expect(callCount).toBe(1)
    expect(first.val).toEqual({
      updated: [idOfMoocExercise(uuid(1))],
      removed: [],
      uncheckedCourses: [],
    })
    expect(second.val).toEqual({
      updated: [idOfMoocExercise(uuid(1))],
      removed: [],
      uncheckedCourses: [],
    })
  })

  test("forceRefresh bypasses the cache", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, () => {
      callCount += 1
      return Ok(
        dataOutput("mooc-exercise-updates", {
          updated: [uuid(callCount)],
          removed: [],
          unchecked_courses: [],
        }),
      )
    })
    await langs.checkExerciseUpdates("mooc")
    const refreshed = await langs.checkExerciseUpdates("mooc", { forceRefresh: true })
    expect(callCount).toBe(2)
    expect(refreshed.val).toEqual({
      updated: [idOfMoocExercise(uuid(2))],
      removed: [],
      uncheckedCourses: [],
    })
  })

  test("checkExerciseUpdates names each course courses.mooc.fi refused with its refusal", async function () {
    const langs = newLangs()
    stubSpawn(langs, () =>
      Ok(
        dataOutput("mooc-exercise-updates", {
          updated: [],
          removed: [],
          unchecked_courses: [
            { course_id: uuid(1), kind: "insufficient-scope" },
            { course_id: uuid(2), kind: "not-found" },
            { course_id: uuid(3), kind: "forbidden" },
          ],
        }),
      ),
    )
    const result = await langs.checkExerciseUpdates("mooc")
    const [hidden, deleted, closed] = result.unwrap().uncheckedCourses ?? []
    expect(hidden?.courseId).toEqual(idOfMoocCourse(uuid(1)))
    expect(hidden?.refusal).toBeInstanceOf(InsufficientScopeError)
    expect(deleted?.courseId).toEqual(idOfMoocCourse(uuid(2)))
    expect(deleted?.refusal).toBeInstanceOf(NotFoundError)
    expect(closed?.refusal).toBeInstanceOf(ForbiddenError)
  })

  test("getMoocCourseData serves a repeat view from cache until a refresh is forced", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(
        dataOutput("mooc-combined-course-data", {
          course: { ...moocCourse, id: uuid(1) },
          slides: [],
          progress: { course_id: uuid(1), exercises: [] },
        }),
      ),
    )
    await langs.getMoocCourseData(uuid(1))
    await langs.getMoocCourseData(uuid(1))
    expect(calls).toHaveLength(1)
    await langs.getMoocCourseData(uuid(1), { forceRefresh: true })
    expect(calls).toHaveLength(2)
  })

  test("a tmc course id and a mooc course id of the same text keep separate entries", async function () {
    const langs = newLangs()
    const backendsRequested: string[] = []
    stubSpawn(langs, (_i, args) => {
      backendsRequested.push(args[0] ?? "")
      return args[0] === "tmc"
        ? Ok(
            dataOutput("combined-course-data", {
              details: { ...courseDetails, id: 5 },
              exercises: [],
              settings: courseData,
            }),
          )
        : Ok(
            dataOutput("mooc-combined-course-data", {
              course: { ...moocCourse, id: uuid(5) },
              slides: [],
              progress: { course_id: uuid(5), exercises: [] },
            }),
          )
    })

    await langs.getTmcCourseData(5)
    await langs.getMoocCourseData("5")

    expect(backendsRequested).toEqual(["tmc", "mooc"])
  })

  test("the cache evicts the least recently used entry once it is full", async function () {
    const langs = newLangs()
    let courseCalls = 0
    stubSpawn(langs, () => {
      courseCalls += 1
      return Ok(dataOutput("courses", []))
    })

    // One entry per organization; the cap is 128, so 129 of them push the first one out.
    for (let organization = 0; organization <= 128; organization++) {
      await langs.getCourses(`org-${organization}`)
    }
    expect(courseCalls).toBe(129)

    // The newest is still cached, the oldest is not.
    await langs.getCourses("org-128")
    expect(courseCalls).toBe(129)
    await langs.getCourses("org-0")
    expect(courseCalls).toBe(130)
  })
})

suite("Langs exercise-update cache invalidation", function () {
  // Each backend's download clears its own cached update list ("exercise-updates" vs
  // "mooc-exercise-updates"), or updated exercises keep showing as outdated.
  test("a mooc download invalidates the cached mooc exercise-update list", async function () {
    const langs = newLangs()
    let updateCheckCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("check-exercise-updates")) {
        updateCheckCalls += 1
        return Ok(
          dataOutput("mooc-exercise-updates", {
            updated: [uuid(1)],
            removed: [],
            unchecked_courses: [],
          }),
        )
      }
      return Ok(
        dataOutput("mooc-exercise-download", {
          downloaded: [],
          skipped: [],
          failed: [],
        }),
      )
    })

    await langs.checkExerciseUpdates("mooc")
    // Served from cache, so no second spawn.
    await langs.checkExerciseUpdates("mooc")
    expect(updateCheckCalls).toBe(1)

    await langs.downloadMoocExercises(["ex-uuid"], undefined, () => {})

    // The download must have dropped the mooc entry, forcing a real re-check.
    await langs.checkExerciseUpdates("mooc")
    expect(updateCheckCalls).toBe(2)
  })

  test("a mooc download leaves the tmc exercise-update cache intact", async function () {
    const langs = newLangs()
    let tmcUpdateCheckCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("check-exercise-updates")) {
        tmcUpdateCheckCalls += 1
        return Ok(dataOutput("exercise-updates", { updated: [1], removed: [] }))
      }
      return Ok(
        dataOutput("mooc-exercise-download", {
          downloaded: [],
          skipped: [],
          failed: [],
        }),
      )
    })

    await langs.checkExerciseUpdates("tmc")
    // Only mooc exercises are downloaded, so the tmc cache must survive.
    await langs.downloadMoocExercises(["ex-uuid"], undefined, () => {})
    await langs.checkExerciseUpdates("tmc")
    expect(tmcUpdateCheckCalls).toBe(1)
  })
})

// Drives `_executeLangsCommand` with a chosen result and stderr, to assert on the returned error.
function stubSpawnWithStderr(
  langs: Langs,
  result: Result<OutputData, BaseError>,
  stderr: string,
): void {
  // oxlint-disable-next-line typescript/no-explicit-any
  vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation(() =>
    Ok({
      interrupt: (): void => {},
      result: Promise.resolve(result),
      getStderr: (): string => stderr,
    }),
  )
}

suite("Langs error diagnostics", function () {
  test("an error response carries both the CLI trace and the process stderr", async function () {
    const langs = newLangs()
    stubSpawnWithStderr(
      langs,
      Ok(errorOutput("generic", "something went wrong", ["frame one", "frame two"])),
      "thread 'main' panicked",
    )

    const result = await langs.getTmcCourseData(42)

    expect(result.err).toBe(true)
    const details = (result.val as BaseError).details ?? ""
    expect(details).toContain("frame one")
    expect(details).toContain("thread 'main' panicked")
  })
})

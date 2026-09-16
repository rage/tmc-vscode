import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import Langs from "../../api/langs"
import {
  AuthorizationError,
  BottleneckError,
  ConnectionError,
  ForbiddenError,
  InsufficientScopeError,
  InvalidTokenError,
  NotEnrolledError,
  ObsoleteClientError,
  RuntimeError,
  UnknownUploadError,
  UploadExpiredError,
} from "../../errors"
import type { OutputData, OutputResult } from "../../shared/langsSchema"
import { CliOutputData } from "../../shared/langsSchema"
import type { BaseError } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import {
  courseDetails,
  exerciseDetails,
  moocCourse,
  organization,
  submissionFinished,
} from "../fixtures/cliOutput"

// `_spawnLangsProcess` is private; cast to `any` to stub it without spawning a
// real tmc-langs-cli process.

// Records the argv of each invocation and short-circuits before spawning.
function spyOnSpawn(langs: Langs): { args: string[] }[] {
  const calls: { args: string[] }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
    calls.push(commandArgs as { args: string[] })
    return Err(new Error("stopped before spawning a real process"))
  })
  return calls
}

// Stubs the spawn so it resolves to a caller-provided response per invocation.
function stubSpawn(
  langs: Langs,
  respond: (callIndex: number, args: string[]) => Result<OutputData, BaseError>,
  stderr = "",
): { args: string[] }[] {
  const calls: { args: string[] }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Every fixture goes through the schema `Langs` validates real CLI stdout with, so a
// payload the CLI could not emit fails where it is written rather than propping up an
// assertion that could never hold in production.
function cliOutput(value: unknown): OutputData {
  return CliOutputData.parse(value)
}

function errorOutput(kind: unknown, message = "boom", trace = ["trace line"]): OutputData {
  return cliOutput({
    "output-kind": "output-data",
    status: "finished",
    message,
    result: "error",
    data: { "output-data-kind": "error", "output-data": { kind, trace } },
  })
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

/**
 * An output that carries no data: an `executed-command` with nothing to report
 * (e.g. `reset-exercise`), or one of the login-state results.
 */
function nullOutput(message = "ok", result: OutputResult = "executed-command"): OutputData {
  return cliOutput({
    "output-kind": "output-data",
    status: "finished",
    message,
    result,
    data: null,
  })
}

// The mooc contract types every id as a UUID, so a fixture cannot use a readable
// stand-in; these are valid v4 UUIDs whose tail is the number given.
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

function newLangs(): Langs {
  return new Langs("dummy-cli-path", "test-client", "1.0.0")
}

afterEach(function () {
  vi.restoreAllMocks()
})

suite("Langs class arg building", function () {
  test("getCourseDetails builds the tmc --course-id from the numeric course id", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getCourseDetails(CourseIdentifier.from(42))
    const args = calls[0]?.args ?? []
    expect(args[0]).toBe("tmc")
    expect(args[args.indexOf("--course-id") + 1]).toBe("42")
    expect(args.some((arg) => arg.includes("[object Object]"))).toBe(false)
  })

  test("getCourseDetails builds the mooc --course-id from the instance id", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getCourseDetails(CourseIdentifier.from("course-uuid"))
    const args = calls[0]?.args ?? []
    expect(args[0]).toBe("mooc")
    expect(args[args.indexOf("--course-id") + 1]).toBe("course-uuid")
    expect(args.some((arg) => arg.includes("[object Object]"))).toBe(false)
  })

  test("checkExerciseUpdates (mooc)", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.checkExerciseUpdates("mooc")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "check-exercise-updates",
    ])
  })

  test("getEnrolledMoocCourseInstances", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getEnrolledMoocCourseInstances()
    expect(calls[0]?.args).toEqual(["mooc", "--client-name", "test-client", "courses"])
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

  test("getEnrolledMoocCourseInstances de-duplicates courses by id", async function () {
    // The backend can return the same course twice (two live enrollments of one
    // course); since the extension keys courses by course id, the list must be
    // de-duplicated so the same course never shows up — or gets added — twice.
    const langs = newLangs()
    const fixtures = [
      {
        id: uuid(1),
        slug: "python-a",
        name: "python-a",
        description: null,
        organization_name: "mooc.fi",
      },
      {
        id: uuid(1),
        slug: "python-b",
        name: "python-b",
        description: null,
        organization_name: "mooc.fi",
      },
      {
        id: uuid(2),
        slug: "java",
        name: "java",
        description: null,
        organization_name: "mooc.fi",
      },
    ]
    stubSpawn(langs, () => Ok(dataOutput("mooc-courses", fixtures)))
    const result = await langs.getEnrolledMoocCourseInstances()
    expect(result.ok).toBe(true)
    const courses = result.unwrap()
    expect(courses.map((c) => c.id)).toEqual([uuid(1), uuid(2)])
    // the first occurrence is kept
    expect(courses[0]?.slug).toBe("python-a")
  })

  test("getMoocOldSubmissions", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getMoocOldSubmissions("ex-uuid")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "get-exercise-submissions",
      "--exercise-id",
      "ex-uuid",
    ])
  })

  test("getMoocCourseInstanceData first requests the course", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getMoocCourseInstanceData("inst-uuid")
    // The Err stub stops after the first request; assert its argv.
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "course",
      "--course-id",
      "inst-uuid",
    ])
  })

  test("getMoocCourseInstanceData then requests the course exercises", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, (i) =>
      i === 0
        ? Ok(dataOutput("mooc-course", { ...moocCourse, id: uuid(1) }))
        : Ok(dataOutput("mooc-exercise-slides", [])),
    )
    await langs.getMoocCourseInstanceData(uuid(1))
    expect(calls[1]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "course-exercises",
      "--course-id",
      uuid(1),
    ])
  })

  test("getMoocCourseProgress builds the command and parses the returned data", async function () {
    const langs = newLangs()
    const progress = {
      course_id: uuid(1),
      exercises: [
        {
          exercise_id: uuid(2),
          score_given: 3,
          score_maximum: 3,
          completed: true,
          attempted: true,
        },
      ],
    }
    const calls = stubSpawn(langs, () => Ok(dataOutput("mooc-course-progress", progress)))
    const result = await langs.getMoocCourseProgress("inst-uuid")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "course-progress",
      "--course-id",
      "inst-uuid",
    ])
    expect(result.ok).toBe(true)
    expect(result.unwrap()).toEqual(progress)
  })

  test("submitMoocExerciseToPaste", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.submitMoocExerciseToPaste("ex-uuid", "/path/to/ex")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "paste",
      "--exercise-id",
      "ex-uuid",
      "--submission-path",
      "/path/to/ex",
    ])
  })

  test("submitMoocExerciseAndWaitForResults builds a blocking mooc submit", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.submitMoocExerciseAndWaitForResults("ex-uuid", "/path/to/ex")
    // Only exercise id + path: the CLI resolves the slide and task ids and owns
    // the poll loop, and the blocking submit takes no --dont-block flag.
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "submit",
      "--exercise-id",
      "ex-uuid",
      "--submission-path",
      "/path/to/ex",
    ])
  })

  test("submitMoocExerciseAndWaitForResults returns the grading status", async function () {
    const langs = newLangs()
    const grading = {
      status: "grading",
      grading: {
        grading_progress: "FullyGraded",
        score_given: 1,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: "2026-07-21T00:00:01Z",
        feedback_text: "All tests passed",
      },
    }
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-status", grading)))
    const result = await langs.submitMoocExerciseAndWaitForResults("ex-uuid", "/path/to/ex")
    expect(result.ok).toBe(true)
    expect(result.unwrap()).toEqual(grading)
  })

  test("submitMoocExerciseAndWaitForResults forwards progress updates", async function () {
    const langs = newLangs()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const progress: { pct: number; message: string | undefined }[] = []
    await langs.submitMoocExerciseAndWaitForResults("ex-uuid", "/path/to/ex", (pct, message) =>
      progress.push({ pct, message }),
    )
    expect(progress).toEqual([{ pct: 50, message: "Grading in progress" }])
  })

  test("getMoocOldSubmissions parses the mooc-submissions list", async function () {
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
          },
          {
            id: uuid(1),
            exercise_id: uuid(9),
            created_at: "2026-07-21T10:00:00Z",
            score_given: 0,
            grading_progress: "Failed",
          },
        ]),
      ),
    )
    const result = await langs.getMoocOldSubmissions("ex-uuid")
    expect(result.ok).toBe(true)
    const submissions = result.unwrap()
    expect(submissions).toHaveLength(2)
    expect(submissions[0]?.id).toBe(uuid(2))
    expect(submissions[0]?.grading_progress).toBe("FullyGraded")
    expect(submissions[1]?.score_given).toBe(0)
  })

  test("downloadMoocOldSubmission includes --save-old-state when asked", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.downloadMoocOldSubmission("ex-uuid", "/path", "sub-uuid", true)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
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

  test("downloadMoocOldSubmission reports a submission with no downloadable files", async function () {
    // A submission the server has no files for makes the CLI report
    // `nothing-to-download` instead of failing.
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-old-submission-restore", "nothing-to-download")))
    const result = await langs.downloadMoocOldSubmission("ex-uuid", "/path", "sub-uuid", true)
    expect(result.ok).toBe(true)
    expect(result.unwrap()).toBe("nothing-to-download")
  })

  test("downloadMoocOldSubmission reports a restored submission", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-old-submission-restore", "restored")))
    const result = await langs.downloadMoocOldSubmission("ex-uuid", "/path", "sub-uuid", false)
    expect(result.unwrap()).toBe("restored")
  })

  test("downloadExercises routes mooc ids through the mooc subcommand", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] })),
    )
    await langs.downloadExercises([ExerciseIdentifier.from("exercise-uuid")], true, () => {})
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "download-or-update-course-exercises",
      "--exercise-id",
      "exercise-uuid",
    ])
  })

  test("downloadExercises forwards --course-id for mooc when a course id is given", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] })),
    )
    await langs.downloadExercises(
      [ExerciseIdentifier.from("exercise-uuid")],
      true,
      () => {},
      "course-uuid",
    )
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
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
    const result = await langs.resetExercise(ExerciseIdentifier.from(42), "/path/to/ex", false)
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
    const result = await langs.resetExercise(
      ExerciseIdentifier.from("ex-uuid"),
      "/path/to/ex",
      false,
    )
    expect(result.ok).toBe(true)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
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
    await langs.resetExercise(ExerciseIdentifier.from("ex-uuid"), "/path/to/ex", true)
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "reset-exercise",
      "--save-old-state",
      "--exercise-id",
      "ex-uuid",
      "--exercise-path",
      "/path/to/ex",
    ])
  })

  test("downloadExercises forwards mooc per-exercise progress updates", async function () {
    const langs = newLangs()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const downloaded: { id: unknown; percent: number; message?: string }[] = []
    await langs.downloadExercises([ExerciseIdentifier.from("ex-uuid")], false, (value) =>
      downloaded.push(value),
    )
    expect(downloaded).toHaveLength(1)
    expect(downloaded[0]?.percent).toBe(0.5)
    expect(downloaded[0]?.message).toBe("Downloading exercise")
    expect(downloaded[0]?.id).toEqual(ExerciseIdentifier.from("ex-uuid"))
  })

  test("authenticateMooc builds the `mooc login` command", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    langs.authenticateMooc(() => {})
    expect(calls[0]?.args).toEqual(["mooc", "--client-name", "test-client", "login"])
  })

  test("authenticateMooc sets no process timeout (device flow can take minutes)", async function () {
    const langs = newLangs()
    let captured: { processTimeout?: number } | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
      captured = commandArgs as { processTimeout?: number }
      return Err(new Error("stopped before spawning a real process"))
    })
    langs.authenticateMooc(() => {})
    expect(captured?.processTimeout).toBeUndefined()
  })

  test("authenticateMooc surfaces the device-login status update and resolves on success", async function () {
    const langs = newLangs()
    const deviceInfo = {
      verification_uri: "https://courses.mooc.fi/oauth_device",
      verification_uri_complete: "https://courses.mooc.fi/oauth_device?user_code=ABCD-EFGH",
      user_code: "ABCD-EFGH",
      expires_in: 900,
      interval: 5,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const { result } = langs.authenticateMooc((info) => seen.push(info))
    const res = await result
    expect(res.ok).toBe(true)
    expect(seen).toEqual([deviceInfo])
  })

  test("authenticateMooc reports a not-logged-in error on denial/expiry", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(errorOutput("not-logged-in")))
    const { result } = langs.authenticateMooc(() => {})
    const res = await result
    expect(res.err).toBe(true)
    expect(res.val).toBeInstanceOf(AuthorizationError)
  })

  test("isMoocAuthenticated builds `mooc logged-in` and maps the result", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput("currently logged in", "logged-in")))
    const res = await langs.isMoocAuthenticated()
    expect(calls[0]?.args).toEqual(["mooc", "--client-name", "test-client", "logged-in"])
    expect(res.unwrap()).toBe(true)
  })

  test("isMoocAuthenticated returns false when not logged in", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(nullOutput("currently not logged in", "not-logged-in")))
    const res = await langs.isMoocAuthenticated()
    expect(res.unwrap()).toBe(false)
  })

  test("deauthenticateMooc builds `mooc logout`", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput("logged out", "logged-out")))
    const res = await langs.deauthenticateMooc()
    expect(calls[0]?.args).toEqual(["mooc", "--client-name", "test-client", "logout"])
    expect(res.ok).toBe(true)
  })

  test("listLocalExercises asks for every course and both backends in one call", async function () {
    const langs = newLangs()
    const tmcExercise = {
      "course-slug": "python-course",
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

  test("listLocalCourseExercises routes the mooc branch to the mooc subcommand", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(dataOutput("local-mooc-exercises", [])))
    await langs.listLocalCourseExercises("mooc", "course-uuid")
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "list-local-course-exercises",
      "--course-id",
      "course-uuid",
    ])
  })

  test("listLocalCourseExercises routes the tmc branch to the top-level subcommand", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(dataOutput("local-tmc-exercises", [])))
    await langs.listLocalCourseExercises("tmc", "python-course")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      "list-local-tmc-course-exercises",
      "--client-name",
      "test-client",
      "--course-slug",
      "python-course",
    ])
  })

  test("listLocalCourseExercises surfaces a tmc subcommand error instead of retrying", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(
        errorOutput("generic", "error: unrecognized subcommand 'list-local-tmc-course-exercises'"),
      ),
    )
    const res = await langs.listLocalCourseExercises("tmc", "python-course")
    expect(res.err).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

suite("Langs cross-backend independence", function () {
  test("a tmc submission throttle does not block a mooc submission", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("submission-finished", submissionFinished)))
    const firstTmc = await langs.submitTmcExerciseAndWaitForResults(1, "/path/to/ex")
    expect(firstTmc.ok).toBe(true)

    const secondTmc = await langs.submitTmcExerciseAndWaitForResults(1, "/path/to/ex")
    expect(secondTmc.val).toBeInstanceOf(BottleneckError)

    // Throttle state is per-backend, so a mooc submission right after is unaffected.
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-status", { status: "no-grading-yet" })))
    const mooc = await langs.submitMoocExerciseAndWaitForResults("ex-uuid", "/path/to/ex")
    expect(mooc.ok).toBe(true)
  })

  test("a mooc submission throttle does not block a tmc submission", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(dataOutput("mooc-submission-status", { status: "no-grading-yet" })))
    const firstMooc = await langs.submitMoocExerciseAndWaitForResults("ex-uuid", "/path/to/ex")
    expect(firstMooc.ok).toBe(true)

    const secondMooc = await langs.submitMoocExerciseAndWaitForResults("ex-uuid", "/path/to/ex")
    expect(secondMooc.val).toBeInstanceOf(BottleneckError)

    stubSpawn(langs, () => Ok(dataOutput("submission-finished", submissionFinished)))
    const tmc = await langs.submitTmcExerciseAndWaitForResults(1, "/path/to/ex")
    expect(tmc.ok).toBe(true)
  })

  test("downloadExercises attempts the mooc leg even when the tmc leg errors", async function () {
    const langs = newLangs()
    stubSpawn(langs, (_index, args) => {
      if (args[0] === "tmc") {
        return Err(new RuntimeError("tmc download failed"))
      }
      return Ok(dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] }))
    })
    const result = await langs.downloadExercises(
      [ExerciseIdentifier.from(1), ExerciseIdentifier.from("exercise-uuid")],
      true,
      () => {},
    )
    // The mooc leg's result comes through alongside the tmc leg's failure.
    expect(result.mooc).toEqual({ downloaded: [], skipped: [], failed: [] })
    expect(result.tmcError).toBeInstanceOf(RuntimeError)
    expect(result.moocError).toBeUndefined()
  })

  test("downloadExercises attempts the tmc leg even when the mooc leg errors", async function () {
    const langs = newLangs()
    stubSpawn(langs, (_index, args) => {
      if (args[0] === "mooc") {
        return Err(new RuntimeError("mooc download failed"))
      }
      return Ok(dataOutput("tmc-exercise-download", { downloaded: [], skipped: [], failed: [] }))
    })
    const result = await langs.downloadExercises(
      [ExerciseIdentifier.from(1), ExerciseIdentifier.from("exercise-uuid")],
      true,
      () => {},
    )
    expect(result.tmc).toEqual({ downloaded: [], skipped: [], failed: [] })
    expect(result.moocError).toBeInstanceOf(RuntimeError)
    expect(result.tmcError).toBeUndefined()
  })
})

suite("Langs error-kind mapping", function () {
  const cases: [unknown, new (...args: never[]) => Error][] = [
    ["connection-error", ConnectionError],
    ["forbidden", InsufficientScopeError],
    ["invalid-token", InvalidTokenError],
    ["not-logged-in", AuthorizationError],
    ["obsolete-client", ObsoleteClientError],
    ["not-enrolled", NotEnrolledError],
    ["upload-expired", UploadExpiredError],
    ["unknown-upload", UnknownUploadError],
    ["generic", RuntimeError],
  ]
  for (const [kind, errorClass] of cases) {
    test(`maps ${String(kind)} to ${errorClass.name}`, async function () {
      const langs = newLangs()
      stubSpawn(langs, () => Ok(errorOutput(kind)))
      const result = await langs.getEnrolledMoocCourseInstances()
      expect(result.err).toBe(true)
      expect(result.val).toBeInstanceOf(errorClass)
    })

    // invalid-token is excluded deliberately: it means the stored credential was
    // rejected, which is a clean signal that needs no diagnostics attached.
    if (kind !== "invalid-token") {
      test(`${String(kind)} carries the CLI trace and the process stderr`, async function () {
        const langs = newLangs()
        stubSpawn(langs, () => Ok(errorOutput(kind)), "stderr line")
        const result = await langs.getEnrolledMoocCourseInstances()
        const details = (result.val as BaseError).details ?? ""
        expect(details).toContain("trace line")
        expect(details).toContain("stderr line")
      })
    }
  }

  test("forbidden is a course verdict on tmc and a session verdict on mooc", async function () {
    // tmc.mooc.fi 403s a course the user may not see, which `updateCourse` persists as a
    // disabled course; courses.mooc.fi 403s an underscoped token, which says nothing
    // about the course and must never be persisted as one.
    const langsTmc = newLangs()
    stubSpawn(langsTmc, () => Ok(errorOutput("forbidden")))
    const tmcResult = await langsTmc.getTmcOrganizations()
    expect(tmcResult.val).toBeInstanceOf(ForbiddenError)
    expect(tmcResult.val).not.toBeInstanceOf(InsufficientScopeError)

    const langsMooc = newLangs()
    stubSpawn(langsMooc, () => Ok(errorOutput("forbidden")))
    const moocResult = await langsMooc.getEnrolledMoocCourseInstances()
    expect(moocResult.val).toBeInstanceOf(InsufficientScopeError)
    expect((moocResult.val as Error).message).toContain("Log in again")
  })

  test("not-enrolled names the actual backend the failing command targeted", async function () {
    // Regression guard: the wording used to hardcode "courses.mooc.fi" regardless
    // of which backend actually produced the error.
    const langsMooc = newLangs()
    stubSpawn(langsMooc, () => Ok(errorOutput("not-enrolled")))
    const moocResult = await langsMooc.getEnrolledMoocCourseInstances()
    expect(moocResult.val).toBeInstanceOf(NotEnrolledError)
    expect((moocResult.val as Error).message).toContain("courses.mooc.fi")
    expect((moocResult.val as Error).message).not.toContain("tmc.mooc.fi")

    const langsTmc = newLangs()
    stubSpawn(langsTmc, () => Ok(errorOutput("not-enrolled")))
    const tmcResult = await langsTmc.getTmcOrganizations()
    expect(tmcResult.val).toBeInstanceOf(NotEnrolledError)
    expect((tmcResult.val as Error).message).toContain("tmc.mooc.fi")
  })

  test("a crashed process is reported as an error", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok({ ...dataOutput("mooc-courses", []), status: "crashed" }))
    const result = await langs.getEnrolledMoocCourseInstances()
    expect(result.err).toBe(true)
  })

  test("invalid-token fires the failing backend's logout event and keeps the other's cache", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    const onMoocLogout = vi.fn()
    langs.on("logout", onLogout)
    langs.on("mooc-logout", onMoocLogout)
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

    // Only the mooc event fires, since the failing command targets mooc.
    const result = await langs.getEnrolledMoocCourseInstances()
    expect(result.val).toBeInstanceOf(InvalidTokenError)
    expect(onMoocLogout).toHaveBeenCalledExactlyOnceWith(false)
    expect(onLogout).not.toHaveBeenCalled()

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
      if (args.includes("course-exercises")) {
        return Ok(dataOutput("mooc-exercise-slides", []))
      }
      courseCalls += 1
      return Ok(dataOutput("mooc-course", { ...moocCourse, id: uuid(1) }))
    })

    await langs.getMoocCourseInstanceData(uuid(1))
    await langs.getMoocCourseInstanceData(uuid(1))
    expect(courseCalls).toBe(1)

    expect((await langs.getEnrolledMoocCourseInstances()).err).toBe(true)

    await langs.getMoocCourseInstanceData(uuid(1))
    expect(courseCalls).toBe(2)
  })

  test("a tmc command's invalid-token fires the tmc logout event as unexpected", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    const onMoocLogout = vi.fn()
    langs.on("logout", onLogout)
    langs.on("mooc-logout", onMoocLogout)
    stubSpawn(langs, () => Ok(errorOutput("invalid-token")))

    const result = await langs.getTmcOrganizations()
    expect(result.val).toBeInstanceOf(InvalidTokenError)
    expect(onLogout).toHaveBeenCalledExactlyOnceWith(false)
    expect(onMoocLogout).not.toHaveBeenCalled()
  })

  test("deauthenticate fires the logout event as expected and stays quiet on auth errors", async function () {
    const langs = newLangs()
    const onLogout = vi.fn()
    langs.on("logout", onLogout)
    stubSpawn(langs, (i) => Ok(i === 0 ? nullOutput() : errorOutput("not-logged-in")))

    const logoutResult = await langs.deauthenticate()
    expect(logoutResult.ok).toBe(true)
    expect(onLogout).toHaveBeenCalledExactlyOnceWith(true)

    // Errors, but must not fire the unexpected-logout event.
    const secondResult = await langs.deauthenticate()
    expect(secondResult.err).toBe(true)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  test("deauthenticateMooc fires the mooc-logout event as expected", async function () {
    const langs = newLangs()
    const onMoocLogout = vi.fn()
    langs.on("mooc-logout", onMoocLogout)
    stubSpawn(langs, () => Ok(nullOutput()))

    const result = await langs.deauthenticateMooc()
    expect(result.ok).toBe(true)
    expect(onMoocLogout).toHaveBeenCalledExactlyOnceWith(true)
  })

  // `tmc logout` only removes credentials.json; the mooc credentials -- which
  // authenticate both backends -- are `mooc logout`'s to remove.
  test("deauthenticate runs only `tmc logout` and leaves the mooc session alone", async function () {
    const langs = newLangs()
    const onMoocLogout = vi.fn()
    langs.on("mooc-logout", onMoocLogout)
    const calls = stubSpawn(langs, () => Ok(nullOutput()))

    const result = await langs.deauthenticate()
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      "tmc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "logout",
    ])
    expect(onMoocLogout).not.toHaveBeenCalled()
  })

  test("isAuthenticated builds `tmc logged-in` and maps the result", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () => Ok(nullOutput("currently logged in", "logged-in")))

    expect((await langs.isAuthenticated()).val).toBe(true)
    expect(calls[0]?.args).toEqual([
      "tmc",
      "--client-name",
      "test-client",
      "--client-version",
      "1.0.0",
      "logged-in",
    ])
  })

  test("isAuthenticated returns false when not logged in", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => Ok(nullOutput("currently not logged in", "not-logged-in")))

    expect((await langs.isAuthenticated()).val).toBe(false)
  })
})

suite("Langs response cache", function () {
  test("serves a second call from cache without re-spawning", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, () => {
      callCount += 1
      return Ok(dataOutput("mooc-updated-exercises", [{ id: uuid(callCount) }]))
    })
    const first = await langs.checkExerciseUpdates("mooc")
    const second = await langs.checkExerciseUpdates("mooc")
    expect(callCount).toBe(1)
    expect(first.val).toEqual([ExerciseIdentifier.from(uuid(1))])
    expect(second.val).toEqual([ExerciseIdentifier.from(uuid(1))])
  })

  test("forceRefresh bypasses the cache", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, () => {
      callCount += 1
      return Ok(dataOutput("mooc-updated-exercises", [{ id: uuid(callCount) }]))
    })
    await langs.checkExerciseUpdates("mooc")
    const refreshed = await langs.checkExerciseUpdates("mooc", { forceRefresh: true })
    expect(callCount).toBe(2)
    expect(refreshed.val).toEqual([ExerciseIdentifier.from(uuid(2))])
  })

  test("getMoocCourseInstanceData serves a repeat view from cache", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, (_i, args) => {
      callCount += 1
      return args.includes("course-exercises")
        ? Ok(dataOutput("mooc-exercise-slides", []))
        : Ok(dataOutput("mooc-course", { ...moocCourse, id: uuid(1) }))
    })
    await langs.getMoocCourseInstanceData(uuid(1))
    await langs.getMoocCourseInstanceData(uuid(1))
    // Two subcommands on the first view, both served from cache on the second.
    expect(callCount).toBe(2)
  })

  test("getMoocCourseInstanceData forceRefresh bypasses the cache", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, (_i, args) => {
      callCount += 1
      return args.includes("course-exercises")
        ? Ok(dataOutput("mooc-exercise-slides", []))
        : Ok(dataOutput("mooc-course", { ...moocCourse, id: uuid(1) }))
    })
    await langs.getMoocCourseInstanceData(uuid(1))
    await langs.getMoocCourseInstanceData(uuid(1), { forceRefresh: true })
    expect(callCount).toBe(4)
  })

  test("getCourseDetails reuses the mooc course getMoocCourseInstanceData already fetched", async function () {
    const langs = newLangs()
    let courseCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("course-exercises")) {
        return Ok(dataOutput("mooc-exercise-slides", []))
      }
      courseCalls += 1
      return Ok(dataOutput("mooc-course", { ...moocCourse, id: uuid(1) }))
    })

    await langs.getMoocCourseInstanceData(uuid(1))
    const details = await langs.getCourseDetails(CourseIdentifier.from(uuid(1)))

    // Both legs run `mooc course --course-id`, so the second must not spawn.
    expect(courseCalls).toBe(1)
    expect(details.val).toEqual({ ...moocCourse, id: uuid(1) })
  })

  test("a tmc course id and a mooc course id of the same text keep separate entries", async function () {
    const langs = newLangs()
    const kindsRequested: string[] = []
    stubSpawn(langs, (_i, args) => {
      if (args[0] === "tmc") {
        kindsRequested.push("tmc")
        return Ok(dataOutput("course-details", { ...courseDetails, id: 5 }))
      }
      kindsRequested.push("mooc")
      return Ok(dataOutput("mooc-course", { ...moocCourse, id: uuid(5) }))
    })

    const tmc = await langs.getCourseDetails(CourseIdentifier.from(5))
    const mooc = await langs.getCourseDetails(CourseIdentifier.from("5"))

    expect(kindsRequested).toEqual(["tmc", "mooc"])
    expect(tmc.val).toEqual({ ...courseDetails, id: 5 })
    expect(mooc.val).toEqual({ ...moocCourse, id: uuid(5) })
  })

  test("the cache evicts the least recently used entry once it is full", async function () {
    const langs = newLangs()
    let detailCalls = 0
    stubSpawn(langs, () => {
      detailCalls += 1
      return Ok(dataOutput("exercise-details", { ...exerciseDetails, exercise_id: detailCalls }))
    })

    // One entry per exercise id; the cap is 128, so 129 ids push the first one out.
    for (let exerciseId = 0; exerciseId <= 128; exerciseId++) {
      await langs.getExerciseDetails(exerciseId)
    }
    expect(detailCalls).toBe(129)

    // The newest is still cached, the oldest is not.
    await langs.getExerciseDetails(128)
    expect(detailCalls).toBe(129)
    await langs.getExerciseDetails(0)
    expect(detailCalls).toBe(130)
  })

  test("the organizations remapper populates per-organization cache entries", async function () {
    const langs = newLangs()
    const orgs = [
      { ...organization, slug: "mooc", name: "MOOC" },
      { ...organization, slug: "hy", name: "HY" },
    ]
    let orgListCalls = 0
    let singleOrgCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("get-organizations")) {
        orgListCalls += 1
        return Ok(dataOutput("organizations", orgs))
      }
      singleOrgCalls += 1
      return Ok(dataOutput("organization", orgs[0]))
    })

    await langs.getTmcOrganizations()
    // getOrganization("mooc") must be served from the remapped cache entry.
    const single = await langs.getOrganization("mooc")
    expect(orgListCalls).toBe(1)
    expect(singleOrgCalls).toBe(0)
    expect(single.val).toEqual(orgs[0])
  })
})

suite("Langs exercise-update cache invalidation", function () {
  // Regression: the mooc download leg deleted the *tmc* cache key
  // ("exercise-updates") instead of its own ("mooc-exercise-updates"), so a mooc
  // update left the stale mooc update list cached for the full cache lifetime and
  // the just-updated exercises kept showing as outdated.
  test("a mooc download invalidates the cached mooc exercise-update list", async function () {
    const langs = newLangs()
    let updateCheckCalls = 0
    stubSpawn(langs, (_i, args) => {
      if (args.includes("check-exercise-updates")) {
        updateCheckCalls += 1
        return Ok(dataOutput("mooc-updated-exercises", [{ id: uuid(1) }]))
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

    await langs.downloadExercises([ExerciseIdentifier.from("ex-uuid")], false, () => {})

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
        return Ok(dataOutput("updated-exercises", [{ id: 1 }]))
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
    await langs.downloadExercises([ExerciseIdentifier.from("ex-uuid")], false, () => {})
    await langs.checkExerciseUpdates("tmc")
    expect(tmcUpdateCheckCalls).toBe(1)
  })
})

// Drives `_executeLangsCommand` with a caller-chosen result and stderr, so the
// assertions are about what reaches the returned error rather than about spawning.
function stubSpawnWithStderr(
  langs: Langs,
  result: Result<OutputData, BaseError>,
  stderr: string,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const result = await langs.getCourseDetails(CourseIdentifier.from(42))

    expect(result.err).toBe(true)
    const details = (result.val as BaseError).details ?? ""
    expect(details).toContain("frame one")
    expect(details).toContain("thread 'main' panicked")
  })
})

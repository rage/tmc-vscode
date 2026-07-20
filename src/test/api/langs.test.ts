import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import Langs from "../../api/langs"
import {
  AuthorizationError,
  ConnectionError,
  ForbiddenError,
  InvalidTokenError,
  ObsoleteClientError,
  RuntimeError,
} from "../../errors"
import type { OutputData } from "../../shared/langsSchema"
import type { BaseError } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"

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
): { args: string[] }[] {
  const calls: { args: string[] }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(langs as any, "_spawnLangsProcess").mockImplementation((commandArgs: unknown) => {
    const args = (commandArgs as { args: string[] }).args
    const index = calls.length
    calls.push({ args })
    return Ok({ interrupt: (): void => {}, result: Promise.resolve(respond(index, args)) })
  })
  return calls
}

function errorOutput(kind: unknown, message = "boom", trace = ["trace line"]): OutputData {
  return {
    "output-kind": "output-data",
    status: "finished",
    message,
    result: "error",
    data: { "output-data-kind": "error", "output-data": { kind, trace } },
  } as unknown as OutputData
}

function dataOutput(kind: string, data: unknown): OutputData {
  return {
    "output-kind": "output-data",
    status: "finished",
    message: "ok",
    result: "executed-command",
    data: { "output-data-kind": kind, "output-data": data },
  } as unknown as OutputData
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

  test("checkMoocExerciseUpdates", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.checkMoocExerciseUpdates()
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

  test("getMoocOrganizations", async function () {
    const langs = newLangs()
    const calls = spyOnSpawn(langs)
    await langs.getMoocOrganizations()
    expect(calls[0]?.args).toEqual(["mooc", "--client-name", "test-client", "get-organizations"])
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
        ? Ok(dataOutput("mooc-course", { id: "inst-uuid" }))
        : Ok(dataOutput("mooc-exercise-slides", [])),
    )
    await langs.getMoocCourseInstanceData("inst-uuid")
    expect(calls[1]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "course-exercises",
      "--course-id",
      "inst-uuid",
    ])
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

  test("downloadExercises routes mooc ids through the mooc subcommand", async function () {
    const langs = newLangs()
    const calls = stubSpawn(langs, () =>
      Ok(dataOutput("mooc-exercise-download", { downloaded: [], skipped: [], failed: [] })),
    )
    await langs.downloadExercises([ExerciseIdentifier.from("task-uuid")], true, () => {})
    expect(calls[0]?.args).toEqual([
      "mooc",
      "--client-name",
      "test-client",
      "download-or-update-course-exercises",
      "--download-template",
      "--exercise-id",
      "task-uuid",
    ])
  })
})

suite("Langs error-kind mapping", function () {
  const cases: [unknown, new (...args: never[]) => Error][] = [
    ["connection-error", ConnectionError],
    ["forbidden", ForbiddenError],
    ["invalid-token", InvalidTokenError],
    ["not-logged-in", AuthorizationError],
    ["obsolete-client", ObsoleteClientError],
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
  }

  test("a crashed process is reported as an error", async function () {
    const langs = newLangs()
    stubSpawn(langs, () => {
      const crashed = dataOutput("mooc-courses", [])
      ;(crashed as unknown as { status: string }).status = "crashed"
      return Ok(crashed)
    })
    const result = await langs.getEnrolledMoocCourseInstances()
    expect(result.err).toBe(true)
  })

  test("invalid-token clears the cache and fires the logout event", async function () {
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

    const result = await langs.getEnrolledMoocCourseInstances()
    expect(result.val).toBeInstanceOf(InvalidTokenError)
    expect(onLogout).toHaveBeenCalledTimes(1)

    // The cache was cleared, so the organizations request must spawn again.
    await langs.getTmcOrganizations()
    expect(organizationsCalls).toBe(2)
  })
})

suite("Langs response cache", function () {
  test("serves a second call from cache without re-spawning", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, () => {
      callCount += 1
      return Ok(dataOutput("mooc-updated-exercises", [`ex-${callCount}`]))
    })
    const first = await langs.checkMoocExerciseUpdates()
    const second = await langs.checkMoocExerciseUpdates()
    expect(callCount).toBe(1)
    expect(first.val).toEqual(["ex-1"])
    expect(second.val).toEqual(["ex-1"])
  })

  test("forceRefresh bypasses the cache", async function () {
    const langs = newLangs()
    let callCount = 0
    stubSpawn(langs, () => {
      callCount += 1
      return Ok(dataOutput("mooc-updated-exercises", [`ex-${callCount}`]))
    })
    await langs.checkMoocExerciseUpdates()
    const refreshed = await langs.checkMoocExerciseUpdates({ forceRefresh: true })
    expect(callCount).toBe(2)
    expect(refreshed.val).toEqual(["ex-2"])
  })

  test("the organizations remapper populates per-organization cache entries", async function () {
    const langs = newLangs()
    const orgs = [
      { slug: "mooc", name: "MOOC", information: "", logo_path: null, pinned: false },
      { slug: "hy", name: "HY", information: "", logo_path: null, pinned: false },
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

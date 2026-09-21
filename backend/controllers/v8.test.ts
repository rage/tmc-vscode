import assert from "node:assert/strict"
import fs from "node:fs"
import type { Server } from "node:http"
import path from "node:path"
import { after, before, beforeEach, describe, test } from "node:test"

import { Ajv2020 } from "ajv/dist/2020"
import type { Express } from "express"

import type { BackendExercise } from "../utils"
import { failingExerciseId, passingExerciseId } from "../utils"
import { MOCK_TMC_ACCESS_TOKEN } from "./accessToken"
import type { CourseWithExercises, TmcMockControls } from "./v8"
import { courseExercises, createTmcApp, organizations, testCourses, tmcMockOf } from "./v8"

// The legacy TMC mock is what every green CI tier trusts to imitate tmc-server,
// and nothing checked its responses. They are checked here against
// shared/bindings.schema.json -- the contract tmc-langs deserialises, vendored
// from its own bindings. tmc-server's Swagger 2.0 spec is deliberately NOT the
// reference: it disagrees with the mock on GET /core/exercises/{id}, and there
// the mock is the one that matches the running server.

const langsContract = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "shared", "bindings.schema.json"), "utf8"),
) as Record<string, unknown>

// `format: "uint32"` is schemars' annotation for a Rust integer width; ajv knows
// no such format, and the `type`/`minimum` beside it already carry the range.
const ajv = new Ajv2020({ allErrors: true, validateFormats: false })
ajv.addSchema(langsContract, "langs")

const assertMatches = (definition: string, value: unknown): void => {
  const validate = ajv.getSchema(`langs#/$defs/${definition}`)
  assert.ok(validate, `shared/bindings.schema.json declares no ${definition}`)
  assert.ok(
    validate(value),
    `response does not match the CLI's ${definition}: ${ajv.errorsText(validate.errors)}`,
  )
}

interface Mock {
  server: Server
  base: string
  controls: TmcMockControls
}

const listen = (app: Express): Promise<Mock> =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        throw new Error("expected a TCP address")
      }
      resolve({ server, base: `http://localhost:${address.port}`, controls: tmcMockOf(app) })
    })
  })

const authFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${MOCK_TMC_ACCESS_TOKEN}`, ...init.headers },
  })

const pythonCourse = testCourses[0]!
const pythonExercises = courseExercises[0]!.exercises
const passingExercise = pythonExercises.find((e) => e.exercise.id === passingExerciseId)!.exercise
const failingExercise = pythonExercises.find((e) => e.exercise.id === failingExerciseId)!.exercise

interface SubmissionResponseBody {
  paste_url: string
  show_submission_url: string
  submission_url: string
}

interface ProcessingBody {
  status: string
  sandbox_status: string
}

interface FinishedBody {
  status: string
  all_tests_passed: boolean | null
  test_cases: { name: string; successful: boolean }[]
}

describe("legacy TMC mock contract", () => {
  let mock: Mock

  before(async () => {
    mock = await listen(createTmcApp())
  })

  after(() => {
    mock.server.close()
  })

  beforeEach(() => {
    mock.controls.reset()
  })

  test("GET org.json returns organizations the CLI can read", async () => {
    const res = await authFetch(`${mock.base}/api/v8/org.json`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as unknown[]
    assert.equal(body.length, organizations.length)
    for (const organization of body) {
      assertMatches("Organization", organization)
    }
  })

  test("GET org/{slug}.json returns one organization", async () => {
    const res = await authFetch(`${mock.base}/api/v8/org/test.json`)
    assert.equal(res.status, 200)
    assertMatches("Organization", await res.json())
  })

  test("GET core/org/{slug}/courses returns course links", async () => {
    const res = await authFetch(`${mock.base}/api/v8/core/org/test/courses`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as unknown[]
    assert.equal(body.length, testCourses.length)
    for (const course of body) {
      assertMatches("Course", course)
    }
  })

  const declareExerciseContract = (exercise: BackendExercise): void => {
    test(`GET core/exercises/${exercise.id} returns ${exercise.name}'s details`, async () => {
      const res = await authFetch(`${mock.base}/api/v8/core/exercises/${exercise.id}`)
      assert.equal(res.status, 200)
      assertMatches("ExerciseDetails", await res.json())
    })

    test(`GET exercises/${exercise.id}/users/current/submissions returns old submissions`, async () => {
      const res = await authFetch(
        `${mock.base}/api/v8/exercises/${exercise.id}/users/current/submissions`,
      )
      assert.equal(res.status, 200)
      for (const submission of (await res.json()) as unknown[]) {
        assertMatches("Submission", submission)
      }
    })
  }

  const declareCourseContract = ({ course, exercises }: CourseWithExercises): void => {
    test(`GET courses/${course.id} returns ${course.name}'s settings`, async () => {
      const res = await authFetch(`${mock.base}/api/v8/courses/${course.id}`)
      assert.equal(res.status, 200)
      assertMatches("CourseData", await res.json())
    })

    test(`GET courses/${course.id}/exercises returns ${course.name}'s exercises`, async () => {
      const res = await authFetch(`${mock.base}/api/v8/courses/${course.id}/exercises`)
      assert.equal(res.status, 200)
      const body = (await res.json()) as unknown[]
      assert.equal(body.length, exercises.length)
      for (const exercise of body) {
        assertMatches("CourseExercise", exercise)
      }
    })

    // The details response wraps the course, so the CLI's CourseDetails is the
    // inner object -- validating the wrapper would pass on anything.
    test(`GET core/courses/${course.id} returns ${course.name}'s details`, async () => {
      const res = await authFetch(`${mock.base}/api/v8/core/courses/${course.id}`)
      assert.equal(res.status, 200)
      const body = (await res.json()) as { course: unknown }
      assertMatches("CourseDetails", body.course)
    })

    exercises.forEach(({ exercise }) => declareExerciseContract(exercise))
  }

  courseExercises.forEach((entry) => declareCourseContract(entry))

  test("GET core/exercises/details returns the download targets for the ids asked for", async () => {
    const res = await authFetch(
      `${mock.base}/api/v8/core/exercises/details?ids=${passingExerciseId}`,
    )
    assert.equal(res.status, 200)
    const body = (await res.json()) as { exercises: { id: number; checksum: string }[] }
    assert.deepEqual(
      body.exercises.map((e) => e.id),
      [passingExerciseId],
    )
    assert.equal(body.exercises[0]!.checksum, passingExercise.checksum)
  })

  test("POST submissions answers with URLs on the origin the request arrived at", async () => {
    const res = await authFetch(
      `${mock.base}/api/v8/core/exercises/${passingExerciseId}/submissions`,
      { method: "POST" },
    )
    assert.equal(res.status, 200)
    const body = (await res.json()) as SubmissionResponseBody
    assertMatches("NewSubmission", body)
    // The CLI polls submission_url and attaches its bearer only when that URL is
    // same-origin with the root it was configured with, so a URL naming another
    // host would silently lose authentication.
    for (const url of [body.paste_url, body.show_submission_url, body.submission_url]) {
      assert.ok(url.startsWith(mock.base), `${url} is not on ${mock.base}`)
    }
  })

  test("POST feedback answers with the CLI's feedback response", async () => {
    const res = await authFetch(`${mock.base}/feedback`, { method: "POST" })
    assert.equal(res.status, 200)
    assertMatches("SubmissionFeedbackResponse", await res.json())
  })

  test("a submission reports each sandbox state once, then its result", async () => {
    const submission = (await (
      await authFetch(`${mock.base}/api/v8/core/exercises/${passingExerciseId}/submissions`, {
        method: "POST",
      })
    ).json()) as SubmissionResponseBody
    const poll = async (): Promise<ProcessingBody & FinishedBody> =>
      (await (await authFetch(submission.submission_url)).json()) as ProcessingBody & FinishedBody

    const states: string[] = []
    for (let i = 0; i < 3; i++) {
      const body = await poll()
      assert.equal(body.status, "processing")
      states.push(body.sandbox_status)
    }
    assert.deepEqual(states, ["created", "sending_to_sandbox", "processing_on_sandbox"])

    const finished = await poll()
    assertMatches("SubmissionFinished", finished)
    // Nothing makes a graded submission report processing again.
    assertMatches("SubmissionFinished", await poll())
  })

  const gradeOf = async (exerciseId: number): Promise<FinishedBody> => {
    const submission = (await (
      await authFetch(`${mock.base}/api/v8/core/exercises/${exerciseId}/submissions`, {
        method: "POST",
      })
    ).json()) as SubmissionResponseBody
    let body = (await (await authFetch(submission.submission_url)).json()) as ProcessingBody &
      FinishedBody
    while (body.status === "processing") {
      body = (await (await authFetch(submission.submission_url)).json()) as ProcessingBody &
        FinishedBody
    }
    return body
  }

  test("the passing exercise grades as passed", async () => {
    const graded = await gradeOf(passingExerciseId)
    assert.equal(graded.status, "ok")
    assert.equal(graded.all_tests_passed, true)
    assert.deepEqual(
      graded.test_cases.map((c) => c.successful),
      [true],
    )
  })

  // Without this the "Some tests failed on the server" path has no backend that
  // can produce it, so no tier can assert on it.
  test("the failing exercise grades as failed", async () => {
    const graded = await gradeOf(failingExerciseId)
    assert.equal(graded.status, "fail")
    assert.equal(graded.all_tests_passed, false)
    assert.deepEqual(
      graded.test_cases.map((c) => c.successful),
      [false],
    )
  })

  test("a new submission joins the exercise's old submissions", async () => {
    const listSubmissions = async (): Promise<unknown[]> =>
      (await (
        await authFetch(
          `${mock.base}/api/v8/exercises/${failingExercise.id}/users/current/submissions`,
        )
      ).json()) as unknown[]

    const known = await listSubmissions()
    await authFetch(`${mock.base}/api/v8/core/exercises/${failingExercise.id}/submissions`, {
      method: "POST",
    })
    assert.equal((await listSubmissions()).length, known.length + 1)
  })

  test("POST /tmc-mock/reset drops submissions back to the declared one", async () => {
    await authFetch(`${mock.base}/api/v8/core/exercises/${passingExerciseId}/submissions`, {
      method: "POST",
    })
    const reset = await fetch(`${mock.base}/tmc-mock/reset`, { method: "POST" })
    assert.equal(reset.status, 204)

    const submissions = (await (
      await authFetch(
        `${mock.base}/api/v8/exercises/${passingExercise.id}/users/current/submissions`,
      )
    ).json()) as { id: number }[]
    assert.deepEqual(
      submissions.map((s) => s.id),
      [1],
    )
  })

  test("reset reuses the submission ids it freed", async () => {
    const first = (await (
      await authFetch(`${mock.base}/api/v8/core/exercises/${passingExerciseId}/submissions`, {
        method: "POST",
      })
    ).json()) as SubmissionResponseBody
    mock.controls.reset()
    const second = (await (
      await authFetch(`${mock.base}/api/v8/core/exercises/${passingExerciseId}/submissions`, {
        method: "POST",
      })
    ).json()) as SubmissionResponseBody
    assert.equal(second.submission_url, first.submission_url)
  })

  test("an unhandled endpoint is a 404, not a hang", async () => {
    const res = await authFetch(`${mock.base}/api/v8/courses/404`)
    assert.equal(res.status, 404)
  })
})

describe("legacy TMC mock authentication", () => {
  let mock: Mock
  let openMock: Mock

  before(async () => {
    mock = await listen(createTmcApp())
    openMock = await listen(createTmcApp({ requireAuth: false }))
  })

  after(() => {
    mock.server.close()
    openMock.server.close()
  })

  // tmc-server's `unauthorize_guest!` is what these mirror; the endpoints left
  // out below are the ones it does not call.
  const guarded = [
    `/api/v8/courses/${pythonCourse.id}`,
    `/api/v8/courses/${pythonCourse.id}/exercises`,
    `/api/v8/core/courses/${pythonCourse.id}`,
    `/api/v8/core/exercises/${passingExerciseId}`,
    `/api/v8/core/org/test/courses`,
    `/api/v8/exercises/${passingExerciseId}/users/current/submissions`,
    `/api/v8/core/submissions/1/download`,
  ]

  const declareGuarded = (endpoint: string): void => {
    test(`GET ${endpoint} refuses a request with no token`, async () => {
      const res = await fetch(`${mock.base}${endpoint}`)
      assert.equal(res.status, 401)
      // The CLI reads `error` out of the body to build its message; without it
      // the user sees the bare status.
      assert.deepEqual(await res.json(), { error: "Authentication required" })
    })

    test(`GET ${endpoint} refuses a token the server did not issue`, async () => {
      const res = await fetch(`${mock.base}${endpoint}`, {
        headers: { authorization: "Bearer not-the-issued-token" },
      })
      assert.equal(res.status, 401)
    })

    test(`GET ${endpoint} serves a guest when auth is turned off`, async () => {
      const res = await fetch(`${openMock.base}${endpoint}`)
      assert.notEqual(res.status, 401)
    })
  }

  guarded.forEach((endpoint) => declareGuarded(endpoint))

  // Guest-readable on tmc-server too, and tmc-langs documents both as needing no
  // authentication: the extension resolves an organization before there is any
  // session to authenticate with.
  test("GET org.json serves a guest", async () => {
    const res = await fetch(`${mock.base}/api/v8/org.json`)
    assert.equal(res.status, 200)
    for (const organization of (await res.json()) as unknown[]) {
      assertMatches("Organization", organization)
    }
  })

  test("GET org/{slug}.json serves a guest", async () => {
    const res = await fetch(`${mock.base}/api/v8/org/test.json`)
    assert.equal(res.status, 200)
    assertMatches("Organization", await res.json())
  })

  test("POST submissions refuses a request with no token", async () => {
    const res = await fetch(`${mock.base}/api/v8/core/exercises/${passingExerciseId}/submissions`, {
      method: "POST",
    })
    assert.equal(res.status, 401)
  })

  test("POST feedback refuses a request with no token", async () => {
    const res = await fetch(`${mock.base}/feedback`, { method: "POST" })
    assert.equal(res.status, 401)
  })

  test("POST /tmc-mock/reset needs no token", async () => {
    const res = await fetch(`${mock.base}/tmc-mock/reset`, { method: "POST" })
    assert.equal(res.status, 204)
  })

  test("the token /oauth/token issues is the one the API accepts", async () => {
    const res = await fetch(`${mock.base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "student", password: "student" }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { access_token: string }
    assert.equal(body.access_token, MOCK_TMC_ACCESS_TOKEN)

    const authenticated = await fetch(`${mock.base}/api/v8/courses/${pythonCourse.id}`, {
      headers: { authorization: `Bearer ${body.access_token}` },
    })
    assert.equal(authenticated.status, 200)
  })
})

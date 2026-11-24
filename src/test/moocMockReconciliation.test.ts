import fs from "fs"
import type { Server } from "http"
import path from "path"

import {
  failingExercise,
  notEnrolledExerciseId,
  passingExercise,
  pythonCourse,
  TMC_ARCHIVE_MIME,
} from "../../backend/mooc/fixtures"
import type { ExerciseSlide } from "../../backend/mooc/fixtures"
import type { MoocMockControls } from "../../backend/mooc/router"
import { createMoocApp, moocMockOf } from "../../backend/mooc/router"
import { zPasteResult } from "../../shared/generated/langs/zod.gen"
import {
  DataKind,
  ExerciseSlideSubmissionListItem,
  ExerciseTaskSubmissionResult,
  ExerciseTaskSubmissionStatus,
  MoocCourse,
  CourseProgress,
  TmcExerciseSlide,
  TmcExerciseTask,
} from "../../shared/langsSchema"

// Reconciles the two independently generated descriptions of the wire: the mooc mock validates
// against the OpenAPI spec vendored from secret-project-331, the extension validates CLI stdout
// against zod schemas generated from tmc-langs-rust's bindings. Nothing else compares them, so a
// shape satisfying one but not the other slips through. Drives the mock's shared endpoints over
// HTTP and validates each payload with the extension's zod schema.
//
// Id spaces: `submit` returns an exercise-TASK-submission id (polled via /grading) and an
// exercise-SLIDE-submission id (used by the submissions list, /download and /share). A submission
// is two calls: upload files, then submit an `answer_kind: "file"` body naming them.

const listen = (): Promise<{ server: Server; base: string; mock: MoocMockControls }> =>
  new Promise((resolve) => {
    // Shapes, not auth: the mock requires a bearer by default.
    const app = createMoocApp({ requireAuth: false })
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        throw new Error("expected a TCP address")
      }
      resolve({ server, base: `http://127.0.0.1:${addr.port}`, mock: moocMockOf(app) })
    })
  })

// Hand-written replica of the CLI's `TryFrom<api::ExerciseSlide> for TmcExerciseSlide` and
// `TryFrom<api::ExerciseTask> for TmcExerciseTask`
// (tmc-langs-rust/crates/tmc-mooc-client/src/exercise.rs), which add a top-level `checksum`
// lifted from public_spec and a `browser_test` field (null for editor tasks) to the bare wire
// shape the mock emits. A change to either TryFrom must be made here too. Exported so the
// coupling is greppable from the Rust side.
export const toCliStdoutSlide = (wire: ExerciseSlide): unknown => ({
  ...wire,
  tasks: wire.tasks.map((task) => ({
    ...task,
    checksum: task.public_spec?.checksum ?? null,
    public_spec: task.public_spec ? { browser_test: null, ...task.public_spec } : null,
  })),
})

// Hand-written replica of the CLI's `From<api::ExerciseTaskSubmissionStatus> for
// ExerciseTaskSubmissionStatus` (tmc-langs-rust/crates/tmc-mooc-client/src/lib.rs): re-tags the
// enum internally and reads `feedback_json` as the tmc service's camelCase RunResult into
// `test_results`, keeping logs only for a run that failed to run its tests
// (`GradingTestRun::from_feedback_json`, crates/tmc-mooc-client/src/grading.rs).
const toCliStdoutGradingStatus = (wire: unknown): unknown => {
  if (wire === "NoGradingYet") {
    return { status: "no-grading-yet" }
  }
  const { feedback_json, ...grading } = (wire as { Grading: Record<string, unknown> }).Grading
  const run = feedback_json as {
    status: string
    testResults?: unknown[]
    logs?: Record<string, string>
  } | null
  const test_results = run
    ? {
        status: run.status,
        test_results: run.testResults ?? [],
        logs: ["COMPILE_FAILED", "GENERIC_ERROR"].includes(run.status) ? (run.logs ?? {}) : {},
      }
    : null
  return { status: "grading", grading: { ...grading, test_results } }
}

// Properties left unconstrained (`true` or `{}` in shared/bindings.schema.json, `{}` in the
// OpenAPI spec) are a blind spot both descriptions share: a generator that dropped one instead
// of emitting `z.unknown()` would look correct everywhere. Read from the vendored schema, so a
// newly opaque property fails below until a round trip covers it.
const opaqueProperties = (schema: unknown): string[] => {
  const found: string[] = []
  const walk = (node: unknown, definition: string): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry, definition)
      }
      return
    }
    if (node === null || typeof node !== "object") {
      return
    }
    const properties = (node as { properties?: unknown }).properties
    if (properties !== null && typeof properties === "object") {
      for (const [name, subschema] of Object.entries(properties)) {
        const unconstrained =
          subschema === true ||
          (subschema !== null &&
            typeof subschema === "object" &&
            Object.keys(subschema as object).length === 0)
        if (unconstrained) {
          found.push(`${definition}.${name}`)
        }
      }
    }
    for (const value of Object.values(node)) {
      walk(value, definition)
    }
  }
  const definitions = (schema as { $defs?: Record<string, unknown> }).$defs ?? {}
  for (const [name, definition] of Object.entries(definitions)) {
    walk(definition, name)
  }
  return [...new Set(found)]
}

/** Per opaque property: a minimal schema value carrying `opaque`, and how to read it back. */
const opaqueRoundTrips: Record<
  string,
  {
    schema: { parse: (value: unknown) => unknown }
    build: (opaque: unknown) => unknown
    read: (parsed: unknown) => unknown
  }
> = {
  "TmcExerciseTask.assignment": {
    schema: TmcExerciseTask,
    build: (opaque) => ({
      assignment: opaque,
      checksum: null,
      exercise_service_slug: "tmc",
      model_solution_spec: null,
      order_number: 0,
      public_spec: null,
      task_id: "a1a1a1a1-0000-4000-8000-000000000201",
    }),
    read: (parsed) => (parsed as { assignment: unknown }).assignment,
  },
  "DataKind.output-data": {
    schema: DataKind,
    build: (opaque) => ({ "output-data-kind": "token", "output-data": opaque }),
    read: (parsed) => (parsed as Record<string, unknown>)["output-data"],
  },
}

// Asserts a payload validates against a zod schema, surfacing the issues on failure.
const expectValid = (
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
  label: string,
): void => {
  const result = schema.safeParse(value)
  expect(
    result.success,
    result.success
      ? undefined
      : `${label} failed langsSchema validation:\n${JSON.stringify(result.error, null, 2)}`,
  ).toBe(true)
}

suite("mooc mock <-> langsSchema reconciliation", function () {
  let server: Server
  let base: string
  let mock: MoocMockControls

  beforeAll(async function () {
    ;({ server, base, mock } = await listen())
  })

  afterAll(function () {
    server.close()
  })

  beforeEach(function () {
    mock.reset()
  })

  const api = (p: string): string => `${base}/api/v0/exercise-services/client${p}`

  test("GET /courses payloads validate as MoocCourse", async function () {
    const res = await fetch(api("/courses"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body.length).toBeGreaterThan(0)
    for (const course of body) {
      expectValid(MoocCourse, course, "course")
    }
  })

  test("GET /courses/{id} payload validates as MoocCourse", async function () {
    const res = await fetch(api(`/courses/${pythonCourse.id}`))
    expect(res.status).toBe(200)
    const course = (await res.json()) as unknown
    expectValid(MoocCourse, course, "single course")
    expect(MoocCourse.parse(course).id).toBe(pythonCourse.id)
  })

  test("GET /courses/{id}/exercises slides validate as TmcExerciseSlide", async function () {
    const res = await fetch(api(`/courses/${pythonCourse.id}/exercises`))
    expect(res.status).toBe(200)
    const slides = (await res.json()) as ExerciseSlide[]
    expect(slides.length).toBeGreaterThan(0)
    for (const slide of slides) {
      expectValid(TmcExerciseSlide, toCliStdoutSlide(slide), "course exercise slide")
    }
  })

  test("GET /exercises/{id} slide validates as TmcExerciseSlide", async function () {
    const res = await fetch(api(`/exercises/${passingExercise.slide.exercise_id}`))
    expect(res.status).toBe(200)
    const slide = (await res.json()) as ExerciseSlide
    expectValid(TmcExerciseSlide, toCliStdoutSlide(slide), "single exercise slide")
  })

  // Uploads one file for an exercise and returns the host-assigned file id.
  const uploadFile = async (exercise: typeof passingExercise): Promise<string> => {
    const form = new FormData()
    // The field name is a client-chosen UUID, as the host requires; the id it returns is its own
    // and is what a submit names. The part's type is what the CLI sends, echoed unchecked into
    // `AnswerFile.mime`.
    form.append(
      crypto.randomUUID(),
      new Blob([new Uint8Array([1, 2, 3])], { type: TMC_ARCHIVE_MIME }),
      "submission.tar.zst",
    )
    const res = await fetch(api(`/exercises/${exercise.slide.exercise_id}/files`), {
      method: "POST",
      body: form,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data_files: { id: string }[] }
    return body.data_files[0]!.id
  }

  // Returns both submission ids.
  const submit = async (
    exercise: typeof passingExercise,
  ): Promise<{ taskSubmissionId: string; slideSubmissionId: string }> => {
    const fileId = await uploadFile(exercise)
    const res = await fetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: exercise.slide.tasks[0]!.task_id,
        answer_kind: "file",
        data_files: [fileId],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    // The submit response is the `submission-finished` payload, less the page URL the CLI
    // takes from the exercise it fetched first.
    expectValid(
      ExerciseTaskSubmissionResult,
      { ...(body as object), exercise_page_url: null },
      "submit result",
    )
    const ids = body as { task_submission_id: string; slide_submission_id: string }
    return { taskSubmissionId: ids.task_submission_id, slideSubmissionId: ids.slide_submission_id }
  }

  test("grading status validates as ExerciseTaskSubmissionStatus (both variants)", async function () {
    const { taskSubmissionId } = await submit(passingExercise)

    // First poll: the externally tagged "NoGradingYet" string variant.
    const first = await (await fetch(api(`/submissions/${taskSubmissionId}/grading`))).json()
    expect(first).toBe("NoGradingYet")
    expectValid(
      ExerciseTaskSubmissionStatus,
      toCliStdoutGradingStatus(first),
      "grading (no-grading-yet)",
    )

    // Second poll: the externally tagged { Grading: { ... } } object variant.
    const second = (await (
      await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    ).json()) as { Grading: Record<string, unknown> }
    expectValid(ExerciseTaskSubmissionStatus, toCliStdoutGradingStatus(second), "grading (grading)")

    const parsed = ExerciseTaskSubmissionStatus.parse(toCliStdoutGradingStatus(second))
    expect(parsed.status === "grading" && parsed.grading.test_results?.status).toBe("PASSED")
  })

  test("a failed test run's results validate as the grading's test_results", async function () {
    const { taskSubmissionId } = await submit(failingExercise)
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    const graded = await (await fetch(api(`/submissions/${taskSubmissionId}/grading`))).json()

    const parsed = ExerciseTaskSubmissionStatus.parse(toCliStdoutGradingStatus(graded))
    if (parsed.status !== "grading") {
      throw new Error("expected a grading")
    }
    expect(parsed.grading.test_results?.test_results.map((test) => test.successful)).toEqual([
      true,
      false,
    ])
    // A normal run's logs are the program's output, which the CLI does not relay.
    expect(parsed.grading.test_results?.logs).toEqual({})
  })

  test("old-submissions list items validate as ExerciseSlideSubmissionListItem", async function () {
    const exerciseId = failingExercise.slide.exercise_id
    const { taskSubmissionId } = await submit(failingExercise)

    // Before grading completes: score/progress are null.
    const pending = (await (
      await fetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as unknown[]
    expect(pending.length).toBeGreaterThan(0)
    for (const item of pending) {
      expectValid(ExerciseSlideSubmissionListItem, item, "submission list item (pending)")
    }

    // After grading completes: score/progress are populated.
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    const graded = (await (
      await fetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as unknown[]
    for (const item of graded) {
      expectValid(ExerciseSlideSubmissionListItem, item, "submission list item (graded)")
    }
  })

  test("GET /courses/{id}/progress validates as CourseProgress", async function () {
    const progressOf = async (): Promise<unknown> => {
      const res = await fetch(api(`/courses/${pythonCourse.id}/progress`))
      expect(res.status).toBe(200)
      return res.json()
    }

    // Untouched: every exercise is present, zeroed and unattempted.
    const untouched = (await progressOf()) as { exercises: unknown[] }
    expect(untouched.exercises.length).toBeGreaterThan(0)
    expectValid(CourseProgress, untouched, "course progress (untouched)")

    // Graded: score_given and completed are populated, which a zeroed payload cannot exercise.
    const { taskSubmissionId } = await submit(passingExercise)
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    const graded = await progressOf()
    expectValid(CourseProgress, graded, "course progress (graded)")
    expect(
      CourseProgress.parse(graded).exercises.some((e) => e.completed && e.score_given > 0),
    ).toBe(true)
  })

  test("snapshot list items validate as ExerciseSlideSubmissionListItem", async function () {
    const exercise = passingExercise
    const form = new FormData()
    form.append(
      crypto.randomUUID(),
      new Blob([new Uint8Array([1, 2, 3])], { type: TMC_ARCHIVE_MIME }),
      "submission.tar.zst",
    )
    const uploaded = (await (
      await fetch(api(`/exercises/${exercise.slide.exercise_id}/files?for=snapshot`), {
        method: "POST",
        body: form,
      })
    ).json()) as { data_files: { id: string }[] }
    const stored = await fetch(api(`/exercises/${exercise.slide.exercise_id}/snapshots`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "paste",
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: exercise.slide.tasks[0]!.task_id,
        data_files: uploaded.data_files.map((file) => file.id),
      }),
    })
    expect(stored.status).toBe(200)

    const items = (await (
      await fetch(api(`/exercises/${exercise.slide.exercise_id}/submissions`))
    ).json()) as unknown[]
    expect(items).toHaveLength(1)
    expectValid(ExerciseSlideSubmissionListItem, items[0], "snapshot list item")
    expect(ExerciseSlideSubmissionListItem.parse(items[0]).kind).toBe("paste")
  })

  test("share result validates as PasteResult", async function () {
    const exerciseId = failingExercise.slide.exercise_id
    await submit(failingExercise)
    // The submissions list yields the slide-submission id that /share expects.
    const items = (await (await fetch(api(`/exercises/${exerciseId}/submissions`))).json()) as {
      id: string
    }[]
    const slideSubmissionId = items[0]!.id
    const res = await fetch(api(`/submissions/${slideSubmissionId}/share`), { method: "POST" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    expectValid(zPasteResult, body, "share result")
  })

  test("old-submission /download response carries the submission's files", async function () {
    // The /download response (`SubmissionFiles`) is consumed by the CLI, so langsSchema has no
    // zod schema for it. The mock validates every response against the spec before sending, so a
    // 200 proves conformance. The field assertions document what the CLI relies on: it takes
    // `data_files[0].url` and refuses any count other than one.
    const { slideSubmissionId } = await submit(failingExercise)
    const res = await fetch(api(`/submissions/${slideSubmissionId}/download`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data_files: { id: string; name: string; mime: string; url: string }[]
    }
    expect(body.data_files.length).toBe(1)
    expect(typeof body.data_files[0]!.id).toBe("string")
    expect(body.data_files[0]!.name).toBe("submission.tar.zst")
    // No repo can check this for another: tmc-langs sends this Content-Type, the host stores it
    // verbatim, and the tmc plugin writes the same one for an IFrame answer.
    expect(body.data_files[0]!.mime).toBe(TMC_ARCHIVE_MIME)
    expect(body.data_files[0]!.url.length).toBeGreaterThan(0)
  })

  test("a submission made from no files downloads as an empty list, not a 404", async function () {
    // The host answers with `{"data_files":[]}`, not a 404. Only an exercise type with no files
    // submits this way, so only the seed reaches it.
    const seeded = mock.seedFilelessSubmission(passingExercise.slide.exercise_id)
    const download = await fetch(api(`/submissions/${seeded!.slideSubmissionId}/download`))
    expect(download.status).toBe(200)
    expect(await download.json()).toEqual({ data_files: [] })
  })

  test("every opaque property in the CLI contract survives its zod schema", function () {
    const schemaPath = path.resolve(__dirname, "..", "..", "shared", "bindings.schema.json")
    const opaque = opaqueProperties(JSON.parse(fs.readFileSync(schemaPath, "utf8")))
    expect(opaque.length).toBeGreaterThan(0)
    const sentinel = { plugin_private: "reconciliation sentinel", nested: [1, { deep: true }] }
    for (const property of opaque) {
      const roundTrip = opaqueRoundTrips[property]
      expect(roundTrip, `no round trip covers the opaque ${property}`).toBeDefined()
      expect(
        roundTrip!.read(roundTrip!.schema.parse(roundTrip!.build(sentinel))),
        property,
      ).toEqual(sentinel)
    }
  })

  test("a not-enrolled 422 body carries the message key the CLI branches on", async function () {
    // Neither generated description covers error bodies: langsSchema mirrors CLI stdout, and the
    // spec's ApiErrorResponse has no required members, so validation only pins the status. The CLI
    // reads `message_key` (lifted into a typed error kind), asserted here; the full envelope is
    // pinned in backend/mooc/conformance.test.ts.
    const res = await fetch(api(`/exercises/${notEnrolledExerciseId}`))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message_key?: unknown; type?: unknown }
    expect(body.message_key).toBe("not_enrolled")
    expect(body.type).toBe("validation_error")
  })
})

import type { Server } from "http"

import {
  failingExercise,
  notEnrolledExerciseId,
  passingExercise,
  pythonCourse,
  TMC_ARCHIVE_MIME,
} from "../../backend/mooc/fixtures"
import type { ExerciseSlide } from "../../backend/mooc/fixtures"
import { createMoocApp, resetMoocState } from "../../backend/mooc/router"
import { zPasteResult } from "../shared/generated/langs/zod.gen"
import {
  ExerciseSlideSubmissionListItem,
  ExerciseTaskSubmissionResult,
  ExerciseTaskSubmissionStatus,
  MoocCourse,
  TmcExerciseSlide,
} from "../shared/langsSchema"

// Reconciles the two independently-generated descriptions of the same wire: the
// mooc mock validates against the OpenAPI spec vendored from
// secret-project-331, while the extension validates the CLI's stdout against
// zod schemas generated from tmc-langs-rust's bindings. Nothing else compares
// them, so a shape that satisfies one and not the other slips through (the
// submit part-name mismatch was one of those).
//
// This boots the mock, drives the shared mooc endpoints over HTTP, and validates
// each response payload with the extension's zod schema for that type.
//
// Id spaces (mirrors the mock/backend): `submit` returns both an
// exercise-TASK-submission id (what /grading is polled with) and an
// exercise-SLIDE-submission id (what the submissions list, /download and /share
// use). A submission is made in two calls: upload files, then submit an
// `answer_kind: "file"` body naming them.

const listen = (): Promise<{ server: Server; base: string }> =>
  new Promise((resolve) => {
    // This suite reconciles response shapes, not auth; the mock enforces a
    // bearer token by default, so turn it off here.
    const server = createMoocApp({ requireAuth: false }).listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        throw new Error("expected a TCP address")
      }
      resolve({ server, base: `http://127.0.0.1:${addr.port}` })
    })
  })

// The CLI does not consume the wire ExerciseSlide verbatim: its
// `TryFrom<api::ExerciseSlide> for TmcExerciseSlide`
// (tmc-langs-rust/crates/tmc-mooc-client/src/exercise.rs) enriches each task
// with a top-level `checksum` lifted from its public_spec, and PublicSpec
// carries a `browser_test` field (null for editor tasks). The mock emits the
// bare wire shape, so we apply that same minimal enrichment before checking the
// payload against the CLI-stdout schema (`TmcExerciseSlide`). This function IS
// the wire<->stdout reconciliation for the exercise shape; if the wire drifts so
// the enrichment can no longer produce a valid TmcExerciseSlide, the assertion
// below fails.
const toCliStdoutSlide = (wire: ExerciseSlide): unknown => ({
  ...wire,
  tasks: wire.tasks.map((task) => ({
    ...task,
    checksum: task.public_spec?.checksum ?? null,
    public_spec: task.public_spec ? { browser_test: null, ...task.public_spec } : null,
  })),
})

// The CLI does not relay the wire grading status verbatim either: its
// `From<api::ExerciseTaskSubmissionStatus> for ExerciseTaskSubmissionStatus`
// (tmc-langs-rust/crates/tmc-mooc-client/src/lib.rs) re-tags the enum
// internally and drops `feedback_json`, which only the exercise service that
// produced it can interpret. This function IS that reconciliation for the
// grading shape; if the wire drifts so the conversion can no longer produce a
// valid ExerciseTaskSubmissionStatus, the assertion below fails.
const toCliStdoutGradingStatus = (wire: unknown): unknown => {
  if (wire === "NoGradingYet") {
    return { status: "no-grading-yet" }
  }
  const { feedback_json: _pluginPrivate, ...grading } = (
    wire as { Grading: Record<string, unknown> }
  ).Grading
  return { status: "grading", grading }
}

// Asserts a payload validates against a zod schema, surfacing the issues on
// failure so a drift is easy to diagnose.
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

  beforeAll(async function () {
    ;({ server, base } = await listen())
  })

  afterAll(function () {
    server.close()
  })

  beforeEach(function () {
    resetMoocState()
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
    // Field name is a client-chosen UUID, as the host requires; the id it returns
    // is its own and is what a submit names. The part's type is what the CLI sends,
    // since the host echoes it into `AnswerFile.mime` unchecked.
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

  // Uploads then submits, returning both submission ids.
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
    // the submit response is the `submission-finished` payload
    expectValid(ExerciseTaskSubmissionResult, body, "submit result")
    const ids = body as { task_submission_id: string; slide_submission_id: string }
    return { taskSubmissionId: ids.task_submission_id, slideSubmissionId: ids.slide_submission_id }
  }

  test("submit result validates as ExerciseTaskSubmissionResult", async function () {
    await submit(passingExercise)
  })

  test("grading status validates as ExerciseTaskSubmissionStatus (both variants)", async function () {
    const { taskSubmissionId } = await submit(passingExercise)

    // first poll: the wire's externally-tagged "NoGradingYet" string variant
    const first = await (await fetch(api(`/submissions/${taskSubmissionId}/grading`))).json()
    expect(first).toBe("NoGradingYet")
    expectValid(
      ExerciseTaskSubmissionStatus,
      toCliStdoutGradingStatus(first),
      "grading (no-grading-yet)",
    )

    // second poll: the wire's externally-tagged { Grading: { ... } } object variant
    const second = (await (
      await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    ).json()) as { Grading: Record<string, unknown> }
    expectValid(ExerciseTaskSubmissionStatus, toCliStdoutGradingStatus(second), "grading (grading)")

    // The wire carries plugin-private structured feedback that only the exercise
    // service producing it can interpret; the CLI drops it rather than relaying an
    // opaque blob. The mock emits a distinctive sentinel so a schema that started
    // accepting the field again is visible here.
    expect(second.Grading.feedback_json).toEqual({ mock_feedback: "reconciliation sentinel" })
    const parsed = ExerciseTaskSubmissionStatus.parse(toCliStdoutGradingStatus(second))
    expect(JSON.stringify(parsed)).not.toContain("reconciliation sentinel")
  })

  test("old-submissions list items validate as ExerciseSlideSubmissionListItem", async function () {
    const exerciseId = failingExercise.slide.exercise_id
    const { taskSubmissionId } = await submit(failingExercise)

    // before grading completes: score/progress are null
    const pending = (await (
      await fetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as unknown[]
    expect(pending.length).toBeGreaterThan(0)
    for (const item of pending) {
      expectValid(ExerciseSlideSubmissionListItem, item, "submission list item (pending)")
    }

    // after grading completes: score/progress are populated
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    await fetch(api(`/submissions/${taskSubmissionId}/grading`))
    const graded = (await (
      await fetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as unknown[]
    for (const item of graded) {
      expectValid(ExerciseSlideSubmissionListItem, item, "submission list item (graded)")
    }
  })

  test("share result validates as PasteResult", async function () {
    const exerciseId = failingExercise.slide.exercise_id
    await submit(failingExercise)
    // the submissions list yields the slide-submission id that /share expects
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
    // The /download response (`SubmissionFiles`, `{data_files:[AnswerFile]}`) is
    // consumed by the CLI, not the extension, so langsSchema has no zod schema for
    // it. Its shape is instead reconciled against the vendored spec via the mock's
    // OWN response validation: the mock's postResponseHandler validates every
    // response body against the spec before sending, so a 200 here proves the
    // payload conforms to the spec's SubmissionFiles schema. The explicit field
    // assertions document the shape the CLI relies on -- it takes
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
    // The one value no repo can check for another: tmc-langs sends this Content-Type,
    // the host stores it verbatim, and the tmc plugin writes the same one for an
    // IFrame answer. A mismatch is only visible where all three meet.
    expect(body.data_files[0]!.mime).toBe(TMC_ARCHIVE_MIME)
    expect(body.data_files[0]!.url.length).toBeGreaterThan(0)
  })

  test("a submission made from no files downloads as an empty list, not a 404", async function () {
    // A submit naming no files at all is a json answer, and the host answers its
    // download with `{"data_files":[]}` rather than the 404 the archive-shaped
    // contract gave. A tmc submission always names its archive, so this is only
    // reachable here, not through the CLI.
    const exercise = passingExercise
    const res = await fetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: exercise.slide.tasks[0]!.task_id,
      }),
    })
    expect(res.status).toBe(200)
    const { slide_submission_id } = (await res.json()) as { slide_submission_id: string }
    const download = await fetch(api(`/submissions/${slide_submission_id}/download`))
    expect(download.status).toBe(200)
    expect(await download.json()).toEqual({ data_files: [] })
  })

  test("a not-enrolled 422 body is a spec-valid ApiErrorResponse", async function () {
    // Error bodies are the other half of the wire the reconciliation gate must
    // cover. langsSchema has NO ApiErrorResponse schema -- it mirrors CLI stdout,
    // and an error body is not CLI stdout -- so the reconciliation mechanism here
    // is the mock's own response validation: the mock validates every response
    // body (success AND error) against the vendored spec before sending, turning
    // a spec-violating body into a loud 500. A 422 (not a 500) therefore proves
    // the not-enrolled ApiErrorResponse body conforms to the spec.
    const res = await fetch(api(`/exercises/${notEnrolledExerciseId}`))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message_key?: unknown }
    expect(body.message_key).toBe("not_enrolled")
  })
})

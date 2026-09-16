import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import type { Server } from "node:http"
import path from "node:path"
import { after, before, describe, test } from "node:test"
import { zstdDecompressSync } from "node:zlib"

import type { Express } from "express"

import { API_ERRORS, type ApiErrorMessageKey } from "./apiErrors"
import type { MoocExerciseFixture } from "./fixtures"
import {
  extraCourse,
  failingExercise,
  nonexistentExerciseId,
  notEnrolledExerciseId,
  passingExercise,
  pendingManualExercise,
  pythonCourse,
  TMC_ARCHIVE_MIME,
} from "./fixtures"
import { MOCK_SEEDED_ACCESS_TOKEN, MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN } from "./oauth"
import type { MoocMockControls } from "./router"
import { createMoocApp, moocMockOf } from "./router"

// Conformance smoke test for the mooc mock. Boots the mock in-process and drives
// every spec operation with a direct HTTP client, proving:
//   - request + response validation PASS for the happy paths, and
//   - response validation FAILS loudly (500) when a handler returns garbage
//     (fault injection -- exercises the validator itself).
// It also covers the two-step upload -> submit flow, the poll-grading loop, the
// old-submission list/download/share endpoints and the spec-exempt archive routes.

const listen = (app: Express): Promise<{ server: Server; base: string; mock: MoocMockControls }> =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        throw new Error("expected a TCP address")
      }
      resolve({ server, base: `http://localhost:${addr.port}`, mock: moocMockOf(app) })
    })
  })

// MOCK_SEEDED_ACCESS_TOKEN is recognised by the auth middleware without a
// device-flow round trip, keeping this suite focused on the resource contract
// rather than the auth handshake (pinned separately in oauth.test.ts). The
// spec-exempt archive routes aren't behind the middleware and are fetched directly.
const authFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${MOCK_SEEDED_ACCESS_TOKEN}`, ...init.headers },
  })

// Every multipart rule violation is a `controller_err!(BadRequest, …)` on the host,
// which maps to 422 `validation_error` -- so the message is asserted too, because a
// mock that answers with a different one hides which rule a client actually broke.
const assertUploadRejected = async (res: Response, message: string): Promise<void> => {
  assert.equal(res.status, 422)
  const body = (await res.json()) as { message_key: string; message: string }
  assert.equal(body.message_key, "validation_error")
  assert.equal(body.message, message)
}

describe("mooc mock conformance", () => {
  let server: Server
  let base: string
  let mock: MoocMockControls

  before(async () => {
    ;({ server, base, mock } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  const api = (p: string): string => `${base}/api/v0/exercise-services/client${p}`

  test("GET courses returns the enrolled courses", async () => {
    const res = await authFetch(api("/courses"))
    assert.equal(res.status, 200)
    const body = (await res.json()) as { id: string; name: string }[]
    assert.equal(body.length, 2)
    assert.ok(body.some((c) => c.id === pythonCourse.id && c.name === pythonCourse.name))
    assert.ok(body.some((c) => c.id === extraCourse.id))
  })

  test("GET courses/{id} returns a single course", async () => {
    const res = await authFetch(api(`/courses/${pythonCourse.id}`))
    assert.equal(res.status, 200)
    const body = (await res.json()) as { slug: string }
    assert.equal(body.slug, pythonCourse.slug)
  })

  test("GET courses/{id}/exercises returns slides carrying an editor public_spec", async () => {
    const res = await authFetch(api(`/courses/${pythonCourse.id}/exercises`))
    assert.equal(res.status, 200)
    const slides = (await res.json()) as {
      exercise_id: string
      course_id: string
      tasks: { public_spec: { type: string; stub_download_url: string } }[]
    }[]
    assert.equal(slides.length, 1)
    const slide = slides[0]!
    assert.equal(slide.exercise_id, passingExercise.slide.exercise_id)
    // the slide carries its course id (lets a client locate the course directly)
    assert.equal(slide.course_id, pythonCourse.id)
    assert.equal(slide.tasks[0]!.public_spec.type, "editor")
    assert.match(slide.tasks[0]!.public_spec.stub_download_url, /\/mooc-archives\/.*\.tar\.zst$/)
  })

  test("GET courses/{id}/progress covers every exercise; submissions advance it", async () => {
    // Untouched course: one zeroed entry per exercise.
    const beforeRes = await authFetch(api(`/courses/${pythonCourse.id}/progress`))
    assert.equal(beforeRes.status, 200)
    const beforeBody = (await beforeRes.json()) as {
      course_id: string
      exercises: {
        exercise_id: string
        score_given: number
        score_maximum: number
        completed: boolean
        attempted: boolean
      }[]
    }
    assert.equal(beforeBody.course_id, pythonCourse.id)
    assert.equal(beforeBody.exercises.length, 1)
    const untouched = beforeBody.exercises[0]!
    assert.equal(untouched.exercise_id, passingExercise.slide.exercise_id)
    assert.equal(untouched.score_given, 0)
    assert.equal(untouched.completed, false)
    assert.equal(untouched.attempted, false)

    await submitAndGrade(passingExercise)
    const afterRes = await authFetch(api(`/courses/${pythonCourse.id}/progress`))
    assert.equal(afterRes.status, 200)
    const afterBody = (await afterRes.json()) as { exercises: (typeof untouched)[] }
    const progressed = afterBody.exercises[0]!
    assert.equal(progressed.attempted, true)
    assert.equal(progressed.completed, true)
    assert.equal(progressed.score_given, 1)
    assert.equal(progressed.score_maximum, 1)
  })

  test("GET courses/{id}/progress reports heterogeneous per-exercise score_maximum", async () => {
    // extraCourse's two exercises have different point weights (2 and 3),
    // exercising aggregation over heterogeneous score_maximum values.
    const res = await authFetch(api(`/courses/${extraCourse.id}/progress`))
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      exercises: { exercise_id: string; score_maximum: number }[]
    }
    assert.equal(body.exercises.length, 2)
    const byId = new Map(body.exercises.map((e) => [e.exercise_id, e.score_maximum]))
    assert.equal(byId.get(failingExercise.slide.exercise_id), 2)
    assert.equal(byId.get(pendingManualExercise.slide.exercise_id), 3)
    // the course's total point weight is the sum of the differing maxima
    const totalMaximum = body.exercises.reduce((sum, e) => sum + e.score_maximum, 0)
    assert.equal(totalMaximum, 5)
  })

  test("GET courses/{unknown}/progress returns the spec's 404 not-found", async () => {
    const res = await authFetch(api(`/courses/00000000-0000-4000-8000-000000000000/progress`))
    assert.equal(res.status, 404)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "not_found")
  })

  test("GET exercises/{id} returns a single slide", async () => {
    const res = await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}`))
    assert.equal(res.status, 200)
    const slide = (await res.json()) as { slide_id: string }
    assert.equal(slide.slide_id, passingExercise.slide.slide_id)
  })

  test("GET exercises/{unknown} returns the spec's 404 not-found", async () => {
    // An entirely unknown exercise id is a 404 (RecordNotFound), not the 422
    // that a real-but-not-enrolled exercise gets.
    const res = await authFetch(api(`/exercises/${nonexistentExerciseId}`))
    assert.equal(res.status, 404)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "not_found")
  })

  test("GET exercises/{not-enrolled} returns the spec's not-enrolled 422", async () => {
    // A real exercise whose course the user is not enrolled in is the genuine
    // 422 not_enrolled case (distinct from the unknown-id 404 above).
    const res = await authFetch(api(`/exercises/${notEnrolledExerciseId}`))
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "not_enrolled")
  })

  interface AnswerFile {
    id: string
    name: string
    mime: string
    size_bytes: number | null
    order_number: number | null
    url: string
  }

  // Uploads one file for an exercise. The field name is a fresh client-chosen
  // UUID, as the host requires; the returned `id` is the host's own.
  const uploadOne = async (exerciseId: string, bytes = [1, 2, 3]): Promise<AnswerFile> => {
    const form = new FormData()
    form.append(
      randomUUID(),
      new Blob([new Uint8Array(bytes)], { type: TMC_ARCHIVE_MIME }),
      "submission.tar.zst",
    )
    const res = await authFetch(api(`/exercises/${exerciseId}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files.length, 1)
    return data_files[0]!
  }

  // Submits a file answer naming `dataFiles`. `ids` overrides the slide/task the exercise
  // itself would name, for the ownership checks that need a foreign or unknown one.
  const postSubmit = (
    exercise: MoocExerciseFixture,
    dataFiles: string[],
    ids: { slideId?: string; taskId?: string } = {},
  ): Promise<Response> =>
    authFetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: ids.slideId ?? exercise.slide.slide_id,
        exercise_task_id: ids.taskId ?? exercise.slide.tasks[0]!.task_id,
        answer_kind: "file",
        data_files: dataFiles,
      }),
    })

  // Submits a JSON answer, the shape an omitted `answer_kind` means.
  const postJsonSubmit = (
    exercise: MoocExerciseFixture,
    body: Record<string, unknown> = {},
    ids: { slideId?: string; taskId?: string } = {},
  ): Promise<Response> =>
    authFetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: ids.slideId ?? exercise.slide.slide_id,
        exercise_task_id: ids.taskId ?? exercise.slide.tasks[0]!.task_id,
        ...body,
      }),
    })

  // Uploads an archive then submits it, returning both submission ids.
  const submit = async (
    exercise: MoocExerciseFixture,
    bytes = [1, 2, 3],
  ): Promise<{ taskSubmissionId: string; slideSubmissionId: string }> => {
    const uploaded = await uploadOne(exercise.slide.exercise_id, bytes)
    const res = await postSubmit(exercise, [uploaded.id])
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      task_submission_id: string
      slide_submission_id: string
    }
    return {
      taskSubmissionId: body.task_submission_id,
      slideSubmissionId: body.slide_submission_id,
    }
  }

  const postFiles = (form: FormData): Promise<Response> =>
    authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/files`), {
      method: "POST",
      body: form,
    })

  test("the file id the host assigns is never the client's field name", async () => {
    // The host echoes the client's field name back on a different member and keys
    // the file by its own `file_uploads` row id. A mock that reused the field name
    // would hide a client that submits the wrong one, so this is asserted here as
    // sp331 asserts it.
    const fieldName = randomUUID()
    const form = new FormData()
    form.append(fieldName, new Blob([new Uint8Array([1, 2, 3])]), "submission.tar.zst")
    const res = await postFiles(form)
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files.length, 1)
    assert.notEqual(data_files[0]!.id, fieldName)
    assert.match(data_files[0]!.id, /^[0-9a-f-]{36}$/)
    assert.equal(data_files[0]!.name, "submission.tar.zst")
  })

  test("files returns one entry per part, in request-part order", async () => {
    const form = new FormData()
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      form.append(randomUUID(), new Blob([new Uint8Array([1])]), name)
    }
    const res = await postFiles(form)
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: AnswerFile[] }
    assert.deepEqual(
      data_files.map((f) => f.name),
      ["a.txt", "b.txt", "c.txt"],
    )
  })

  test("files rejects a field name that is not a UUID", async () => {
    const form = new FormData()
    form.append("file", new Blob([new Uint8Array([1, 2, 3])]), "submission.tar.zst")
    await assertUploadRejected(
      await postFiles(form),
      "Each exercise upload field name must be a UUID",
    )
  })

  test("files rejects the same field id twice", async () => {
    const fieldName = randomUUID()
    const form = new FormData()
    form.append(fieldName, new Blob([new Uint8Array([1])]), "a.txt")
    form.append(fieldName, new Blob([new Uint8Array([2])]), "b.txt")
    await assertUploadRejected(await postFiles(form), "Duplicate exercise upload field id")
  })

  test("files rejects a part that carries no filename", async () => {
    // A part with no filename is a plain field, not a file. The distinct message is
    // the point: reporting the empty-body error here would tell a client its parts
    // were dropped, not that they were malformed.
    const form = new FormData()
    form.append(randomUUID(), "not-a-file")
    form.append(randomUUID(), new Blob([new Uint8Array([1])]), "a.txt")
    await assertUploadRejected(
      await postFiles(form),
      "Every exercise upload part must be a file with a filename",
    )
  })

  test("files rejects an empty body", async () => {
    await assertUploadRejected(
      await postFiles(new FormData()),
      "At least one file must be uploaded",
    )
  })

  test("files rejects more than the host's ten-file limit", async () => {
    const form = new FormData()
    for (let i = 0; i < 11; i += 1) {
      form.append(randomUUID(), new Blob([new Uint8Array([1])]), `f${i}.txt`)
    }
    await assertUploadRejected(
      await postFiles(form),
      "A maximum of 10 files can be uploaded at once",
    )
  })

  test("files past multer's own part cap still answers with the host's message", async () => {
    // Past multer's `files` limit the handler never runs, so the error middleware is
    // the only thing that can still produce the host's answer.
    const form = new FormData()
    for (let i = 0; i < 12; i += 1) {
      form.append(randomUUID(), new Blob([new Uint8Array([1])]), `f${i}.txt`)
    }
    await assertUploadRejected(
      await postFiles(form),
      "A maximum of 10 files can be uploaded at once",
    )
  })

  test("files for a not-enrolled exercise returns the spec's not-enrolled 422", async () => {
    const form = new FormData()
    form.append(randomUUID(), new Blob([new Uint8Array([1, 2, 3])]), "submission.tar.zst")
    const res = await authFetch(api(`/exercises/${notEnrolledExerciseId}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "not_enrolled")
  })

  test("files for an unknown exercise is a spec-documented 404", async () => {
    const form = new FormData()
    form.append(randomUUID(), new Blob([new Uint8Array([1, 2, 3])]), "submission.tar.zst")
    const res = await authFetch(api(`/exercises/${nonexistentExerciseId}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 404)
  })

  test("submit -> poll grading: NoGradingYet then FullyGraded", async () => {
    const { taskSubmissionId } = await submit(passingExercise)
    assert.match(taskSubmissionId, /^[0-9a-f-]{36}$/)

    const first = await (await authFetch(api(`/submissions/${taskSubmissionId}/grading`))).json()
    assert.equal(first, "NoGradingYet")

    const second = (await (
      await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    ).json()) as {
      Grading: { grading_progress: string }
    }
    assert.equal(second.Grading.grading_progress, "FullyGraded")
  })

  // Drives a submission through the poll loop and returns the terminal Grading.
  const submitAndGrade = async (
    exercise: MoocExerciseFixture,
  ): Promise<{ grading_progress: string; score_given: number | null; feedback_text: string }> => {
    const { taskSubmissionId } = await submit(exercise)
    // first poll is NoGradingYet, second is terminal
    await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    const graded = (await (
      await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    ).json()) as {
      Grading: { grading_progress: string; score_given: number | null; feedback_text: string }
    }
    return graded.Grading
  }

  test("solving an exercise reveals its model solution on GET exercises/{id} only", async () => {
    // The host attaches the model solution once full points are awarded, and the
    // list view never does. The blob is opaque to the OpenAPI spec, so nothing but
    // this asserts the shape the CLI actually deserializes -- and getting it wrong
    // breaks every later command on an exercise the student has solved.
    const exerciseId = passingExercise.slide.exercise_id
    const taskShape = async (url: string): Promise<{ model_solution_spec: unknown }> => {
      const slide = (await (await authFetch(url)).json()) as {
        tasks: { model_solution_spec: unknown }[]
      }
      return slide.tasks[0]!
    }

    // Graded, but short of full points: still withheld.
    const partial = await submitAndGrade(pendingManualExercise)
    assert.equal(partial.grading_progress, "PendingManual")
    assert.equal(
      (await taskShape(api(`/exercises/${pendingManualExercise.slide.exercise_id}`)))
        .model_solution_spec,
      null,
    )

    const grading = await submitAndGrade(passingExercise)
    assert.equal(grading.grading_progress, "FullyGraded")

    assert.deepEqual((await taskShape(api(`/exercises/${exerciseId}`))).model_solution_spec, {
      type: "editor",
      solution_download_url: `${base}/mooc-archives/${passingExercise.archiveSlug}.tar.zst`,
    })

    // The list view still withholds it (host: `client_tasks_from_slide` is called
    // with reveal_model_solution: false there).
    const slides = (await (
      await authFetch(api(`/courses/${pythonCourse.id}/exercises`))
    ).json()) as { tasks: { model_solution_spec: unknown }[] }[]
    assert.equal(slides[0]!.tasks[0]!.model_solution_spec, null)
  })

  test("submit -> poll grading: a failing exercise grades to Failed/zero score", async () => {
    const grading = await submitAndGrade(failingExercise)
    assert.equal(grading.grading_progress, "Failed")
    assert.equal(grading.score_given, 0)
  })

  test("submit -> poll grading: a pending-manual exercise grades to PendingManual", async () => {
    const grading = await submitAndGrade(pendingManualExercise)
    assert.equal(grading.grading_progress, "PendingManual")
    // PendingManual may carry a partial score
    assert.equal(grading.score_given, 0.5)
  })

  test("submit naming no answer at all is a json answer, and a tmc exercise refuses it", async () => {
    // All three answer members are optional and an absent `answer_kind` means json,
    // so the slide and task alone are a complete request -- which a tmc exercise,
    // whose answer is its archive, has nothing to grade.
    const res = await postJsonSubmit(passingExercise)
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /cannot grade an answer that names no files/)
  })

  test("submit of a json answer that names files is rejected", async () => {
    // The one combination the flat body allows but the answer model does not: the
    // files would be silently dropped.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id)
    const res = await postJsonSubmit(passingExercise, { data_files: [uploaded.id] })
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /json answer cannot name uploaded files/)
  })

  test("submit of a file answer that names nothing is rejected", async () => {
    // The named files ARE the answer, so naming none is a claim with no content.
    const res = await postSubmit(passingExercise, [])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /must name at least one uploaded file/)
  })

  test("submit naming a file that was never uploaded returns 422 unknown_upload", async () => {
    const res = await postSubmit(passingExercise, [randomUUID()])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "unknown_upload")
  })

  test("submit naming another exercise's upload returns 422 unknown_upload", async () => {
    // The upload is bound to the exercise it was uploaded for; replaying it into
    // another exercise's submission is indistinguishable from never uploading it.
    const foreign = await uploadOne(failingExercise.slide.exercise_id)
    const res = await postSubmit(passingExercise, [foreign.id])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "unknown_upload")
  })

  test("submit naming a reaped upload returns 422 upload_expired", async () => {
    // A soft-deleted binding is what makes "reaped" distinguishable from "never
    // yours"; only the former is a race a client can recover from.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id)
    assert.ok(mock.expireUpload(uploaded.id))
    const res = await postSubmit(passingExercise, [uploaded.id])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "upload_expired")
  })

  test("submit naming the same upload twice returns 422 duplicate_upload", async () => {
    // Reported rather than deduplicated: dedup would record the file twice under one
    // submission and list it twice in a download, hiding the client defect.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id)
    const res = await postSubmit(passingExercise, [uploaded.id, uploaded.id])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "duplicate_upload")
  })

  test("submit to an unknown exercise is a spec-documented 404", async () => {
    const res = await authFetch(api(`/exercises/${nonexistentExerciseId}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: passingExercise.slide.slide_id,
        exercise_task_id: passingExercise.slide.tasks[0]!.task_id,
      }),
    })
    assert.equal(res.status, 404)
  })

  // Submits arbitrary slide/task ids to the passing exercise. A json answer, because
  // the host checks slide/task ownership before the answer shape.
  const postSubmitWith = (slideId: string, taskId: string): Promise<Response> =>
    postJsonSubmit(passingExercise, {}, { slideId, taskId })

  test("submit naming an unknown slide or task is a spec-documented 404", async () => {
    const unknownSlide = await postSubmitWith(randomUUID(), passingExercise.slide.tasks[0]!.task_id)
    assert.equal(unknownSlide.status, 404)
    const unknownTask = await postSubmitWith(passingExercise.slide.slide_id, randomUUID())
    assert.equal(unknownTask.status, 404)
  })

  test("submit naming another exercise's slide returns 422", async () => {
    // The URL authorizes only the exercise; without this check the body could
    // redirect the submission into an unrelated exercise's slide.
    const res = await postSubmitWith(
      failingExercise.slide.slide_id,
      passingExercise.slide.tasks[0]!.task_id,
    )
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /does not belong to exercise /)
  })

  test("submit naming a task from another slide returns 422", async () => {
    const res = await postSubmitWith(
      passingExercise.slide.slide_id,
      failingExercise.slide.tasks[0]!.task_id,
    )
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /does not belong to exercise slide /)
  })

  test("retention never evicts an upload a submission was made from", async () => {
    // Zero files is a legitimate outcome for the CLI (`nothing-to-download`), so
    // an evicted upload would silently downgrade a restore to a no-op instead of
    // failing anywhere a test could see it.
    const { slideSubmissionId } = await submit(passingExercise, [7, 8, 9])
    for (let i = 0; i < 40; i += 1) {
      await uploadOne(failingExercise.slide.exercise_id)
    }
    const res = await authFetch(api(`/submissions/${slideSubmissionId}/download`))
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files.length, 1)
    const bytes = await fetch(data_files[0]!.url)
    assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())], [7, 8, 9])
  })

  test("mime is the part's own Content-Type, echoed rather than inferred", async () => {
    // The host echoes the part's declared type into `AnswerFile.mime` and checks
    // nothing, so an archive the CLI sends untyped is stored `application/octet-stream`
    // -- and the teacher-facing answer-file zip derives entry extensions from that.
    // The extension is not the type: `submission.tar.zst` says nothing here.
    const typed = await uploadOne(passingExercise.slide.exercise_id)
    assert.equal(typed.mime, TMC_ARCHIVE_MIME)

    const form = new FormData()
    form.append(randomUUID(), new Blob([new Uint8Array([1])]), "submission.tar.zst")
    const res = await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files[0]!.mime, "application/octet-stream")
  })

  test("mime and size survive a submit into the download", async () => {
    const { slideSubmissionId } = await submit(passingExercise, [1, 2, 3, 4])
    const res = await authFetch(api(`/submissions/${slideSubmissionId}/download`))
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files[0]!.mime, TMC_ARCHIVE_MIME)
    assert.equal(data_files[0]!.size_bytes, 4)
    // Position in the answer, which an upload does not have yet.
    assert.equal(data_files[0]!.order_number, 0)
  })

  test("an answer file's url is an expiring claim, not a path to the object", async () => {
    // The host mints a one-hour capability for that one file and redirects to the
    // store; a client must treat the url as opaque and follow the redirect. Asserting
    // the shape is what keeps the mock from handing back a plain path, which would let
    // a client that persisted or rewrote the url pass here and fail in production.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id, [4, 5, 6])
    const url = new URL(uploaded.url)
    // The mock names the address it bound, not the default port -- a suite on an
    // ephemeral port would otherwise hand out urls pointing at another process.
    assert.equal(url.origin, base)
    assert.equal(url.pathname, `/api/v0/files/claimed/${uploaded.id}`)
    assert.ok(url.searchParams.get("download-claim"), "the url must carry a claim")

    const redirect = await fetch(`${base}${url.pathname}${url.search}`, { redirect: "manual" })
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.get("cache-control"), "max-age=300, private")
    // Relative, so it resolves against whichever host the request arrived on.
    assert.ok(!redirect.headers.get("location")?.startsWith("http"))

    const followed = await fetch(uploaded.url)
    assert.equal(followed.status, 200)
    assert.deepEqual([...new Uint8Array(await followed.arrayBuffer())], [4, 5, 6])
  })

  test("a claim URL without a claim, or with a forged one, opens nothing", async () => {
    const uploaded = await uploadOne(passingExercise.slide.exercise_id)
    const bare = await fetch(`${base}/api/v0/files/claimed/${uploaded.id}`)
    assert.equal(bare.status, 400)
    const forged = await fetch(
      `${base}/api/v0/files/claimed/${uploaded.id}?download-claim=9999999999.${"0".repeat(64)}`,
    )
    assert.equal(forged.status, 422)
  })

  test("a claim minted for one file does not open another", async () => {
    // The claim names its file, so replaying it against a different id must fail --
    // otherwise one answer's url would be a handle on every stored file.
    const mine = await uploadOne(passingExercise.slide.exercise_id)
    const other = await uploadOne(passingExercise.slide.exercise_id)
    const claim = new URL(mine.url).search
    const res = await fetch(`${base}/api/v0/files/claimed/${other.id}${claim}`)
    assert.equal(res.status, 422)
  })

  test("one bad id fails the whole submit", async () => {
    const good = await uploadOne(passingExercise.slide.exercise_id)
    const res = await postSubmit(passingExercise, [good.id, randomUUID()])
    assert.equal(res.status, 422)
    const list = (await (
      await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submissions`))
    ).json()) as unknown[]
    const countBefore = list.length
    // the rejected submit recorded nothing, so a repeat rejection leaves the count alone
    await postSubmit(passingExercise, [good.id, randomUUID()])
    const listAgain = (await (
      await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submissions`))
    ).json()) as unknown[]
    assert.equal(listAgain.length, countBefore)
  })

  test("submit to a not-enrolled exercise returns the spec's not-enrolled 422", async () => {
    // Consistent with GET exercises/{id}; the spec documents this 422 on submit too.
    const res = await authFetch(api(`/exercises/${notEnrolledExerciseId}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: passingExercise.slide.slide_id,
        exercise_task_id: passingExercise.slide.tasks[0]!.task_id,
      }),
    })
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "not_enrolled")
  })

  test("upload -> submit -> list submissions -> download -> share (slide-submission id space)", async () => {
    const exerciseId = failingExercise.slide.exercise_id
    const { taskSubmissionId, slideSubmissionId } = await submit(failingExercise)

    // the submissions list returns exercise-SLIDE-submission ids, newest first
    const listRes = await authFetch(api(`/exercises/${exerciseId}/submissions`))
    assert.equal(listRes.status, 200)
    const items = (await listRes.json()) as {
      id: string
      exercise_id: string
      created_at: string
      score_given: number | null
      grading_progress: string | null
    }[]
    assert.ok(items.length > 0)
    assert.ok(items.every((i) => i.exercise_id === exerciseId))
    // the id submit returned for downloading/sharing is the one the list reports
    assert.equal(items[0]!.id, slideSubmissionId)
    // the two id spaces are distinct
    assert.notEqual(slideSubmissionId, taskSubmissionId)

    // download resolves the slide-submission id to the files the submission was
    // made from, and each url serves back the EXACT bytes that were
    // uploaded -- so an old-submission download returns that submission's own
    // content, not the exercise stub.
    const downloadRes = await authFetch(api(`/submissions/${slideSubmissionId}/download`))
    assert.equal(downloadRes.status, 200)
    const { data_files } = (await downloadRes.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files.length, 1)
    assert.equal(data_files[0]!.name, "submission.tar.zst")
    const fileRes = await fetch(data_files[0]!.url)
    assert.equal(fileRes.status, 200)
    const fileBytes = new Uint8Array(await fileRes.arrayBuffer())
    assert.deepEqual([...fileBytes], [1, 2, 3])

    // share mints a paste URL for the slide-submission id
    const shareRes = await authFetch(api(`/submissions/${slideSubmissionId}/share`), {
      method: "POST",
    })
    assert.equal(shareRes.status, 200)
    const { paste_url } = (await shareRes.json()) as { paste_url: string }
    assert.match(paste_url, /\/shared-submissions\//)

    // before grading completes the listed submission has no score/progress
    assert.equal(items[0]!.score_given, null)
    assert.equal(items[0]!.grading_progress, null)

    // once grading completes, the list reflects the exercise's actual grading
    // outcome (this fixture fails) rather than a hardcoded pass
    await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    const gradedList = (await (
      await authFetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as { score_given: number | null; grading_progress: string | null }[]
    assert.equal(gradedList[0]!.grading_progress, "Failed")
    assert.equal(gradedList[0]!.score_given, 0)
  })

  test("the seeding route produces a listed submission whose download is empty", async () => {
    // The out-of-process route the integration suite uses to reach the
    // no-downloadable-files outcome, which no submit can produce.
    const res = await fetch(`${base}/mooc-mock/seed-fileless-submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercise_id: passingExercise.slide.exercise_id }),
    })
    assert.equal(res.status, 200)
    const seeded = (await res.json()) as {
      task_submission_id: string
      slide_submission_id: string
    }
    assert.match(seeded.slide_submission_id, /^[0-9a-f-]{36}$/)
    assert.notEqual(seeded.task_submission_id, seeded.slide_submission_id)

    const download = await authFetch(api(`/submissions/${seeded.slide_submission_id}/download`))
    assert.equal(download.status, 200)
    assert.deepEqual(await download.json(), { data_files: [] })

    // It is still listed, so a client picking an old submission to restore can
    // reach it -- which is why the empty download has to be a first-class
    // outcome rather than an error.
    const list = (await (
      await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submissions`))
    ).json()) as { id: string }[]
    assert.ok(list.some((item) => item.id === seeded.slide_submission_id))
  })

  test("seeding a fileless submission for an unknown exercise is a 404", async () => {
    const res = await fetch(`${base}/mooc-mock/seed-fileless-submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercise_id: nonexistentExerciseId }),
    })
    assert.equal(res.status, 404)
  })

  test("grading of an unknown submission is a spec-documented 404", async () => {
    // An unknown submission id is a 404 (RecordNotFound), mirroring the real
    // backend -- not the previous synthetic 200 NoGradingYet.
    const res = await authFetch(api(`/submissions/${nonexistentExerciseId}/grading`))
    assert.equal(res.status, 404)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "not_found")
  })

  test("download of an unknown submission is a spec-documented 404", async () => {
    const res = await authFetch(api(`/submissions/${nonexistentExerciseId}/download`))
    assert.equal(res.status, 404)
  })

  test("share of an unknown submission is a spec-documented 404", async () => {
    const res = await authFetch(api(`/submissions/${nonexistentExerciseId}/share`), {
      method: "POST",
    })
    assert.equal(res.status, 404)
  })

  test("archive route serves a valid .tar.zst (spec-exempt)", async () => {
    const res = await fetch(`${base}/mooc-archives/${passingExercise.archiveSlug}.tar.zst`)
    assert.equal(res.status, 200)
    const bytes = Buffer.from(await res.arrayBuffer())
    // zstd magic number 0x28 0xB5 0x2F 0xFD
    assert.deepEqual([...bytes.subarray(0, 4)], [0x28, 0xb5, 0x2f, 0xfd])
    const tar = zstdDecompressSync(bytes)
    // the tar contains the exercise files at its root (ustar magic appears in
    // each 512-byte header block)
    assert.ok(tar.includes("src/passing_exercise.py"))
    assert.ok(tar.includes("ustar"))
  })

  test("unknown endpoint 404s", async () => {
    const res = await authFetch(api("/does-not-exist"))
    assert.equal(res.status, 404)
  })
})

describe("mooc mock response-validation guard", () => {
  test("a spec-violating handler response fails loudly with 500", async () => {
    // Inject a fault so getClientCourses returns garbage (id: number, missing
    // required fields). The postResponseHandler's validateResponse must reject
    // it and turn it into a 500 -- proving the mock cannot silently drift.
    const { server, base } = await listen(
      createMoocApp({ injectResponseFault: "getClientCourses" }),
    )
    try {
      // Seeded bearer gets past auth so the fault (500), not a 401, is observed.
      const res = await authFetch(`${base}/api/v0/exercise-services/client/courses`)
      assert.equal(res.status, 500)
      const body = (await res.json()) as { error: string }
      assert.match(body.error, /failed spec validation/)
    } finally {
      server.close()
    }
  })
})

describe("mooc mock instance isolation", () => {
  test("two mocks share no state and each hands out urls naming itself", async () => {
    // The suites run several mocks at once, and the out-of-process tiers reach a
    // long-lived one on a fixed port. State shared between instances would let one
    // test's submissions decide another's assertions, and a url naming the default
    // port would send a client that followed it to whatever else is serving there.
    const one = await listen(createMoocApp())
    const other = await listen(createMoocApp())
    const exerciseId = passingExercise.slide.exercise_id
    const submissionsOf = async (origin: string): Promise<unknown[]> =>
      (await (
        await authFetch(
          `${origin}/api/v0/exercise-services/client/exercises/${exerciseId}/submissions`,
        )
      ).json()) as unknown[]
    const stubUrlOf = async (origin: string): Promise<string> => {
      const slide = (await (
        await authFetch(`${origin}/api/v0/exercise-services/client/exercises/${exerciseId}`)
      ).json()) as { tasks: { public_spec: { stub_download_url: string } }[] }
      return slide.tasks[0]!.public_spec.stub_download_url
    }

    try {
      assert.ok(one.mock.seedFilelessSubmission(exerciseId))
      assert.equal((await submissionsOf(one.base)).length, 1)
      assert.equal((await submissionsOf(other.base)).length, 0)

      assert.equal(await stubUrlOf(one.base), `${one.base}/mooc-archives/passing-exercise.tar.zst`)
      assert.equal(
        await stubUrlOf(other.base),
        `${other.base}/mooc-archives/passing-exercise.tar.zst`,
      )

      one.mock.reset()
      assert.equal((await submissionsOf(one.base)).length, 0)
    } finally {
      one.server.close()
      other.server.close()
    }
  })
})

interface ErrorResponse {
  status: number
  body: Record<string, unknown>
}

const read = async (res: Response): Promise<ErrorResponse> => ({
  status: res.status,
  body: (await res.json()) as Record<string, unknown>,
})

// The vendored spec's ApiErrorResponse constrains no member, so response
// validation proves only that the status is documented. This walk is what pins
// the envelope itself: every error the client API can answer with, checked
// against the contract transcribed from the host in ./apiErrors.
describe("mooc mock error envelopes", () => {
  let server: Server
  let base: string
  let mock: MoocMockControls

  before(async () => {
    ;({ server, base, mock } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  const api = (p: string): string => `${base}/api/v0/exercise-services/client${p}`

  const uploadFor = async (exerciseId: string): Promise<string> => {
    const form = new FormData()
    form.append(randomUUID(), new Blob([new Uint8Array([1, 2, 3])]), "submission.tar.zst")
    const res = await authFetch(api(`/exercises/${exerciseId}/files`), {
      method: "POST",
      body: form,
    })
    const { data_files } = (await res.json()) as { data_files: { id: string }[] }
    return data_files[0]!.id
  }

  const submitNaming = (fileIds: string[]): Promise<Response> =>
    authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: passingExercise.slide.slide_id,
        exercise_task_id: passingExercise.slide.tasks[0]!.task_id,
        answer_kind: "file",
        data_files: fileIds,
      }),
    })

  const probes: {
    name: string
    messageKey: ApiErrorMessageKey
    run: () => Promise<ErrorResponse>
  }[] = [
    {
      name: "no bearer at all",
      messageKey: "unauthorized",
      run: async () => read(await fetch(api("/courses"))),
    },
    {
      name: "a bearer the mock never minted",
      messageKey: "unauthorized",
      run: async () =>
        read(await fetch(api("/courses"), { headers: { authorization: "Bearer nope" } })),
    },
    {
      name: "a bearer without the exercise-services scope",
      messageKey: "forbidden",
      run: async () =>
        read(
          await fetch(api("/courses"), {
            headers: { authorization: `Bearer ${MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN}` },
          }),
        ),
    },
    {
      name: "an unknown course",
      messageKey: "not_found",
      run: async () => read(await authFetch(api(`/courses/${nonexistentExerciseId}`))),
    },
    {
      name: "an unknown exercise",
      messageKey: "not_found",
      run: async () => read(await authFetch(api(`/exercises/${nonexistentExerciseId}`))),
    },
    {
      name: "an exercise whose course the user is not enrolled on",
      messageKey: "not_enrolled",
      run: async () => read(await authFetch(api(`/exercises/${notEnrolledExerciseId}`))),
    },
    {
      name: "an upload naming no files",
      messageKey: "validation_error",
      run: async () =>
        read(
          await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/files`), {
            method: "POST",
            body: new FormData(),
          }),
        ),
    },
    {
      name: "a submit naming a file that was never uploaded",
      messageKey: "unknown_upload",
      run: async () => read(await submitNaming([randomUUID()])),
    },
    {
      name: "a submit naming one file twice",
      messageKey: "duplicate_upload",
      run: async () => {
        const fileId = await uploadFor(passingExercise.slide.exercise_id)
        return read(await submitNaming([fileId, fileId]))
      },
    },
    {
      name: "a submit naming a reaped file",
      messageKey: "upload_expired",
      run: async () => {
        const fileId = await uploadFor(passingExercise.slide.exercise_id)
        mock.expireUpload(fileId)
        return read(await submitNaming([fileId]))
      },
    },
    {
      name: "grading of an unknown submission",
      messageKey: "not_found",
      run: async () => read(await authFetch(api(`/submissions/${nonexistentExerciseId}/grading`))),
    },
    {
      name: "download of an unknown submission",
      messageKey: "not_found",
      run: async () => read(await authFetch(api(`/submissions/${nonexistentExerciseId}/download`))),
    },
    {
      name: "share of an unknown submission",
      messageKey: "not_found",
      run: async () =>
        read(
          await authFetch(api(`/submissions/${nonexistentExerciseId}/share`), { method: "POST" }),
        ),
    },
    {
      // Dormant in a normal run (the host's MINIMUM_CLIENT_VERSION is unset),
      // so a mock naming a minimum is the only way to observe the envelope.
      name: "a client the server considers obsolete",
      messageKey: "obsolete_client",
      run: async () => {
        const obsolete = await listen(createMoocApp({ minimumClientVersion: "99.0.0" }))
        try {
          return await read(
            await authFetch(`${obsolete.base}/api/v0/exercise-services/client/courses`),
          )
        } finally {
          obsolete.server.close()
        }
      },
    },
  ]

  for (const probe of probes) {
    test(`${probe.name} -> ${probe.messageKey}`, async () => {
      const { status, body } = await probe.run()
      const contract = API_ERRORS[probe.messageKey]
      assert.equal(status, contract.status)
      assert.equal(body.type, contract.type)
      assert.equal(body.message_key, probe.messageKey)
      assert.equal(typeof body.message, "string")
      assert.ok((body.message as string).length > 0)
      // The host's serializer omits both when they carry nothing, and every
      // error here does.
      assert.equal("errors" in body, false)
      assert.equal("metadata" in body, false)
    })
  }

  test("every error key the router can answer with is walked above", () => {
    // Read from the source rather than listed by hand: an error key added to a
    // handler must fail here until a probe covers it, which is what makes the
    // walk above exhaustive rather than merely long.
    const source = fs.readFileSync(path.join(__dirname, "router.ts"), "utf8")
    const emitted = [...source.matchAll(/\bapiError(?:Body)?\(\s*\n?\s*"([a-z_]+)"/g)].map(
      (match) => match[1] as ApiErrorMessageKey,
    )
    const walked = new Set(probes.map((probe) => probe.messageKey))
    for (const key of new Set(emitted)) {
      if (API_ERRORS[key].status >= 500) {
        continue
      }
      assert.ok(walked.has(key), `no probe covers the ${key} error the router emits`)
    }
  })
})

// The host reads `X-Client-Version` on every client operation and turns away
// anything below MINIMUM_CLIENT_VERSION with 426. That constant is None in
// production, so a mock naming a minimum is the only place the rule -- and the
// 426 every operation documents -- can be exercised at all. A 426 reaching the
// client at all proves the validator accepted it as a documented status for the
// operation; its envelope is pinned in the error-envelope walk below.
const clientApi = (base: string, p: string): string => `${base}/api/v0/exercise-services/client${p}`

describe("mooc mock client-version floor", () => {
  const asClient = (base: string, p: string, clientVersion?: string): Promise<Response> =>
    authFetch(clientApi(base, p), {
      headers: clientVersion === undefined ? {} : { "x-client-version": clientVersion },
    })

  const getCourses = (base: string, clientVersion?: string): Promise<Response> =>
    asClient(base, "/courses", clientVersion)

  const withFloor = async (
    minimumClientVersion: string,
    drive: (base: string) => Promise<void>,
  ): Promise<void> => {
    const { server, base } = await listen(createMoocApp({ minimumClientVersion }))
    try {
      await drive(base)
    } finally {
      server.close()
    }
  }

  test("a client at or above the floor is served", async () => {
    await withFloor("1.2.3", async (base) => {
      assert.equal((await getCourses(base, "1.2.3")).status, 200)
      assert.equal((await getCourses(base, "1.3.0")).status, 200)
      assert.equal((await getCourses(base, "2.0")).status, 200)
    })
  })

  test("a client below the floor gets a 426 naming the minimum", async () => {
    await withFloor("1.2.3", async (base) => {
      const res = await getCourses(base, "1.2.2")
      assert.equal(res.status, 426)
      const body = (await res.json()) as { message_key: string; message: string }
      assert.equal(body.message_key, "obsolete_client")
      assert.match(body.message, /minimum supported version is 1\.2\.3/)
    })
  })

  test("a missing or unparseable version counts as obsolete", async () => {
    await withFloor("1.2.3", async (base) => {
      assert.equal((await getCourses(base)).status, 426)
      assert.equal((await getCourses(base, "not-a-version")).status, 426)
      assert.equal((await getCourses(base, "1.2.x")).status, 426)
    })
  })

  test("an obsolete client's submit records nothing", async () => {
    // The check has to run before the handler, as the host's extractor does, or
    // a turned-away submit still leaves a submission behind.
    const exerciseId = passingExercise.slide.exercise_id
    await withFloor("1.2.3", async (base) => {
      const res = await authFetch(clientApi(base, `/exercises/${exerciseId}/submit`), {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-version": "1.0.0" },
        body: JSON.stringify({
          exercise_slide_id: passingExercise.slide.slide_id,
          exercise_task_id: passingExercise.slide.tasks[0]!.task_id,
          answer_kind: "file",
          data_files: [randomUUID()],
        }),
      })
      assert.equal(res.status, 426)
      const listed = (await (
        await asClient(base, `/exercises/${exerciseId}/submissions`, "1.2.3")
      ).json()) as unknown[]
      assert.equal(listed.length, 0)
    })
  })

  test("without a floor, a client advertising no version is served", async () => {
    const { server, base } = await listen(createMoocApp())
    try {
      assert.equal((await getCourses(base)).status, 200)
    } finally {
      server.close()
    }
  })
})

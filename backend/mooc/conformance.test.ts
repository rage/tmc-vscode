import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import type { Server } from "node:http"
import { after, before, describe, test } from "node:test"
import { zstdDecompressSync } from "node:zlib"

import type { Express } from "express"

import {
  extraCourse,
  failingExercise,
  nonexistentExerciseId,
  notEnrolledExerciseId,
  passingExercise,
  pendingManualExercise,
  pythonCourse,
} from "./fixtures"
import { MOCK_SEEDED_ACCESS_TOKEN } from "./oauth"
import { createMoocApp, expireMoocUpload } from "./router"

// Conformance smoke test for the mooc mock. Boots the mock in-process and drives
// every spec operation with a direct HTTP client, proving:
//   - request + response validation PASS for the happy paths, and
//   - response validation FAILS loudly (500) when a handler returns garbage
//     (fault injection -- exercises the validator itself).
// It also covers the two-step upload -> submit flow, the poll-grading loop, the
// old-submission list/download/share endpoints and the spec-exempt archive routes.

const listen = (app: Express): Promise<{ server: Server; base: string }> =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        throw new Error("expected a TCP address")
      }
      resolve({ server, base: `http://localhost:${addr.port}` })
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

  before(async () => {
    ;({ server, base } = await listen(createMoocApp()))
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

  interface UploadedFile {
    id: string
    name: string
    download_url: string
  }

  // Uploads one file for an exercise. The field name is a fresh client-chosen
  // UUID, as the host requires; the returned `id` is the host's own.
  const uploadOne = async (exerciseId: string, bytes = [1, 2, 3]): Promise<UploadedFile> => {
    const form = new FormData()
    form.append(randomUUID(), new Blob([new Uint8Array(bytes)]), "submission.tar.zst")
    const res = await authFetch(api(`/exercises/${exerciseId}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 200)
    const { files } = (await res.json()) as { files: UploadedFile[] }
    assert.equal(files.length, 1)
    return files[0]!
  }

  const postSubmit = (
    exercise: { slide: { exercise_id: string; slide_id: string; tasks: { task_id: string }[] } },
    uploadedFileIds: string[],
  ): Promise<Response> =>
    authFetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: exercise.slide.tasks[0]!.task_id,
        uploaded_file_ids: uploadedFileIds,
      }),
    })

  // Uploads an archive then submits it, returning both submission ids.
  const submit = async (
    exercise: { slide: { exercise_id: string; slide_id: string; tasks: { task_id: string }[] } },
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

  test("the file id the host assigns is never the client's field name", async () => {
    // The host echoes the client's field name back on a different member and keys
    // the file by its own `file_uploads` row id. A mock that reused the field name
    // would hide a client that submits the wrong one, so this is asserted here as
    // sp331 asserts it.
    const fieldName = randomUUID()
    const form = new FormData()
    form.append(fieldName, new Blob([new Uint8Array([1, 2, 3])]), "submission.tar.zst")
    const res = await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 200)
    const { files } = (await res.json()) as { files: UploadedFile[] }
    assert.equal(files.length, 1)
    assert.notEqual(files[0]!.id, fieldName)
    assert.match(files[0]!.id, /^[0-9a-f-]{36}$/)
    assert.equal(files[0]!.name, "submission.tar.zst")
  })

  test("files returns one entry per part, in request-part order", async () => {
    const form = new FormData()
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      form.append(randomUUID(), new Blob([new Uint8Array([1])]), name)
    }
    const res = await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/files`), {
      method: "POST",
      body: form,
    })
    assert.equal(res.status, 200)
    const { files } = (await res.json()) as { files: UploadedFile[] }
    assert.deepEqual(
      files.map((f) => f.name),
      ["a.txt", "b.txt", "c.txt"],
    )
  })

  const postFiles = (form: FormData): Promise<Response> =>
    authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/files`), {
      method: "POST",
      body: form,
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

  test("files rejects a batch multer's own part cap stops with the host's message", async () => {
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
  const submitAndGrade = async (exercise: {
    slide: { exercise_id: string; slide_id: string; tasks: { task_id: string }[] }
  }): Promise<{ grading_progress: string; score_given: number | null; feedback_text: string }> => {
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
      solution_download_url: passingExercise.modelSolution.solution_download_url,
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

  test("submit omitting uploaded_file_ids fails request validation", async () => {
    // The field is required with no default: a submit that leaves it out must be
    // rejected rather than treated as an empty list.
    const res = await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: passingExercise.slide.slide_id,
        exercise_task_id: passingExercise.slide.tasks[0]!.task_id,
      }),
    })
    assert.equal(res.status, 400)
  })

  test("submit with an empty uploaded_file_ids is accepted", async () => {
    const res = await postSubmit(passingExercise, [])
    assert.equal(res.status, 200)
    const body = (await res.json()) as { task_submission_id: string; slide_submission_id: string }
    assert.match(body.task_submission_id, /^[0-9a-f-]{36}$/)
    assert.notEqual(body.task_submission_id, body.slide_submission_id)
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
    assert.ok(expireMoocUpload(uploaded.id))
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
        uploaded_file_ids: [],
      }),
    })
    assert.equal(res.status, 404)
  })

  // Submits arbitrary slide/task ids to the passing exercise.
  const postSubmitWith = (slideId: string, taskId: string): Promise<Response> =>
    authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: slideId,
        exercise_task_id: taskId,
        uploaded_file_ids: [],
      }),
    })

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
    // The CLI's restore errors on any file count other than one, so an evicted
    // upload would turn a download into a silent failure rather than a 404.
    const { slideSubmissionId } = await submit(passingExercise, [7, 8, 9])
    for (let i = 0; i < 40; i += 1) {
      await uploadOne(failingExercise.slide.exercise_id)
    }
    const res = await authFetch(api(`/submissions/${slideSubmissionId}/download`))
    assert.equal(res.status, 200)
    const { files } = (await res.json()) as { files: UploadedFile[] }
    assert.equal(files.length, 1)
    const bytes = await fetch(`${base}${new URL(files[0]!.download_url).pathname}`)
    assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())], [7, 8, 9])
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
        uploaded_file_ids: [],
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
    // made from, and each download_url serves back the EXACT bytes that were
    // uploaded -- so an old-submission download returns that submission's own
    // content, not the exercise stub.
    const downloadRes = await authFetch(api(`/submissions/${slideSubmissionId}/download`))
    assert.equal(downloadRes.status, 200)
    const { files } = (await downloadRes.json()) as { files: UploadedFile[] }
    assert.equal(files.length, 1)
    assert.equal(files[0]!.name, "submission.tar.zst")
    // The download_url carries the fixed MOOC_MOCK_BASE_URL host; fetch its path
    // against this test server (on a random port) to read the bytes.
    const filePath = new URL(files[0]!.download_url).pathname
    const fileRes = await fetch(`${base}${filePath}`)
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

  test("download of a submission made from no files is an empty list, not a 404", async () => {
    const res = await postSubmit(passingExercise, [])
    assert.equal(res.status, 200)
    const { slide_submission_id } = (await res.json()) as { slide_submission_id: string }
    const download = await authFetch(api(`/submissions/${slide_submission_id}/download`))
    assert.equal(download.status, 200)
    assert.deepEqual(await download.json(), { files: [] })

    // It is still listed, so a client picking an old submission to restore can
    // reach it -- which is why the empty download has to be a first-class
    // outcome rather than an error.
    const list = (await (
      await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}/submissions`))
    ).json()) as { id: string }[]
    assert.ok(list.some((item) => item.id === slide_submission_id))
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

  test("share of an unknown (foreign) submission is a spec-documented 403", async () => {
    const res = await authFetch(api(`/submissions/${nonexistentExerciseId}/share`), {
      method: "POST",
    })
    assert.equal(res.status, 403)
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

describe("mooc mock obsolete-client (426) fault", () => {
  test("an injected obsolete client yields a spec-valid 426 ApiErrorResponse", async () => {
    // The 426 obsolete-client contract is documented on every endpoint but is
    // dormant in normal runs (the backend's MINIMUM_CLIENT_VERSION is unset, so
    // no live response ever produces it). This test-only fault makes every
    // operation respond 426; the response is validated against the spec like any
    // other, so a 426 (rather than a 500 from the validator) PROVES the 426 body
    // conforms to the spec's ApiErrorResponse schema.
    const { server, base } = await listen(createMoocApp({ injectObsoleteClient: true }))
    try {
      // Seeded bearer gets past auth so the injected 426 (not a 401) is observed.
      const res = await authFetch(`${base}/api/v0/exercise-services/client/courses`)
      assert.equal(res.status, 426)
      const body = (await res.json()) as { message_key: string }
      assert.equal(body.message_key, "obsolete_client")
    } finally {
      server.close()
    }
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

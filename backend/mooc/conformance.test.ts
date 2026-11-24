import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import type { Server } from "node:http"
import path from "node:path"
import { after, before, beforeEach, describe, test } from "node:test"
import { zstdDecompressSync } from "node:zlib"

import type { Express } from "express"

import { MOCK_SEEDED_ACCESS_TOKEN, MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN } from "../mockSession"
import { API_ERRORS, type ApiErrorMessageKey } from "./apiErrors"
import type { MoocExerciseFixture } from "./fixtures"
import {
  browserExercise,
  collidingNameExercises,
  EXAM_ID,
  examExercise,
  extraCourse,
  failingExercise,
  futureDeadlineExercise,
  limitedTriesExercise,
  MOCK_DEFAULT_USER_ID,
  MOCK_USER_EMAIL,
  MOCK_USER_NAME,
  mixedTaskExercise,
  namesCourse,
  nonexistentExerciseId,
  notClientCapableExercise,
  notEnrolledCourse,
  notEnrolledExerciseId,
  passingExercise,
  pastDeadlineExercise,
  pathLikeNameExercise,
  pendingManualExercise,
  pythonCourse,
  TMC_ARCHIVE_MIME,
  variantsCourse,
} from "./fixtures"
import type { MoocMockControls } from "./router"
import { createMoocApp, moocMockOf } from "./router"

// Conformance smoke test for the mooc mock: drives every spec operation over HTTP, proving
// request + response validation pass on happy paths and fail loudly (500) when a handler
// returns garbage (fault injection). Also covers upload -> submit, the poll-grading loop,
// old-submission list/download/share and the spec-exempt archive routes.

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

// MOCK_SEEDED_ACCESS_TOKEN skips the device-flow round trip (pinned in oauth.test.ts). The
// spec-exempt archive routes sit outside the auth middleware and are fetched directly.
const authFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${MOCK_SEEDED_ACCESS_TOKEN}`, ...init.headers },
  })

// Every multipart rule violation is a `controller_err!(BadRequest, …)` on the host, i.e. 422
// `validation_error`. The message is asserted too, or a mock could hide which rule was broken.
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

  test("GET courses returns the enrolled courses and only those", async () => {
    const res = await authFetch(api("/courses"))
    assert.equal(res.status, 200)
    const body = (await res.json()) as { id: string; name: string }[]
    assert.equal(body.length, 3)
    assert.ok(body.some((c) => c.id === pythonCourse.id && c.name === pythonCourse.name))
    assert.ok(body.some((c) => c.id === extraCourse.id))
    assert.ok(body.some((c) => c.id === variantsCourse.id))
    assert.ok(!body.some((c) => c.id === notEnrolledCourse.id))
  })

  test("withdrawing the student drops the course from GET courses until a reset", async () => {
    try {
      assert.equal(mock.setEnrolled(pythonCourse.id, false), true)
      const withdrawn = (await (await authFetch(api("/courses"))).json()) as { id: string }[]
      assert.ok(!withdrawn.some((c) => c.id === pythonCourse.id))
    } finally {
      mock.reset()
    }
    const restored = (await (await authFetch(api("/courses"))).json()) as { id: string }[]
    assert.ok(restored.some((c) => c.id === pythonCourse.id))
    assert.equal(mock.setEnrolled("no-such-course", true), false)
  })

  test("a teacher's AI policy change shows in the course until a reset", async () => {
    const policy = async (): Promise<unknown> =>
      (
        (await (await authFetch(api(`/courses/${pythonCourse.id}`))).json()) as {
          ai_policy?: unknown
        }
      ).ai_policy
    try {
      assert.equal(mock.setAiPolicy(pythonCourse.id, "no_ai"), true)
      assert.equal(await policy(), "no_ai")
      assert.equal(pythonCourse.ai_policy, undefined)
    } finally {
      mock.reset()
    }
    assert.equal(await policy(), undefined)
    assert.equal(mock.setAiPolicy("no-such-course", "no_ai"), false)
  })

  test("a course closed to students refuses itself, its progress and its material", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    try {
      assert.equal(mock.setCourseAccess(pythonCourse.id, "forbidden"), true)
      const status = async (p: string): Promise<number> => (await authFetch(api(p))).status
      assert.equal(await status(`/courses/${pythonCourse.id}`), 403)
      assert.equal(await status(`/courses/${pythonCourse.id}/progress`), 403)
      const exercises = await authFetch(api(`/courses/${pythonCourse.id}/exercises`))
      assert.equal(exercises.status, 403)
      assert.equal(((await exercises.json()) as { message_key: string }).message_key, "no_access")
      assert.equal(await status(`/exercises/${exerciseId}`), 403)
    } finally {
      mock.reset()
    }
    assert.equal((await authFetch(api(`/courses/${pythonCourse.id}/exercises`))).status, 200)
  })

  test("a deleted course is gone from every route, and back once opened", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    const status = async (p: string): Promise<number> => (await authFetch(api(p))).status
    assert.equal(mock.setCourseAccess(pythonCourse.id, "deleted"), true)
    try {
      assert.equal(await status(`/courses/${pythonCourse.id}`), 404)
      assert.equal(await status(`/courses/${pythonCourse.id}/exercises`), 404)
      assert.equal(await status(`/courses/${pythonCourse.id}/progress`), 404)
      assert.equal(await status(`/exercises/${exerciseId}`), 404)
      const listed = (await (await authFetch(api("/courses"))).json()) as { id: string }[]
      assert.ok(!listed.some((c) => c.id === pythonCourse.id))
    } finally {
      assert.equal(mock.setCourseAccess(pythonCourse.id, "open"), true)
    }
    assert.equal(await status(`/courses/${pythonCourse.id}`), 200)
    assert.equal(mock.setCourseAccess("no-such-course", "forbidden"), false)
  })

  // tmc-langs' update check lists each course's exercises and leaves out only the ones refused.
  test("a closed or deleted course refuses its exercise listing alone", async () => {
    const listing = async (id: string): Promise<number> =>
      (await authFetch(api(`/courses/${id}/exercises`))).status
    try {
      assert.equal(mock.setCourseAccess(pythonCourse.id, "forbidden"), true)
      assert.equal(await listing(pythonCourse.id), 403)
      assert.equal(await listing(extraCourse.id), 200)
      assert.equal(mock.setCourseAccess(pythonCourse.id, "deleted"), true)
      assert.equal(await listing(pythonCourse.id), 404)
      assert.equal(await listing(extraCourse.id), 200)
    } finally {
      mock.reset()
    }
  })

  test("a revoked grant rejects every token until a reset", async () => {
    try {
      mock.revokeGrant()
      assert.equal((await authFetch(api("/courses"))).status, 401)
    } finally {
      mock.reset()
    }
    assert.equal((await authFetch(api("/courses"))).status, 200)
  })

  test("a course's exercises name their material pages as the host lays them out", async () => {
    const res = await authFetch(api(`/courses/${pythonCourse.id}/exercises`))
    const [slide] = (await res.json()) as { page_url: string }[]
    assert.match(
      slide?.page_url ?? "",
      new RegExp(`^${base}/org/[^/]+/courses/${pythonCourse.slug}/[^/]+$`),
    )
  })

  test("GET me names the account the token acts for, which a switch changes", async () => {
    const currentUser = async (): Promise<unknown> => (await authFetch(api("/me"))).json()
    assert.deepEqual(await currentUser(), {
      id: MOCK_DEFAULT_USER_ID,
      name: MOCK_USER_NAME,
      email: MOCK_USER_EMAIL,
    })

    const otherUserId = "0d6a3a7e-1f0b-4c8e-8f3d-6b2a9c4e5f70"
    const switched = await fetch(`${base}/mooc-mock/set-current-user`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: otherUserId }),
    })
    assert.equal(switched.status, 204)
    assert.deepEqual(await currentUser(), { id: otherUserId, email: `${otherUserId}@example.com` })

    mock.reset()
    assert.equal(((await currentUser()) as { id: string }).id, MOCK_DEFAULT_USER_ID)
  })

  test("GET courses/{id} returns a single course", async () => {
    const res = await authFetch(api(`/courses/${pythonCourse.id}`))
    assert.equal(res.status, 200)
    const body = (await res.json()) as { slug: string }
    assert.equal(body.slug, pythonCourse.slug)
  })

  test("a course carries its AI policy only where one is seeded", async () => {
    const policies = await Promise.all(
      [extraCourse, pythonCourse].map(async (course) => {
        const res = await authFetch(api(`/courses/${course.id}`))
        assert.equal(res.status, 200)
        return ((await res.json()) as { ai_policy?: string }).ai_policy
      }),
    )
    assert.deepEqual(policies, ["full_use", undefined])
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
        standing: string
      }[]
    }
    assert.equal(beforeBody.course_id, pythonCourse.id)
    assert.equal(beforeBody.exercises.length, 1)
    const untouched = beforeBody.exercises[0]!
    assert.equal(untouched.exercise_id, passingExercise.slide.exercise_id)
    assert.equal(untouched.score_given, 0)
    assert.equal(untouched.completed, false)
    assert.equal(untouched.attempted, false)
    assert.equal(untouched.standing, "NotAttempted")

    await submitAndGrade(passingExercise)
    const afterRes = await authFetch(api(`/courses/${pythonCourse.id}/progress`))
    assert.equal(afterRes.status, 200)
    const afterBody = (await afterRes.json()) as { exercises: (typeof untouched)[] }
    const progressed = afterBody.exercises[0]!
    assert.equal(progressed.attempted, true)
    assert.equal(progressed.completed, true)
    assert.equal(progressed.score_given, 1)
    assert.equal(progressed.score_maximum, 1)
    assert.equal(progressed.standing, "Passed")
  })

  test("GET courses/{id}/progress reports heterogeneous per-exercise score_maximum", async () => {
    // extraCourse's exercises weigh 2 and 3, so aggregation sees heterogeneous maxima.
    const res = await authFetch(api(`/courses/${extraCourse.id}/progress`))
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      exercises: { exercise_id: string; score_maximum: number }[]
    }
    assert.equal(body.exercises.length, 2)
    const byId = new Map(body.exercises.map((e) => [e.exercise_id, e.score_maximum]))
    assert.equal(byId.get(failingExercise.slide.exercise_id), 2)
    assert.equal(byId.get(pendingManualExercise.slide.exercise_id), 3)
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
    // A real exercise in a course the user is not enrolled in is the genuine 422 not_enrolled.
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
    // The host keys the file by its own `file_uploads` row id, not the client's field name; a
    // mock that reused the name would hide a client submitting the wrong one.
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
    // A part with no filename is a plain field, not a file. The distinct message tells a
    // client its parts were malformed, not dropped.
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

  interface Grading {
    grading_progress: string
    score_given: number | null
    feedback_text: string
    feedback_json: {
      status: string
      testResults: { name: string; successful: boolean }[]
      logs: Record<string, string>
    } | null
    exercise_progress: { completed: boolean; standing: string }
  }

  const submitAndGrade = async (exercise: MoocExerciseFixture): Promise<Grading> => {
    const { taskSubmissionId } = await submit(exercise)
    // first poll is NoGradingYet, second is terminal
    await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    const graded = (await (
      await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    ).json()) as { Grading: Grading }
    return graded.Grading
  }

  test("solving an exercise reveals its model solution on GET exercises/{id} only", async () => {
    // The host attaches the model solution once full points are awarded, never in the list
    // view. The blob is opaque to the spec, so only this pins the shape the CLI deserializes.

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

  test("submit -> poll grading: a failing exercise grades fully, to zero points", async () => {
    // As on the host: failing tests are a grade, not a failed grading, and complete the
    // activity without passing the exercise.
    const grading = await submitAndGrade(failingExercise)
    assert.equal(grading.grading_progress, "FullyGraded")
    assert.equal(grading.score_given, 0)
    assert.equal(grading.exercise_progress.completed, true)
    assert.equal(grading.exercise_progress.standing, "Attempted")
  })

  test("a tmc grading's feedback_json is the test run, as the tmc service stores it", async () => {
    const failed = await submitAndGrade(failingExercise)
    assert.equal(failed.feedback_json?.status, "TESTS_FAILED")
    assert.deepEqual(
      failed.feedback_json?.testResults.map((result) => result.successful),
      [true, false],
    )
    const passed = await submitAndGrade(passingExercise)
    assert.equal(passed.feedback_json?.status, "PASSED")
  })

  test("submit -> poll grading: a pending-manual exercise grades to PendingManual", async () => {
    const grading = await submitAndGrade(pendingManualExercise)
    assert.equal(grading.grading_progress, "PendingManual")
    // PendingManual may carry a partial score
    assert.equal(grading.score_given, 0.5)
  })

  test("submit naming no answer at all is a json answer, and a tmc exercise refuses it", async () => {
    // Slide and task alone are a complete request (`answer_kind` defaults to json), but a tmc
    // exercise's answer is its archive, so there is nothing to grade.
    const res = await postJsonSubmit(passingExercise)
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /cannot grade an answer that names no files/)
  })

  test("submit of a json answer that names files is rejected", async () => {
    // The flat body allows this but the answer model does not: the files would be dropped.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id)
    const res = await postJsonSubmit(passingExercise, { data_files: [uploaded.id] })
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string; message: string }
    assert.equal(body.message_key, "validation_error")
    assert.match(body.message, /json answer cannot name uploaded files/)
  })

  test("submit of a file answer that names nothing is rejected", async () => {
    // The named files are the answer, so naming none has no content.
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
    // An upload is bound to its exercise; replaying it elsewhere looks like never uploading it.
    const foreign = await uploadOne(failingExercise.slide.exercise_id)
    const res = await postSubmit(passingExercise, [foreign.id])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "unknown_upload")
  })

  test("submit naming a reaped upload returns 422 upload_expired", async () => {
    // A soft-deleted binding distinguishes "reaped" from "never yours"; only the former is
    // recoverable by the client.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id)
    assert.ok(mock.expireUpload(uploaded.id))
    const res = await postSubmit(passingExercise, [uploaded.id])
    assert.equal(res.status, 422)
    const body = (await res.json()) as { message_key: string }
    assert.equal(body.message_key, "upload_expired")
  })

  test("submit naming the same upload twice returns 422 duplicate_upload", async () => {
    // Reported, not deduplicated: dedup would list the file twice in a download and hide the
    // client defect.
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

  // A json answer, because the host checks slide/task ownership before the answer shape.
  const postSubmitWith = (slideId: string, taskId: string): Promise<Response> =>
    postJsonSubmit(passingExercise, {}, { slideId, taskId })

  test("submit naming an unknown slide or task is a spec-documented 404", async () => {
    const unknownSlide = await postSubmitWith(randomUUID(), passingExercise.slide.tasks[0]!.task_id)
    assert.equal(unknownSlide.status, 404)
    const unknownTask = await postSubmitWith(passingExercise.slide.slide_id, randomUUID())
    assert.equal(unknownTask.status, 404)
  })

  test("submit naming another exercise's slide returns 422", async () => {
    // The URL authorizes only the exercise; the body must not redirect into another's slide.
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
    // Zero files is a legitimate CLI outcome (`nothing-to-download`), so an evicted upload
    // would silently turn a restore into a no-op.
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
    // The host echoes the part's declared type into `AnswerFile.mime` unchecked, so an untyped
    // archive is stored `application/octet-stream`; the filename extension is not consulted.
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
    // The host mints a one-hour capability for that one file and redirects to the store. The
    // mock must not hand back a plain path, or a client that persisted or rewrote the url
    // would pass here and fail in production.
    const uploaded = await uploadOne(passingExercise.slide.exercise_id, [4, 5, 6])
    const url = new URL(uploaded.url)
    // The bound address, not the default port, or a suite on an ephemeral port would hand out
    // urls pointing at another process.
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
    // The claim names its file; otherwise one answer's url would open every stored file.

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

    // the list returns slide-submission ids, newest first
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
    assert.equal(items[0]!.id, slideSubmissionId)
    assert.notEqual(slideSubmissionId, taskSubmissionId)

    // download serves the exact bytes uploaded for that submission, not the exercise stub
    const downloadRes = await authFetch(api(`/submissions/${slideSubmissionId}/download`))
    assert.equal(downloadRes.status, 200)
    const { data_files } = (await downloadRes.json()) as { data_files: AnswerFile[] }
    assert.equal(data_files.length, 1)
    assert.equal(data_files[0]!.name, "submission.tar.zst")
    const fileRes = await fetch(data_files[0]!.url)
    assert.equal(fileRes.status, 200)
    const fileBytes = new Uint8Array(await fileRes.arrayBuffer())
    assert.deepEqual([...fileBytes], [1, 2, 3])

    const shareRes = await authFetch(api(`/submissions/${slideSubmissionId}/share`), {
      method: "POST",
    })
    assert.equal(shareRes.status, 200)
    const { paste_url } = (await shareRes.json()) as { paste_url: string }
    assert.match(paste_url, /\/shared-submissions\//)

    // before grading completes the listed submission has no score/progress
    assert.equal(items[0]!.score_given, null)
    assert.equal(items[0]!.grading_progress, null)

    // once graded, the list reflects the real outcome (this fixture scores zero), not a pass
    await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    const gradedList = (await (
      await authFetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as { score_given: number | null; grading_progress: string | null }[]
    assert.equal(gradedList[0]!.grading_progress, "FullyGraded")
    assert.equal(gradedList[0]!.score_given, 0)
  })

  test("the seeding route produces a listed submission whose download is empty", async () => {
    // The integration suite's route to the no-downloadable-files outcome, which no submit produces.
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

    // Still listed, so a client restoring an old submission can reach it: an empty download
    // must be a first-class outcome, not an error.
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
    // An unknown submission id is a 404 (RecordNotFound), as on the real backend.
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
    // zstd magic number
    assert.deepEqual([...bytes.subarray(0, 4)], [0x28, 0xb5, 0x2f, 0xfd])
    const tar = zstdDecompressSync(bytes)
    // ustar magic appears in each 512-byte header block
    assert.ok(tar.includes("src/passing_exercise.py"))
    assert.ok(tar.includes("ustar"))
  })

  test("an armed archive fault fails the next download alone, no sooner than asked", async () => {
    const archiveUrl = `${base}/mooc-archives/${passingExercise.archiveSlug}.tar.zst`
    mock.failNextArchive(150)
    const started = Date.now()
    assert.equal((await fetch(archiveUrl)).status, 500)
    assert.ok(Date.now() - started >= 140)
    assert.equal((await fetch(archiveUrl)).status, 200)
  })

  test("an armed archive delay serves the next download late", async () => {
    const archiveUrl = `${base}/mooc-archives/${passingExercise.archiveSlug}.tar.zst`
    const armed = await fetch(`${base}/mooc-mock/delay-next-archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delayMs: 150 }),
    })
    assert.equal(armed.status, 204)
    const started = Date.now()
    assert.equal((await fetch(archiveUrl)).status, 200)
    assert.ok(Date.now() - started >= 140)
  })

  test("an archive fault arms from outside the process too", async () => {
    const armed = await fetch(`${base}/mooc-mock/fail-next-archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    assert.equal(armed.status, 204)
    assert.equal(
      (await fetch(`${base}/mooc-archives/${passingExercise.archiveSlug}.tar.zst`)).status,
      500,
    )
  })

  test("a published update changes the exercise's checksum until a reset", async () => {
    const checksum = async (): Promise<string> => {
      const res = await authFetch(api(`/exercises/${passingExercise.slide.exercise_id}`))
      const body = (await res.json()) as { tasks: { public_spec: { checksum: string } }[] }
      return body.tasks[0]!.public_spec.checksum
    }
    const original = await checksum()

    assert.equal(mock.publishExerciseUpdate(passingExercise.slide.exercise_id), true)
    assert.notEqual(await checksum(), original)
    assert.equal(mock.publishExerciseUpdate("no-such-exercise"), false)
    mock.reset()
    assert.equal(await checksum(), original)
  })

  test("unknown endpoint 404s", async () => {
    const res = await authFetch(api("/does-not-exist"))
    assert.equal(res.status, 404)
  })
})

describe("mooc mock response-validation guard", () => {
  test("a spec-violating handler response fails loudly with 500", async () => {
    // getClientCourses returns garbage (id: number, missing required fields); validateResponse
    // must turn it into a 500, proving the mock cannot silently drift.
    const { server, base } = await listen(
      createMoocApp({ injectResponseFault: "getClientCourses" }),
    )
    try {
      // The seeded bearer passes auth, so the fault (500), not a 401, is observed.
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
    // Suites run several mocks at once, and out-of-process tiers reach a long-lived one on a
    // fixed port. Shared state would let one test decide another's assertions, and a url naming
    // the default port would send a client to whatever else serves there.
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

// The refusals a student meets before their answer is graded, and the shapes a native client
// must cope with. Every case is reachable only because a fixture carries the state the host
// reads for it (enrollment, deadline, try limit, service slug).
// The status is read off the transcribed contract rather than passed in, so a case

// cannot assert a status the host would not answer with for that message key.
const assertRefused = async (
  res: Response,
  messageKey: ApiErrorMessageKey,
  message: string,
): Promise<void> => {
  const body = (await res.json()) as { message_key: string; message: string }
  assert.equal(res.status, API_ERRORS[messageKey].status)
  assert.equal(body.message_key, messageKey)
  assert.equal(body.message, message)
}

describe("mooc mock enrollment, answerability and ownership", () => {
  let server: Server
  let base: string
  let mock: MoocMockControls

  before(async () => {
    ;({ server, base, mock } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  beforeEach(() => {
    mock.reset()
  })

  const api = (p: string): string => `${base}/api/v0/exercise-services/client${p}`

  // Returns the response, so a caller can assert on a refusal as well as the file id.
  const postUpload = (exerciseId: string): Promise<Response> => {
    const form = new FormData()
    form.append(
      randomUUID(),
      new Blob([new Uint8Array([1, 2, 3])], { type: TMC_ARCHIVE_MIME }),
      "submission.tar.zst",
    )
    return authFetch(api(`/exercises/${exerciseId}/files`), { method: "POST", body: form })
  }

  const uploadFor = async (exerciseId: string): Promise<string> => {
    const res = await postUpload(exerciseId)
    assert.equal(res.status, 200)
    const { data_files } = (await res.json()) as { data_files: { id: string }[] }
    return data_files[0]!.id
  }

  const postSubmit = (
    exercise: MoocExerciseFixture,
    fileIds: string[],
    taskId = exercise.slide.tasks[0]!.task_id,
  ): Promise<Response> =>
    authFetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: taskId,
        answer_kind: "file",
        data_files: fileIds,
      }),
    })

  test("an upload to an exercise whose course the student left is refused", async () => {
    await assertRefused(
      await postUpload(notEnrolledExerciseId),
      "not_enrolled",
      "User is not enrolled to this exercise's course",
    )
  })

  test("an exercise a teacher deleted is gone from every listing until it is restored", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    const listed = async (): Promise<string[]> => {
      const slides = (await (
        await authFetch(api(`/courses/${pythonCourse.id}/exercises`))
      ).json()) as { exercise_id: string }[]
      const progress = (await (
        await authFetch(api(`/courses/${pythonCourse.id}/progress`))
      ).json()) as { exercises: { exercise_id: string }[] }
      return [...slides, ...progress.exercises].map((entry) => entry.exercise_id)
    }

    const removed = await fetch(`${base}/mooc-mock/set-exercise-removed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercise_id: exerciseId, removed: true }),
    })
    assert.equal(removed.status, 204)
    assert.deepEqual(await listed(), [])
    assert.equal((await authFetch(api(`/exercises/${exerciseId}`))).status, 404)
    assert.equal((await postUpload(exerciseId)).status, 404)

    mock.reset()
    assert.deepEqual(await listed(), [exerciseId, exerciseId])
  })

  test("a task belonging to a service this client cannot be served is invisible", async () => {
    const slides = (await (
      await authFetch(api(`/courses/${variantsCourse.id}/exercises`))
    ).json()) as { exercise_id: string }[]
    const listed = new Set(slides.map((slide) => slide.exercise_id))
    assert.ok(listed.has(browserExercise.slide.exercise_id))
    // Its only task is a quizzes task, so the slide drops out instead of listing no tasks.
    assert.ok(!listed.has(notClientCapableExercise.slide.exercise_id))
  })

  test("fetching an exercise with no servable task is a 404, not a 422", async () => {
    const res = await authFetch(api(`/exercises/${notClientCapableExercise.slide.exercise_id}`))
    await assertRefused(res, "not_found", "No task of this exercise can be served to this client")
  })

  test("submitting to a task this client cannot be served is refused", async () => {
    const task = notClientCapableExercise.slide.tasks[0]!
    const fileId = await uploadFor(notClientCapableExercise.slide.exercise_id)
    await assertRefused(
      await postSubmit(notClientCapableExercise, [fileId]),
      "validation_error",
      `Exercise task ${task.task_id} belongs to the exercise service '${task.exercise_service_slug}', which cannot be served to this client`,
    )
  })

  test("a browser exercise carries a browser spec and no downloadable task", async () => {
    const slide = (await (
      await authFetch(api(`/exercises/${browserExercise.slide.exercise_id}`))
    ).json()) as { tasks: { public_spec: { type: string; browser_test?: unknown } }[] }
    assert.equal(slide.tasks.length, 1)
    assert.equal(slide.tasks[0]!.public_spec.type, "browser")
    assert.deepEqual(slide.tasks[0]!.public_spec.browser_test, {
      runtime: "python",
      script: "print('hello')",
    })
  })

  test("a slide can carry more than one task, only one of them submittable", async () => {
    const slide = (await (
      await authFetch(api(`/exercises/${mixedTaskExercise.slide.exercise_id}`))
    ).json()) as { tasks: { order_number: number; public_spec: { type: string } }[] }
    assert.deepEqual(
      slide.tasks.map((task) => [task.order_number, task.public_spec.type]),
      [
        [0, "browser"],
        [1, "editor"],
      ],
    )
  })

  test("an upload to an exercise past its deadline is refused", async () => {
    await assertRefused(
      await postUpload(pastDeadlineExercise.slide.exercise_id),
      "deadline_passed",
      "Exercise deadline passed.",
    )
  })

  test("a deadline that has not passed refuses nothing", async () => {
    const fileId = await uploadFor(futureDeadlineExercise.slide.exercise_id)
    const res = await postSubmit(futureDeadlineExercise, [fileId])
    assert.equal(res.status, 200)
  })

  test("the deadline is checked after the answer itself, as the host checks it", async () => {
    // The host enforces the deadline inside grading, so a submit that never gets that far is
    // refused for its own reason; checking the deadline first would report a different rule.
    const res = await authFetch(
      api(`/exercises/${pastDeadlineExercise.slide.exercise_id}/submit`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exercise_slide_id: pastDeadlineExercise.slide.slide_id,
          exercise_task_id: pastDeadlineExercise.slide.tasks[0]!.task_id,
        }),
      },
    )
    await assertRefused(
      res,
      "validation_error",
      "The tmc exercise service cannot grade an answer that names no files.",
    )
  })

  test("a submit past the slide's try limit is refused", async () => {
    // Both uploads happen while a try remains: the upload route is gated on the same limit.
    const first = await uploadFor(limitedTriesExercise.slide.exercise_id)
    const second = await uploadFor(limitedTriesExercise.slide.exercise_id)
    assert.equal((await postSubmit(limitedTriesExercise, [first])).status, 200)
    await assertRefused(
      await postSubmit(limitedTriesExercise, [second]),
      "out_of_tries",
      "You've ran out of tries.",
    )
  })

  test("using up the tries reveals the model solution however the try scored", async () => {
    // The host's reveal rule counts submissions as well as points; this fixture grades as
    // failing, so a mock modelling only full points would withhold the solution.
    const fileId = await uploadFor(limitedTriesExercise.slide.exercise_id)
    assert.equal((await postSubmit(limitedTriesExercise, [fileId])).status, 200)
    const slide = (await (
      await authFetch(api(`/exercises/${limitedTriesExercise.slide.exercise_id}`))
    ).json()) as { tasks: { model_solution_spec: unknown }[] }
    assert.deepEqual(slide.tasks[0]!.model_solution_spec, {
      type: "editor",
      solution_download_url: `${base}/mooc-archives/${limitedTriesExercise.archiveSlug}.tar.zst`,
    })
  })

  test("the last try below full points leaves the exercise out of tries", async () => {
    const exerciseId = limitedTriesExercise.slide.exercise_id
    const standingInCourse = async (): Promise<string | undefined> => {
      const progress = (await (
        await authFetch(api(`/courses/${variantsCourse.id}/progress`))
      ).json()) as { exercises: { exercise_id: string; standing: string }[] }
      return progress.exercises.find((e) => e.exercise_id === exerciseId)?.standing
    }
    assert.equal(await standingInCourse(), "NotAttempted")

    const res = await postSubmit(limitedTriesExercise, [await uploadFor(exerciseId)])
    assert.equal(res.status, 200)
    const { task_submission_id } = (await res.json()) as { task_submission_id: string }
    await authFetch(api(`/submissions/${task_submission_id}/grading`))
    const graded = (await (
      await authFetch(api(`/submissions/${task_submission_id}/grading`))
    ).json()) as { Grading: { score_given: number; exercise_progress: { standing: string } } }
    assert.equal(graded.Grading.score_given, 0)
    assert.equal(graded.Grading.exercise_progress.standing, "OutOfTries")
    assert.equal(await standingInCourse(), "OutOfTries")
  })

  test("an upload is refused once no slide of the exercise has a try left", async () => {
    const fileId = await uploadFor(limitedTriesExercise.slide.exercise_id)
    assert.equal((await postSubmit(limitedTriesExercise, [fileId])).status, 200)
    await assertRefused(
      await postUpload(limitedTriesExercise.slide.exercise_id),
      "out_of_tries",
      "You've ran out of tries.",
    )
  })

  test("progress counts the tries left on a limited exercise and none on an unlimited one", async () => {
    const progressOf = async (exerciseId: string) => {
      const progress = (await (
        await authFetch(api(`/courses/${variantsCourse.id}/progress`))
      ).json()) as {
        exercises: { exercise_id: string; max_tries: number | null; tries_left: number | null }[]
      }
      return progress.exercises.find((e) => e.exercise_id === exerciseId)
    }
    const exerciseId = limitedTriesExercise.slide.exercise_id
    assert.deepEqual(
      {
        max: (await progressOf(exerciseId))?.max_tries,
        left: (await progressOf(exerciseId))?.tries_left,
      },
      { max: 1, left: 1 },
    )
    assert.equal(
      (await postSubmit(limitedTriesExercise, [await uploadFor(exerciseId)])).status,
      200,
    )
    assert.equal((await progressOf(exerciseId))?.tries_left, 0)
    const unlimited = await progressOf(futureDeadlineExercise.slide.exercise_id)
    assert.equal(unlimited?.max_tries, null)
    assert.equal(unlimited?.tries_left, null)
  })

  const chapter = {
    id: "c0c0c0c0-0000-4000-8000-000000000001",
    name: "Loops",
    chapter_number: 2,
    deadline: null,
    opens_at: null,
    locking_status: null,
  } as const

  test("an exercise without a deadline of its own is served its chapter's", async () => {
    const exerciseId = futureDeadlineExercise.slide.exercise_id
    const own = futureDeadlineExercise.slide.deadline
    mock.setExerciseChapter(exerciseId, { ...chapter, deadline: "2000-01-01T00:00:00.000Z" })
    const slide = (await (await authFetch(api(`/exercises/${exerciseId}`))).json()) as {
      deadline: string | null
      chapter: { name: string; locking_status: string | null }
    }
    assert.equal(slide.deadline, own)
    assert.deepEqual(slide.chapter, {
      id: chapter.id,
      name: "Loops",
      chapter_number: 2,
      locking_status: null,
    })

    const passingId = passingExercise.slide.exercise_id
    mock.setExerciseChapter(passingId, { ...chapter, deadline: "2000-01-01T00:00:00.000Z" })
    const inherited = (await (await authFetch(api(`/exercises/${passingId}`))).json()) as {
      deadline: string | null
    }
    assert.equal(inherited.deadline, "2000-01-01T00:00:00.000Z")
    await assertRefused(await postUpload(passingId), "deadline_passed", "Exercise deadline passed.")
  })

  test("a chapter that opens later hides its exercises without removing them", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    mock.setExerciseChapter(exerciseId, { ...chapter, opens_at: "2100-01-01T00:00:00.000Z" })
    const slides = (await (
      await authFetch(api(`/courses/${pythonCourse.id}/exercises`))
    ).json()) as { exercise_id: string }[]
    assert.equal(slides.length, 0)
    const progress = (await (
      await authFetch(api(`/courses/${pythonCourse.id}/progress`))
    ).json()) as {
      exercises: unknown[]
      closed_chapters: { id: string; opens_at: string; exercises: { exercise_id: string }[] }[]
    }
    assert.deepEqual(progress.exercises, [])
    assert.equal(progress.closed_chapters.length, 1)
    assert.equal(progress.closed_chapters[0]!.opens_at, "2100-01-01T00:00:00.000Z")
    assert.deepEqual(
      progress.closed_chapters[0]!.exercises.map((e) => e.exercise_id),
      [exerciseId],
    )
    const message = "This exercise's chapter is not open yet."
    await assertRefused(
      await authFetch(api(`/exercises/${exerciseId}`)),
      "chapter_not_open_yet",
      message,
    )
    await assertRefused(await postUpload(exerciseId), "chapter_not_open_yet", message)
  })

  test("chapter locking refuses answers, each lock with its own key", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    mock.setExerciseChapter(exerciseId, { ...chapter, locking_status: "not_unlocked_yet" })
    await assertRefused(
      await postUpload(exerciseId),
      "chapter_not_unlocked_yet",
      "Complete and lock the previous chapter to unlock exercises in this chapter.",
    )
    mock.setExerciseChapter(exerciseId, { ...chapter, locking_status: "completed_and_locked" })
    await assertRefused(
      await postUpload(exerciseId),
      "chapter_completed_and_locked",
      "The current chapter is locked, and you can no longer submit exercises.",
    )
    const slide = (await (await authFetch(api(`/exercises/${exerciseId}`))).json()) as {
      chapter: { locking_status: string }
    }
    assert.equal(slide.chapter.locking_status, "completed_and_locked")
  })

  test("a pending teacher review holds the points back, and a locked exercise refuses answers", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    const res = await postSubmit(passingExercise, [await uploadFor(exerciseId)])
    const { task_submission_id: taskSubmissionId } = (await res.json()) as {
      task_submission_id: string
    }
    for (let poll = 0; poll < 2; poll++) {
      await authFetch(api(`/submissions/${taskSubmissionId}/grading`))
    }
    const progressOf = async () => {
      const progress = (await (
        await authFetch(api(`/courses/${pythonCourse.id}/progress`))
      ).json()) as {
        exercises: {
          exercise_id: string
          score_given: number
          standing: string
          pending_teacher_review: string | null
          exercise_locked: boolean
        }[]
      }
      const { score_given, standing, pending_teacher_review, exercise_locked } =
        progress.exercises.find((e) => e.exercise_id === exerciseId)!
      return { score_given, standing, pending_teacher_review, exercise_locked }
    }
    assert.deepEqual(await progressOf(), {
      score_given: 1,
      standing: "Passed",
      pending_teacher_review: null,
      exercise_locked: false,
    })

    mock.setExerciseReview(exerciseId, "awaits_chapter_lock")
    assert.deepEqual(await progressOf(), {
      score_given: 0,
      standing: "Attempted",
      pending_teacher_review: "awaits_chapter_lock",
      exercise_locked: false,
    })
    assert.equal((await postUpload(exerciseId)).status, 200)

    mock.setExerciseReview(exerciseId, "awaits_teacher")
    assert.deepEqual(await progressOf(), {
      score_given: 0,
      standing: "Attempted",
      pending_teacher_review: "awaits_teacher",
      exercise_locked: true,
    })
    await assertRefused(
      await postUpload(exerciseId),
      "exercise_locked",
      "This exercise is locked, and you can no longer submit it.",
    )

    mock.setExerciseReview(exerciseId, "locked")
    assert.equal((await progressOf()).pending_teacher_review, null)
    await assertRefused(
      await postSubmit(passingExercise, []),
      "exercise_locked",
      "This exercise is locked, and you can no longer submit it.",
    )
  })

  test("another student's submission is refused on grading, download and share", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    const seeded = mock.seedForeignSubmission(exerciseId)
    assert.ok(seeded)
    await assertRefused(
      await authFetch(api(`/submissions/${seeded.taskSubmissionId}/grading`)),
      "no_access",
      "Cannot view another user's submission grading",
    )
    await assertRefused(
      await authFetch(api(`/submissions/${seeded.slideSubmissionId}/download`)),
      "no_access",
      "Cannot download another user's submission",
    )
    await assertRefused(
      await authFetch(api(`/submissions/${seeded.slideSubmissionId}/share`), { method: "POST" }),
      "no_access",
      "Cannot share another user's submission",
    )
  })

  test("another student's submission is in no listing of this student's work", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    assert.ok(mock.seedForeignSubmission(exerciseId))
    const listed = (await (
      await authFetch(api(`/exercises/${exerciseId}/submissions`))
    ).json()) as unknown[]
    assert.equal(listed.length, 0)
    const progress = (await (
      await authFetch(api(`/courses/${pythonCourse.id}/progress`))
    ).json()) as { exercises: { attempted: boolean }[] }
    assert.equal(progress.exercises[0]!.attempted, false)
  })

  test("a foreign submission seeds and refuses the same way from outside the process", async () => {
    const seed = await fetch(`${base}/mooc-mock/seed-foreign-submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercise_id: passingExercise.slide.exercise_id }),
    })
    assert.equal(seed.status, 200)
    const { slide_submission_id } = (await seed.json()) as { slide_submission_id: string }
    const res = await authFetch(api(`/submissions/${slide_submission_id}/download`))
    assert.equal(res.status, 403)
  })

  test("seeding a foreign submission for an unknown exercise is a 404", async () => {
    const res = await fetch(`${base}/mooc-mock/seed-foreign-submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercise_id: nonexistentExerciseId }),
    })
    assert.equal(res.status, 404)
    assert.equal(mock.seedForeignSubmission(nonexistentExerciseId), undefined)
  })
})

describe("mooc mock answer snapshots", () => {
  let server: Server
  let base: string
  let mock: MoocMockControls

  before(async () => {
    ;({ server, base, mock } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  beforeEach(() => {
    mock.reset()
  })

  const api = (p: string): string => `${base}/api/v0/exercise-services/client${p}`

  interface ListItem {
    id: string
    kind: string
    is_shared: boolean
    score_given: number | null
    grading_progress: string | null
  }

  const upload = async (exerciseId: string, query = "", bytes = [1, 2, 3]): Promise<Response> => {
    const form = new FormData()
    form.append(
      randomUUID(),
      new Blob([new Uint8Array(bytes)], { type: TMC_ARCHIVE_MIME }),
      "submission.tar.zst",
    )
    return authFetch(api(`/exercises/${exerciseId}/files${query}`), { method: "POST", body: form })
  }

  const postSnapshot = async (
    exercise: MoocExerciseFixture,
    purpose: "paste" | "backup",
    bytes = [1, 2, 3],
  ): Promise<Response> => {
    const uploaded = await upload(exercise.slide.exercise_id, "?for=snapshot", bytes)
    assert.equal(uploaded.status, 200)
    const { data_files } = (await uploaded.json()) as { data_files: { id: string }[] }
    return authFetch(api(`/exercises/${exercise.slide.exercise_id}/snapshots`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose,
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: exercise.slide.tasks[0]!.task_id,
        data_files: data_files.map((file) => file.id),
      }),
    })
  }

  const snapshot = async (
    exercise: MoocExerciseFixture,
    purpose: "paste" | "backup",
    bytes?: number[],
  ): Promise<string> => {
    const res = await postSnapshot(exercise, purpose, bytes)
    assert.equal(res.status, 200)
    return ((await res.json()) as { snapshot_id: string }).snapshot_id
  }

  const list = async (exercise: MoocExerciseFixture): Promise<ListItem[]> =>
    (await (
      await authFetch(api(`/exercises/${exercise.slide.exercise_id}/submissions`))
    ).json()) as ListItem[]

  const share = (id: string): Promise<Response> =>
    authFetch(api(`/submissions/${id}/share`), { method: "POST" })

  test("a snapshot is listed ungraded beside the submissions, newest first", async () => {
    const paste = await snapshot(passingExercise, "paste")
    const backup = await snapshot(passingExercise, "backup")

    assert.deepEqual(
      (await list(passingExercise)).map((item) => [
        item.id,
        item.kind,
        item.is_shared,
        item.score_given,
        item.grading_progress,
      ]),
      [
        [backup, "backup", false, null, null],
        [paste, "paste", false, null, null],
      ],
    )
  })

  test("a snapshot uses no try and is stored past the deadline and out of tries", async () => {
    await snapshot(pastDeadlineExercise, "paste")
    const fileId = (
      (await (await upload(limitedTriesExercise.slide.exercise_id)).json()) as {
        data_files: { id: string }[]
      }
    ).data_files[0]!.id
    const submitted = await authFetch(
      api(`/exercises/${limitedTriesExercise.slide.exercise_id}/submit`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exercise_slide_id: limitedTriesExercise.slide.slide_id,
          exercise_task_id: limitedTriesExercise.slide.tasks[0]!.task_id,
          answer_kind: "file",
          data_files: [fileId],
        }),
      },
    )
    assert.equal(submitted.status, 200)

    await snapshot(limitedTriesExercise, "backup")

    // A plain upload is still refused, which only a snapshot's may skip.
    assert.equal((await upload(limitedTriesExercise.slide.exercise_id)).status, 422)
    const progress = (await (
      await authFetch(api(`/courses/${variantsCourse.id}/progress`))
    ).json()) as { exercises: { exercise_id: string; attempted: boolean }[] }
    assert.equal(
      progress.exercises.find((e) => e.exercise_id === pastDeadlineExercise.slide.exercise_id)
        ?.attempted,
      false,
    )
  })

  test("a snapshot downloads its own files", async () => {
    const id = await snapshot(failingExercise, "backup", [7, 8, 9])
    const { data_files } = (await (await authFetch(api(`/submissions/${id}/download`))).json()) as {
      data_files: { url: string }[]
    }
    const bytes = new Uint8Array(await (await fetch(data_files[0]!.url)).arrayBuffer())
    assert.deepEqual([...bytes], [7, 8, 9])
  })

  test("a paste is shared and then listed as shared; a backup cannot be shared", async () => {
    const paste = await snapshot(passingExercise, "paste")
    const backup = await snapshot(passingExercise, "backup")

    assert.equal((await share(paste)).status, 200)
    await assertRefused(
      await share(backup),
      "backup_not_shareable",
      "Only a paste can be shared, not a backup.",
    )
    const items = await list(passingExercise)
    assert.equal(items.find((item) => item.id === paste)?.is_shared, true)
    assert.equal(items.find((item) => item.id === backup)?.is_shared, false)
  })

  test("pastes past the per-minute limit are refused with a Retry-After; backups are not", async () => {
    for (let i = 0; i < 3; i++) {
      await snapshot(passingExercise, "paste")
    }
    const refused = await postSnapshot(passingExercise, "paste")
    assert.ok(Number(refused.headers.get("retry-after")) > 0)
    await assertRefused(
      refused,
      "rate_limited",
      "Too many pastes of this exercise; try again later.",
    )
    // Per exercise, and only for pastes.
    await snapshot(failingExercise, "paste")
    await snapshot(passingExercise, "backup")
  })

  test("storing a backup past the cap drops the oldest one", async () => {
    const first = await snapshot(failingExercise, "backup")
    for (let i = 0; i < 20; i++) {
      await snapshot(failingExercise, "backup")
    }
    const items = await list(failingExercise)
    assert.equal(items.length, 20)
    assert.ok(items.every((item) => item.id !== first))
    assert.equal((await authFetch(api(`/submissions/${first}/download`))).status, 404)
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

// The vendored spec's ApiErrorResponse constrains no member, so response validation proves
// only that the status is documented. This walk pins the envelope of every error the client
// API can answer with, against the contract transcribed from the host in ./apiErrors.
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
      messageKey: "insufficient_scope",
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
      name: "an upload past the deadline",
      messageKey: "deadline_passed",
      run: async () =>
        read(
          await authFetch(api(`/exercises/${pastDeadlineExercise.slide.exercise_id}/files`), {
            method: "POST",
            body: new FormData(),
          }),
        ),
    },
    {
      name: "a submit with no tries left",
      messageKey: "out_of_tries",
      run: async () => {
        mock.reset()
        const exercise = limitedTriesExercise
        const [first, second] = [
          await uploadFor(exercise.slide.exercise_id),
          await uploadFor(exercise.slide.exercise_id),
        ]
        const submit = (fileId: string): Promise<Response> =>
          authFetch(api(`/exercises/${exercise.slide.exercise_id}/submit`), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              exercise_slide_id: exercise.slide.slide_id,
              exercise_task_id: exercise.slide.tasks[0]!.task_id,
              answer_kind: "file",
              data_files: [fileId],
            }),
          })
        await submit(first)
        return read(await submit(second))
      },
    },
    ...(
      [
        ["chapter_not_open_yet", { opens_at: "2100-01-01T00:00:00.000Z" }],
        ["chapter_not_unlocked_yet", { locking_status: "not_unlocked_yet" }],
        ["chapter_completed_and_locked", { locking_status: "completed_and_locked" }],
      ] as const
    ).map(([messageKey, setting]) => ({
      name: `an upload to an exercise whose chapter refuses it (${messageKey})`,
      messageKey,
      run: async (): Promise<ErrorResponse> => {
        const exerciseId = futureDeadlineExercise.slide.exercise_id
        mock.setExerciseChapter(exerciseId, {
          id: "c0c0c0c0-0000-4000-8000-000000000002",
          name: "Locked",
          chapter_number: 3,
          deadline: null,
          opens_at: null,
          locking_status: null,
          ...setting,
        })
        try {
          return await read(
            await authFetch(api(`/exercises/${exerciseId}/files`), {
              method: "POST",
              body: new FormData(),
            }),
          )
        } finally {
          mock.setExerciseChapter(exerciseId, undefined)
        }
      },
    })),
    {
      name: "an upload to an exercise locked for review",
      messageKey: "exercise_locked",
      run: async (): Promise<ErrorResponse> => {
        const exerciseId = futureDeadlineExercise.slide.exercise_id
        mock.setExerciseReview(exerciseId, "awaits_teacher")
        try {
          return await read(
            await authFetch(api(`/exercises/${exerciseId}/files`), {
              method: "POST",
              body: new FormData(),
            }),
          )
        } finally {
          mock.setExerciseReview(exerciseId, undefined)
        }
      },
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
      name: "a paste past the per-minute limit",
      messageKey: "rate_limited",
      run: async () => {
        const exercise = futureDeadlineExercise
        const pasteOnce = async (): Promise<Response> =>
          authFetch(api(`/exercises/${exercise.slide.exercise_id}/snapshots`), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              purpose: "paste",
              exercise_slide_id: exercise.slide.slide_id,
              exercise_task_id: exercise.slide.tasks[0]!.task_id,
              data_files: [await uploadFor(exercise.slide.exercise_id)],
            }),
          })
        for (let i = 0; i < 3; i++) {
          await pasteOnce()
        }
        return read(await pasteOnce())
      },
    },
    {
      name: "sharing a backup",
      messageKey: "backup_not_shareable",
      run: async () => {
        const exercise = futureDeadlineExercise
        const stored = await authFetch(api(`/exercises/${exercise.slide.exercise_id}/snapshots`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            purpose: "backup",
            exercise_slide_id: exercise.slide.slide_id,
            exercise_task_id: exercise.slide.tasks[0]!.task_id,
            data_files: [await uploadFor(exercise.slide.exercise_id)],
          }),
        })
        const { snapshot_id } = (await stored.json()) as { snapshot_id: string }
        return read(await authFetch(api(`/submissions/${snapshot_id}/share`), { method: "POST" }))
      },
    },
    {
      name: "grading of an unknown submission",
      messageKey: "not_found",
      run: async () => read(await authFetch(api(`/submissions/${nonexistentExerciseId}/grading`))),
    },
    {
      name: "sharing another student's submission",
      messageKey: "no_access",
      run: async () => {
        const seeded = mock.seedForeignSubmission(passingExercise.slide.exercise_id)
        assert.ok(seeded)
        return read(
          await authFetch(api(`/submissions/${seeded.slideSubmissionId}/share`), {
            method: "POST",
          }),
        )
      },
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
      // Dormant unless a mock names a minimum (the host's MINIMUM_CLIENT_VERSION is unset).
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
      // The host's serializer omits both when empty, as every error here is.
      assert.equal("errors" in body, false)
      assert.equal("metadata" in body, false)
    })
  }

  test("every error key the router can answer with is walked above", () => {
    // Read from the source, so an error key added to a handler fails here until a probe covers it.
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

// The host turns away a client older than MINIMUM_CLIENT_VERSION (`X-Client-Version`) with 426
// on every operation. That constant is None in production, so only a mock naming a minimum can
// exercise the rule. A 426 reaching the client proves the validator accepts it as documented;
// its envelope is pinned in the error-envelope walk.
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
    // The check runs before the handler, as the host's extractor does, or a turned-away submit
    // still leaves a submission behind.
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

// Injected one-shot failures. Every fixture error is a 4xx a client provoked; nothing else
// answers 5xx, so the client's retry and error-reporting paths could not be driven, least of
// all from the out-of-process tiers the control route exists for.

describe("mooc mock injected failures", () => {
  let server: Server
  let base: string
  let mock: MoocMockControls

  before(async () => {
    ;({ server, base, mock } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  const failNext = (body: unknown): Promise<Response> =>
    fetch(`${base}/mooc-mock/fail-next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  test("an armed fault answers once, with the host envelope for its status", async () => {
    assert.equal(mock.failNext("getClientCourses", 500), undefined)
    const faulted = await authFetch(clientApi(base, "/courses"))
    assert.equal(faulted.status, 500)
    const body = (await faulted.json()) as { type: string; message_key: string }
    assert.equal(body.type, API_ERRORS.internal_error.type)
    assert.equal(body.message_key, "internal_error")

    // one-shot: the next call is served normally
    assert.equal((await authFetch(clientApi(base, "/courses"))).status, 200)
  })

  test("an armed fault leaves other operations alone", async () => {
    assert.equal(mock.failNext("getClientCourses", 500), undefined)
    assert.equal((await authFetch(clientApi(base, `/courses/${pythonCourse.id}`))).status, 200)
    assert.equal((await authFetch(clientApi(base, "/courses"))).status, 500)
  })

  test("a fault arms and fires the same way from outside the process", async () => {
    assert.equal((await failNext({ operationId: "getClientCourses", status: 404 })).status, 204)
    const faulted = await authFetch(clientApi(base, "/courses"))
    assert.equal(faulted.status, 404)
    assert.equal(((await faulted.json()) as { message_key: string }).message_key, "not_found")
  })

  test("a reset disarms an armed fault", async () => {
    mock.failNext("getClientCourses", 500)
    mock.reset()
    assert.equal((await authFetch(clientApi(base, "/courses"))).status, 200)
  })

  test("an unknown operation or an uninjectable status is refused", async () => {
    assert.equal(mock.failNext("getSomethingElse", 500), "unknown-operation")
    assert.equal(mock.failNext("getClientCourses", 418), "unsupported-status")
    assert.equal((await failNext({ operationId: "getSomethingElse", status: 500 })).status, 404)
    assert.equal((await failNext({ operationId: "getClientCourses", status: 418 })).status, 400)
    assert.equal((await failNext({ status: 500 })).status, 400)
    assert.equal((await authFetch(clientApi(base, "/courses"))).status, 200)
  })
})

describe("mooc mock exams, course facts and review progress", () => {
  let server: Server
  let base: string
  let mock: MoocMockControls

  before(async () => {
    ;({ server, base, mock } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  beforeEach(() => {
    mock.reset()
  })

  const api = (p: string): string => `${base}/api/v0/exercise-services/client${p}`
  const getJson = async <T>(p: string): Promise<T> => (await authFetch(api(p))).json() as Promise<T>
  const post = (route: string, body: unknown): Promise<Response> =>
    fetch(`${base}/mooc-mock/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  const submitTo = async (exercise: MoocExerciseFixture): Promise<Response> => {
    const exerciseId = exercise.slide.exercise_id
    const form = new FormData()
    const fileId = randomUUID()
    form.append(fileId, new Blob(["print('hi')"], { type: TMC_ARCHIVE_MIME }), "answer.tar.zst")
    const uploaded = await authFetch(api(`/exercises/${exerciseId}/files`), {
      method: "POST",
      body: form,
    })
    if (uploaded.status !== 200) {
      return uploaded
    }
    const { data_files } = (await uploaded.json()) as { data_files: { id: string }[] }
    return authFetch(api(`/exercises/${exerciseId}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exercise_slide_id: exercise.slide.slide_id,
        exercise_task_id: exercise.slide.tasks[0]!.task_id,
        answer_kind: "file",
        data_files: data_files.map((file) => file.id),
      }),
    })
  }

  test("GET exams lists the started exam, and GET exams/{id}/exercises its exercise", async () => {
    const exams = await getJson<{ id: string; name: string; answerable_until: string }[]>("/exams")
    assert.deepEqual(
      exams.map((exam) => exam.id),
      [EXAM_ID],
    )
    const slides = await getJson<
      { exercise_id: string; exam_id: string; course_id: string; deadline: string }[]
    >(`/exams/${EXAM_ID}/exercises`)
    assert.equal(slides.length, 1)
    assert.equal(slides[0]!.exercise_id, examExercise.slide.exercise_id)
    assert.equal(slides[0]!.exam_id, EXAM_ID)
    assert.equal(slides[0]!.course_id, "00000000-0000-0000-0000-000000000000")
    assert.equal(slides[0]!.deadline, exams[0]!.answerable_until)
    assert.equal((await authFetch(api(`/exams/${nonexistentExerciseId}/exercises`))).status, 404)
  })

  test("an exam submission's grading stays hidden while the exam is answerable", async () => {
    const submitted = await submitTo(examExercise)
    assert.equal(submitted.status, 200)
    const { task_submission_id } = (await submitted.json()) as { task_submission_id: string }
    for (let poll = 0; poll < 3; poll++) {
      assert.equal(await getJson(`/submissions/${task_submission_id}/grading`), "GradingHidden")
    }
    const [listed] = await getJson<{ score_given: unknown; grading_progress: unknown }[]>(
      `/exercises/${examExercise.slide.exercise_id}/submissions`,
    )
    assert.deepEqual([listed!.score_given, listed!.grading_progress], [null, null])

    mock.setExamEnded(EXAM_ID, true)
    assert.deepEqual(await getJson("/exams"), [])
    assert.equal((await authFetch(api(`/exams/${EXAM_ID}/exercises`))).status, 404)
    assert.equal((await submitTo(examExercise)).status, 404)
    const grading = await getJson<{ Grading: Record<string, unknown> }>(
      `/submissions/${task_submission_id}/grading`,
    )
    assert.equal(grading.Grading.grading_progress, "FullyGraded")
    assert.equal("exercise_progress" in grading.Grading, false)
  })

  test("an exam exercise takes no snapshot and shows no model solution", async () => {
    const exerciseId = examExercise.slide.exercise_id
    const snapshot = await authFetch(api(`/exercises/${exerciseId}/snapshots`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "backup",
        exercise_slide_id: examExercise.slide.slide_id,
        exercise_task_id: examExercise.slide.tasks[0]!.task_id,
        data_files: [randomUUID()],
      }),
    })
    assert.equal(snapshot.status, 404)
    const slide = await getJson<{ tasks: { model_solution_spec: unknown }[] }>(
      `/exercises/${exerciseId}`,
    )
    assert.equal(slide.tasks[0]!.model_solution_spec, null)
  })

  test("a course lists its url, language, enrollment and staff facts", async () => {
    const [course] = (await getJson<Record<string, unknown>[]>("/courses")).filter(
      (c) => c.id === pythonCourse.id,
    )
    assert.equal(course!.url, `${base}/org/test-organization/courses/${pythonCourse.slug}`)
    assert.equal(course!.language_code, "en-US")
    assert.equal(typeof course!.language_group_id, "string")
    assert.equal(course!.is_enrolled, true)
    assert.equal(course!.is_staff, false)
    assert.equal("moved_to_course_id" in course!, false)

    assert.equal(
      mock.setCourseFields(pythonCourse.id, {
        closed_at: "2030-01-01T00:00:00.000Z",
        successor_course_id: extraCourse.id,
        moved_to_course_id: variantsCourse.id,
        is_staff: true,
      }),
      true,
    )
    mock.setEnrolled(pythonCourse.id, false)
    const changed = await getJson<Record<string, unknown>>(`/courses/${pythonCourse.id}`)
    assert.equal(changed.closed_at, "2030-01-01T00:00:00.000Z")
    assert.equal(changed.successor_course_id, extraCourse.id)
    assert.equal(changed.moved_to_course_id, variantsCourse.id)
    assert.equal(changed.is_enrolled, false)
    assert.equal(changed.is_staff, true)
    const listed = await getJson<{ id: string }[]>("/courses")
    assert.ok(
      listed.some((c) => c.id === pythonCourse.id),
      "a staff course is listed unenrolled",
    )
    assert.equal(mock.setCourseFields("no-such-course", {}), false)
  })

  test("staff and a course whose settings reveal solutions see the model solution unsolved", async () => {
    const exerciseId = failingExercise.slide.exercise_id
    const solutionOf = async (): Promise<unknown> =>
      (await getJson<{ tasks: { model_solution_spec: unknown }[] }>(`/exercises/${exerciseId}`))
        .tasks[0]!.model_solution_spec
    assert.equal(await solutionOf(), null)
    mock.setModelSolutionRevealed(extraCourse.id, true)
    assert.notEqual(await solutionOf(), null)
    mock.setModelSolutionRevealed(extraCourse.id, false)
    assert.equal(await solutionOf(), null)
    mock.setCourseFields(extraCourse.id, { is_staff: true })
    assert.notEqual(await solutionOf(), null)
  })

  test("the review process shows in a graded exercise's progress", async () => {
    const exerciseId = passingExercise.slide.exercise_id
    const teacherReview = {
      decision: "custom_points",
      score_given: 0.5,
      created_at: "2030-01-01T00:00:00.000Z",
      justification: "Partly right",
    }
    assert.equal(
      mock.setExerciseReviewProgress(exerciseId, {
        reviewing_stage: "waiting_for_teacher",
        teacher_review: teacherReview,
      }),
      true,
    )
    const { exercises } = await getJson<{ exercises: Record<string, unknown>[] }>(
      `/courses/${pythonCourse.id}/progress`,
    )
    assert.equal(exercises[0]!.reviewing_stage, "waiting_for_teacher")
    assert.deepEqual(exercises[0]!.teacher_review, teacherReview)
    mock.setExerciseReviewProgress(exerciseId, undefined)
    const cleared = await getJson<{ exercises: Record<string, unknown>[] }>(
      `/courses/${pythonCourse.id}/progress`,
    )
    assert.equal("reviewing_stage" in cleared.exercises[0]!, false)
    assert.equal(mock.setExerciseReviewProgress(nonexistentExerciseId, undefined), false)
  })

  test("the names course serves colliding and path-like exercise names once enrolled", async () => {
    assert.equal(
      (await getJson<{ id: string }[]>("/courses")).some((c) => c.id === namesCourse.id),
      false,
    )
    mock.setEnrolled(namesCourse.id, true)
    const slides = await getJson<{ exercise_name: string }[]>(
      `/courses/${namesCourse.id}/exercises`,
    )
    const names = slides.map((slide) => slide.exercise_name)
    assert.deepEqual(
      names.slice(0, 2),
      collidingNameExercises.map((e) => e.slide.exercise_name),
    )
    assert.equal(names[2], pathLikeNameExercise.slide.exercise_name)
    const normalized = names.slice(0, 2).map((name) => name.toLowerCase().replaceAll(/\s+/g, " "))
    assert.equal(normalized[0], normalized[1])
  })

  test("auth-state reports the client version the last request advertised", async () => {
    await authFetch(api("/courses"), { headers: { "x-client-version": "4.0.0-test" } })
    const state = (await (await fetch(`${base}/mooc-mock/auth-state`)).json()) as {
      lastClientVersion?: string
    }
    assert.equal(state.lastClientVersion, "4.0.0-test")
    await authFetch(api("/courses"))
    const unversioned = (await (await fetch(`${base}/mooc-mock/auth-state`)).json()) as {
      lastClientVersion?: string
    }
    assert.equal(unversioned.lastClientVersion, undefined)
  })

  test("an exercise grades with the outcome a test sets, until it is cleared", async () => {
    const exercise = passingExercise
    const graded = async (): Promise<Record<string, unknown>> => {
      const submitted = (await (await submitTo(exercise)).json()) as { task_submission_id: string }
      await getJson(`/submissions/${submitted.task_submission_id}/grading`)
      return (
        await getJson<{ Grading: Record<string, unknown> }>(
          `/submissions/${submitted.task_submission_id}/grading`,
        )
      ).Grading
    }
    const expectations = {
      compileFailed: ["FullyGraded", "COMPILE_FAILED", "compile_failed"],
      genericError: ["Failed", "GENERIC_ERROR", "generic_error"],
      timedOut: ["Failed", undefined, "timed_out"],
      pending: ["Pending", undefined, undefined],
    } as const
    for (const [outcome, [progress, status, key]] of Object.entries(expectations)) {
      assert.equal(
        mock.setGradingOutcome(exercise.slide.exercise_id, outcome as keyof typeof expectations),
        true,
      )
      const grading = await graded()
      const feedback = grading.feedback_json as Record<string, unknown> | null
      assert.equal(grading.grading_progress, progress, outcome)
      assert.equal(feedback?.status, status, outcome)
      assert.equal(feedback?.feedback_key, key, outcome)
    }
    mock.setGradingOutcome(exercise.slide.exercise_id, undefined)
    assert.equal((await graded()).grading_progress, "FullyGraded")
    assert.equal(mock.setGradingOutcome(nonexistentExerciseId, "pending"), false)
    assert.equal(
      (
        await post("set-grading-outcome", {
          exercise_id: exercise.slide.exercise_id,
          outcome: "timedOut",
        })
      ).status,
      204,
    )
    assert.equal(
      (await post("set-grading-outcome", { exercise_id: exercise.slide.exercise_id, outcome: "x" }))
        .status,
      400,
    )
  })

  test("the control routes drive the same state", async () => {
    assert.equal((await post("set-exam-ended", { exam_id: EXAM_ID, ended: true })).status, 204)
    assert.deepEqual(await getJson("/exams"), [])
    assert.equal((await post("set-exam-ended", { exam_id: "x", ended: true })).status, 404)
    assert.equal(
      (await post("set-course-fields", { course_id: pythonCourse.id, fields: { is_staff: true } }))
        .status,
      204,
    )
    assert.equal(
      (await post("set-model-solution-revealed", { course_id: pythonCourse.id, revealed: true }))
        .status,
      204,
    )
    assert.equal(
      (
        await post("set-exercise-review-progress", {
          exercise_id: passingExercise.slide.exercise_id,
          progress: { reviewing_stage: "locked" },
        })
      ).status,
      204,
    )
    assert.equal((await post("set-exam-ended", { exam_id: 1 })).status, 400)
  })
})

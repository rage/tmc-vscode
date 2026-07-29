import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"

import type { Express, NextFunction, Request, Response } from "express"
import express from "express"
import multer from "multer"
import type { Context, Document } from "openapi-backend"
import { OpenAPIBackend } from "openapi-backend"

import { buildTarZst } from "./archive"
import {
  courses,
  exerciseByArchiveSlug,
  exerciseById,
  failingExercise,
  MOOC_MOCK_BASE_URL,
  notEnrolledExerciseId,
  passingExercise,
  pendingManualExercise,
  type ExerciseSlide,
} from "./fixtures"
import {
  EXERCISE_SERVICES_SCOPE,
  registerMoocOAuthRoutes,
  resetMoocOAuthState,
  scopesForBearer,
} from "./oauth"

// Spec-validated mock of the courses.mooc.fi exercise-services client API
// (`/api/v0/exercise-services/client`).
//
// openapi-backend is the routing + validation core: it routes by operationId
// from the vendored OpenAPI document, validates every REQUEST against the spec
// (AJV), and -- via a postResponseHandler calling validateResponse -- validates
// every RESPONSE the mock produces. A response that violates the spec becomes a
// loud HTTP 500, so the mock provably cannot drift from the contract (a drift
// is a failing test). See backend/mooc/exercise-services-client.openapi.generated.json
// (vendored from secret-project-331; re-vendor with `pnpm run vendor:langs-openapi`).
//
// Auth: by default every resource endpoint requires a valid `Authorization:
// Bearer <token>` (see the auth middleware in registerMoocRoutes), mirroring the
// real sp331 backend's UserFromOAuthToken extractor, with the raw sp331
// 401/403 envelope so the refresh-retry/delete seam is exercised end to end.
// Pass `requireAuth: false` to opt out (e.g. a test exercising localhost, which
// the CLI sends no bearer to unless TMC_LANGS_MOOC_TRUST_LOCALHOST is set).

const SPEC_PATH = path.join(__dirname, "exercise-services-client.openapi.generated.json")

// ---- stateful submissions ----
//
// The real backend uses TWO distinct submission id spaces, and this mock mirrors
// the split so the flows exercise the right ids:
//   - submit returns an EXERCISE-TASK-SUBMISSION id -> the id `/grading` expects.
//   - the submissions list, `/download` and `/share` use the
//     EXERCISE-SLIDE-SUBMISSION id.
// Each submit mints one of each; the record is indexed under both so grading
// resolves by the task-submission id while list/download/share resolve by the
// slide-submission id.

interface SubmissionRecord {
  exerciseId: string
  /** Returned by submit; the id `/grading` is polled with. */
  taskSubmissionId: string
  /** The id the submissions list, `/download` and `/share` use. */
  slideSubmissionId: string
  polls: number
  createdAt: string
  /**
   * File-store URL of the archive that was actually submitted, served back
   * verbatim by the per-submission archive route. In the real backend
   * `stub_download_url`/old-submission archive urls are arbitrary absolute
   * file-store URLs, so a dedicated spec-exempt route (distinct from the stub
   * `/mooc-archives` route) is faithful.
   */
  archiveDownloadUrl: string
}

const submissionsByTaskId = new Map<string, SubmissionRecord>()
const submissionsBySlideId = new Map<string, SubmissionRecord>()
const submissionsByExercise = new Map<string, SubmissionRecord[]>()
/**
 * The exact archive bytes uploaded with each submission (multer memory buffer),
 * keyed by slide-submission id. Served by the per-submission archive route so an
 * old-submission download returns THAT submission's content -- not the exercise
 * stub -- letting the restore flow be tested end to end.
 */
const submissionArchivesBySlideId = new Map<string, Buffer>()

// ---- auth-mode observation (for cross-process test assertions) ----
//
// The integration mock runs in a separate process from the test, so these
// record the most recent authenticated request's `Authorization` header and a
// count, surfaced via `GET /mooc-mock/auth-state`, to let a test prove the CLI
// actually attached the bearer it expects.
let lastAuthorization: string | undefined
let authenticatedRequestCount = 0

/** Clears in-memory submission + auth-observation state (for test isolation). */
export const resetMoocState = (): void => {
  submissionsByTaskId.clear()
  submissionsBySlideId.clear()
  submissionsByExercise.clear()
  submissionArchivesBySlideId.clear()
  lastAuthorization = undefined
  authenticatedRequestCount = 0
}

/**
 * The sp331 auth-error envelope (domain/error.rs `ApiErrorResponse`),
 * byte-faithful to `UserFromOAuthToken`: the live serializer omits an empty
 * `errors` array and absent `metadata`, so those aren't emitted here either.
 */
const authError = (
  type: "unauthorized" | "forbidden",
  message: string,
): Record<string, unknown> => ({
  type,
  message_key: type,
  message,
})

// ---- response envelope threaded through the postResponseHandler ----

interface MockResponse {
  status: number
  body: unknown
}

const ok = (body: unknown): MockResponse => ({ status: 200, body })

/** A spec-valid `ApiErrorResponse` body for the documented error statuses. */
const apiError = (messageKey: string, message: string): Record<string, unknown> => ({
  errors: [],
  message,
  message_key: messageKey,
  metadata: null,
  type: null,
})

interface CreateMoocApiOptions {
  /**
   * Test-only fault injection: the named operationId returns a spec-violating
   * body, exercising the response-validation guard (which must turn it into a
   * 500). Never set in the real mock.
   */
  injectResponseFault?: string
  /**
   * Test-only fault injection: every client operation responds with the
   * spec-documented 426 `obsolete_client` error, modelling an `X-Client-Version`
   * older than the server minimum. Never set in normal runs -- the real
   * backend's MINIMUM_CLIENT_VERSION is unset, so this contract is otherwise
   * dormant and untested.
   */
  injectObsoleteClient?: boolean
  /**
   * Bearer validation. When enabled (the default), every resource endpoint
   * requires a valid `Authorization: Bearer <token>`: missing/unknown/expired
   * -> 401 `unauthorized`, recognised but lacking the `exercise-services` scope
   * -> 403 `forbidden`. Pass `false` for the old auth-less behavior.
   */
  requireAuth?: boolean
}

const findCourse = (id: string) => courses.find((c) => c.course.id === id)

const findSlide = (exerciseId: string): ExerciseSlide | undefined =>
  exerciseById.get(exerciseId)?.slide

// Per-exercise point weight (score_maximum), deliberately heterogeneous across
// fixtures so progress aggregation exercises differing weights rather than a
// uniform 1-per-exercise total. passingExercise stays 1 so the existing
// single-exercise pythonCourse progress assertion is unaffected.
const scoreMaximumByExerciseId = new Map<string, number>([
  [passingExercise.slide.exercise_id, 1],
  [failingExercise.slide.exercise_id, 2],
  [pendingManualExercise.slide.exercise_id, 3],
])

const scoreMaximumFor = (exerciseId: string): number =>
  scoreMaximumByExerciseId.get(exerciseId) ?? 1

/** True once a submission has been polled enough that grading has "completed". */
const isGraded = (record: SubmissionRecord): boolean => record.polls > 1

/**
 * Terminal grading outcome per exercise fixture. Shared by the grading-poll
 * response and the submissions list so a submission's listed score/progress
 * matches the grading the exercise actually produces (passing exercises show
 * FullyGraded/1, failing show Failed/0, etc.) instead of a hardcoded value.
 */
const GRADING_OUTCOMES = {
  passing: {
    grading_progress: "FullyGraded",
    score_given: 1,
    feedback_text: "All tests passed",
  },
  failing: {
    grading_progress: "Failed",
    score_given: 0,
    feedback_text: "Some tests failed",
  },
  pendingManual: {
    grading_progress: "PendingManual",
    score_given: 0.5,
    feedback_text: "Awaiting manual grading",
  },
} as const

const outcomeOf = (
  record: SubmissionRecord,
): (typeof GRADING_OUTCOMES)[keyof typeof GRADING_OUTCOMES] =>
  GRADING_OUTCOMES[exerciseById.get(record.exerciseId)?.gradingOutcome ?? "passing"]

const gradingStatus = (record: SubmissionRecord): unknown => {
  // First poll: not graded yet. Subsequent polls: the exercise's terminal
  // grading outcome. Deterministic (poll-count based) rather than wall-clock
  // based so tests are not flaky.
  if (!isGraded(record)) {
    return "NoGradingYet"
  }
  const now = new Date().toISOString()
  const outcome = exerciseById.get(record.exerciseId)?.gradingOutcome ?? "passing"
  const grading = outcomeOf(record)
  return {
    Grading: {
      grading_progress: grading.grading_progress,
      score_given: grading.score_given,
      grading_started_at: now,
      grading_completed_at: outcome === "pendingManual" ? null : now,
      // A distinctive non-null value: the reconciliation test asserts this
      // survives zod parsing, which catches the generated schema dropping the
      // required-but-any-typed `feedback_json` field (it would otherwise be
      // silently stripped). The field is otherwise unconsumed today.
      feedback_json: { mock_feedback: "reconciliation sentinel" },
      feedback_text: grading.feedback_text,
    },
  }
}

/**
 * Builds the openapi-backend instance with all client operation handlers
 * registered. Handlers return a {@link MockResponse}; the postResponseHandler
 * validates its body against the spec before writing it.
 */
export const createMoocApi = (options: CreateMoocApiOptions = {}): OpenAPIBackend => {
  // Load the spec as an object and run in `quick` mode. Quick mode skips
  // openapi-backend's OpenAPI meta-schema validation of the DOCUMENT (which
  // rejects this valid OpenAPI 3.1 doc -- utoipa emits 3.1 features like
  // `type: [T, "null"]` that the bundled meta-schema check trips on) while
  // still building the router and the request/response validators we rely on.
  const definition = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8")) as Document
  const api = new OpenAPIBackend({
    definition,
    quick: true,
    validate: true,
  })

  // Validate every request against the spec, EXCEPT the multipart submit: its
  // requestBody is an opaque `type: string` in the spec, and openapi-backend
  // only includes a requestBody in request validation when it is an object or
  // JSON, so a string multipart body always trips a spurious "missing
  // requestBody". The submit path param is trivial (a uuid) and its response is
  // still validated by the postResponseHandler -- the drift guard that matters.
  // NB: the constructor boolean-coerces the `validate` option, so the predicate
  // is assigned to the property directly (handleRequest honours a function).
  api.validate = (c: Context) => c.operation?.operationId !== "submitClientExercise"

  const fault = options.injectResponseFault
  const obsoleteClient = options.injectObsoleteClient ?? false

  api.register({
    // GET /api/v0/exercise-services/client/courses
    getClientCourses: (): MockResponse => {
      if (fault === "getClientCourses") {
        // id must be a uuid + required fields missing -> spec violation
        return ok([{ id: 42 }])
      }
      return ok(courses.map((c) => c.course))
    },

    // GET /api/v0/exercise-services/client/courses/{id}
    getClientCourse: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const found = findCourse(id)
      if (!found) {
        return { status: 404, body: apiError("not_found", `no such course: ${id}`) }
      }
      return ok(found.course)
    },

    // GET /api/v0/exercise-services/client/courses/{id}/exercises
    getClientCourseExercises: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const found = findCourse(id)
      if (!found) {
        return { status: 404, body: apiError("not_found", `no such course: ${id}`) }
      }
      return ok(found.exercises.map((e) => e.slide))
    },

    // GET /api/v0/exercise-services/client/courses/{id}/progress
    getClientCourseProgress: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const found = findCourse(id)
      if (!found) {
        return { status: 404, body: apiError("not_found", `no such course: ${id}`) }
      }
      // One zeroed entry per exercise, like the real backend, derived from this
      // run's submissions: attempted once submitted, completed/scored once a
      // submission has been polled to its terminal (FullyGraded) outcome.
      return ok({
        course_id: found.course.id,
        exercises: found.exercises.map((e) => {
          const records = submissionsByExercise.get(e.slide.exercise_id) ?? []
          const graded = records.filter((r) => isGraded(r))
          const scores = graded.map((r) => outcomeOf(r).score_given)
          const scoreGiven = scores.length > 0 ? Math.max(...scores) : 0
          const completed = graded.some((r) => outcomeOf(r).grading_progress === "FullyGraded")
          return {
            exercise_id: e.slide.exercise_id,
            score_given: scoreGiven,
            score_maximum: scoreMaximumFor(e.slide.exercise_id),
            completed,
            attempted: records.length > 0,
          }
        }),
      })
    },

    // GET /api/v0/exercise-services/client/exercises/{id}
    getClientExercise: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      if (id === notEnrolledExerciseId) {
        // A real exercise whose course the user is not enrolled in: the backend
        // resolves the slide but its course context is inaccessible, raising a
        // BadRequest that maps to 422 with message_key `not_enrolled`
        // (domain/error.rs). The spec documents this 422 (ApiErrorResponse).
        return { status: 422, body: apiError("not_enrolled", "not enrolled to this course") }
      }
      const slide = findSlide(id)
      if (!slide) {
        // An entirely unknown exercise id: the backend's get_by_id yields
        // RecordNotFound -> 404 (the spec documents 404 on this path). Distinct
        // from the not-enrolled 422 above.
        return { status: 404, body: apiError("not_found", `no such exercise: ${id}`) }
      }
      return ok(slide)
    },

    // POST /api/v0/exercise-services/client/exercises/{id}/submit  (multipart)
    submitClientExercise: (c: Context, req: Request, res: Response): MockResponse | undefined => {
      // Enforce the part names the real backend's actix `SubmissionForm`
      // requires: a JSON text part named `submission` and a `file` part.
      // actix rejects a missing/misnamed part with a 400 the spec does not
      // document, so the rejection is written directly (headersSent skips the
      // response validator, same as notFound).
      const fields = req.body as Record<string, unknown> | undefined
      const files = req.files as Record<string, unknown[]> | undefined
      let slideSubmission: Record<string, unknown> | undefined
      try {
        slideSubmission =
          typeof fields?.submission === "string"
            ? (JSON.parse(fields.submission) as Record<string, unknown>)
            : undefined
      } catch {
        slideSubmission = undefined
      }
      if (
        slideSubmission?.exercise_slide_id === undefined ||
        slideSubmission.exercise_task_id === undefined ||
        !files?.file?.length
      ) {
        res
          .status(400)
          .json({ error: "submit requires a JSON `submission` part and a `file` part" })
        return undefined
      }
      const exerciseId = String(c.request.params.id)
      if (exerciseId === notEnrolledExerciseId) {
        // Consistent with getClientExercise's 422 above; the spec documents
        // this 422 on submit too.
        return { status: 422, body: apiError("not_enrolled", "not enrolled to this course") }
      }
      const taskSubmissionId = randomUUID()
      const slideSubmissionId = randomUUID()
      const fixture = exerciseById.get(exerciseId)
      // Retain the EXACT archive bytes that were submitted (the CLI compresses
      // the on-disk exercise directory into this `file` part) so the
      // old-submission download can serve back this submission's own content.
      const uploaded = (files.file[0] as { buffer?: Buffer } | undefined)?.buffer
      let archiveDownloadUrl: string
      if (uploaded) {
        retainSubmissionArchive(slideSubmissionId, uploaded)
        // A per-submission archive url on the dedicated spec-exempt route; the
        // slide-submission id keys the stored bytes.
        archiveDownloadUrl = `${MOOC_MOCK_BASE_URL}/mooc-submission-archives/${slideSubmissionId}.tar.zst`
      } else {
        // Defensive fallback (submit already requires a `file` part): point at
        // the exercise's stub archive as the previous behavior did.
        const archiveSlug = fixture?.archiveSlug ?? exerciseId
        archiveDownloadUrl = `${MOOC_MOCK_BASE_URL}/mooc-archives/${archiveSlug}.tar.zst`
      }
      const record: SubmissionRecord = {
        exerciseId,
        taskSubmissionId,
        slideSubmissionId,
        polls: 0,
        createdAt: new Date().toISOString(),
        archiveDownloadUrl,
      }
      submissionsByTaskId.set(taskSubmissionId, record)
      submissionsBySlideId.set(slideSubmissionId, record)
      const list = submissionsByExercise.get(exerciseId) ?? []
      list.push(record)
      submissionsByExercise.set(exerciseId, list)
      // submit returns the EXERCISE-TASK-SUBMISSION id (what /grading expects)
      return ok({ submission_id: taskSubmissionId })
    },

    // GET /api/v0/exercise-services/client/submissions/{id}/grading
    // (id = exercise-task-submission id, from submit)
    getClientSubmissionGrading: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const record = submissionsByTaskId.get(id)
      if (!record) {
        // Unknown submission: the backend's get_by_id yields RecordNotFound ->
        // 404 (the spec now documents 404 on this path). Mirrors the real
        // backend rather than the previous synthetic 200 NoGradingYet.
        return { status: 404, body: apiError("not_found", `no such submission: ${id}`) }
      }
      record.polls += 1
      return ok(gradingStatus(record))
    },

    // GET /api/v0/exercise-services/client/exercises/{id}/submissions
    getClientExerciseSubmissions: (c: Context): MockResponse => {
      const exerciseId = String(c.request.params.id)
      const records = submissionsByExercise.get(exerciseId) ?? []
      // newest first -- each item's `id` is the slide-submission id. A graded
      // submission reports the exercise's actual grading outcome (score +
      // progress); an as-yet-ungraded one reports nulls.
      const items = [...records].toReversed().map((record) => {
        const graded = isGraded(record)
        const outcome = outcomeOf(record)
        return {
          id: record.slideSubmissionId,
          exercise_id: record.exerciseId,
          created_at: record.createdAt,
          score_given: graded ? outcome.score_given : null,
          grading_progress: graded ? outcome.grading_progress : null,
        }
      })
      return ok(items)
    },

    // GET /api/v0/exercise-services/client/submissions/{id}/download
    // (id = exercise-slide-submission id, from the submissions list)
    downloadClientSubmission: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const record = submissionsBySlideId.get(id)
      if (!record) {
        return { status: 404, body: apiError("not_found", `no such submission: ${id}`) }
      }
      return ok({ archive_download_url: record.archiveDownloadUrl })
    },

    // POST /api/v0/exercise-services/client/submissions/{id}/share
    // (id = exercise-slide-submission id)
    shareClientSubmission: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const record = submissionsBySlideId.get(id)
      if (!record) {
        // The real backend loads the submission then checks ownership; an id
        // that is not the current user's yields the spec-documented 403.
        return { status: 403, body: apiError("forbidden", `cannot share submission: ${id}`) }
      }
      const token = randomUUID()
      return ok({ paste_url: `${MOOC_MOCK_BASE_URL}/shared-submissions/${token}` })
    },
  })

  // Unknown route: 404. Written directly, so the postResponseHandler skips it.
  api.register("notFound", (_c: Context, _req: Request, res: Response) =>
    res.status(404).json({ error: "no such exercise-services client endpoint" }),
  )

  // Request failed spec validation: loud 400 (catches the CLI drifting).
  api.register("validationFail", (c: Context, _req: Request, res: Response) =>
    res.status(400).json({ error: "request failed spec validation", details: c.validation.errors }),
  )

  // Operation with no handler: 501.
  api.register("notImplemented", (_c: Context, _req: Request, res: Response) =>
    res.status(501).json({ error: "not implemented in mock" }),
  )

  // Validate every mock RESPONSE against the spec before sending it. A response
  // the spec forbids is a mock/spec drift and must fail loudly (500) so tests
  // catch it. Handlers that already wrote the response (notFound etc.) are
  // skipped via res.headersSent.
  api.register("postResponseHandler", (c: Context, _req: Request, res: Response) => {
    if (res.headersSent) {
      return
    }
    let { status, body } = c.response as MockResponse
    // Test-only obsolete-client fault: rewrite any operation's response to the
    // spec-documented 426 with an ApiErrorResponse body. Validated below like
    // any other response, so a 426 (not a 500) proves the 426 body conforms to
    // the spec's ApiErrorResponse schema.
    if (obsoleteClient && c.operation?.operationId) {
      status = 426
      body = apiError("obsolete_client", "the client is obsolete and must be upgraded")
    }
    if (c.operation?.operationId) {
      const validation = c.api.validateResponse(body, c.operation, status)
      if (validation.errors) {
        console.error(
          `[mooc-mock] response for ${c.operation.operationId} failed spec validation:`,
          JSON.stringify(validation.errors),
        )
        return res.status(500).json({
          error: "mock response failed spec validation",
          operationId: c.operation.operationId,
          details: validation.errors,
        })
      }
    }
    if (body === undefined) {
      return res.status(status).end()
    }
    return res.status(status).json(body)
  })

  api.init()
  return api
}

// The submit part names, per the backend's `SubmissionForm`
// (exercise_services/client.rs) and the spec:
//   - `submission` : JSON ExerciseSlideSubmission (a text field, no filename)
//   - `file`       : the exercise archive (a file part)
// multer routes the text field to req.body and the file to req.files; the
// submit handler enforces both parts like the real backend does.
//
// 50 MB is comfortably above any legitimate exercise archive while bounding
// the memory a malformed/malicious upload can consume; exceeding it raises
// multer's LIMIT_FILE_SIZE, mapped to a 413 by the error handler below.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const upload = multer({ limits: { fileSize: MAX_UPLOAD_BYTES } })

// Caps retained archives so a long-lived mock doesn't accumulate them
// unboundedly; oldest is evicted first, and a download of an evicted archive
// simply 404s (the restore flow already tolerates that).
const MAX_RETAINED_ARCHIVES = 32
const retainSubmissionArchive = (slideSubmissionId: string, bytes: Buffer): void => {
  submissionArchivesBySlideId.set(slideSubmissionId, bytes)
  while (submissionArchivesBySlideId.size > MAX_RETAINED_ARCHIVES) {
    const oldest = submissionArchivesBySlideId.keys().next().value
    if (oldest === undefined) {
      break
    }
    submissionArchivesBySlideId.delete(oldest)
  }
}

/**
 * Mounts the mooc mock onto an existing Express app:
 *   - `/api/v0/exercise-services/client/*`  -> spec-routed + validated client API
 *   - `/mooc-archives/*` -> the .tar.zst stub archives referenced by each
 *     exercise's `stub_download_url`. This route is INTENTIONALLY OUTSIDE the
 *     OpenAPI spec: `stub_download_url` is an arbitrary absolute file-store URL
 *     in the real backend, so it is deliberately spec-exempt here.
 */
export const registerMoocRoutes = (app: Express, options: CreateMoocApiOptions = {}): void => {
  const api = createMoocApi(options)

  // Spec-exempt archive route (see doc comment above).
  app.get("/mooc-archives/:archive", (req, res, next) => {
    const archive = req.params.archive.replace(/\.tar\.zst$/, "")
    const exercise = exerciseByArchiveSlug.get(archive)
    if (!exercise || !fs.existsSync(exercise.sourceDir)) {
      return next()
    }
    buildTarZst(exercise.sourceDir)
      .then((bytes) => {
        res.setHeader("Content-Type", "application/octet-stream")
        res.send(bytes)
      })
      .catch(next)
  })

  // Spec-exempt per-submission archive route: serves the exact bytes uploaded
  // with a given submission (keyed by slide-submission id). Distinct from the
  // stub `/mooc-archives` route on purpose -- old-submission archive URLs are
  // arbitrary absolute file-store URLs in the real backend, and serving the
  // submitted content (not the stub) is what makes the restore flow testable.
  app.get("/mooc-submission-archives/:archive", (req, res, next) => {
    const id = req.params.archive.replace(/\.tar\.zst$/, "")
    const bytes = submissionArchivesBySlideId.get(id)
    if (!bytes) {
      return next()
    }
    res.setHeader("Content-Type", "application/octet-stream")
    res.send(bytes)
  })

  // Spec-exempt observation route; see the module-level state above.
  app.get("/mooc-mock/auth-state", (_req, res) => {
    res.json({ lastAuthorization, authenticatedRequestCount })
  })

  // Spec-exempt reset route: lets an out-of-process consumer sharing one
  // long-lived mock (notably the Playwright fixtures) isolate each test.
  // In-process (vitest) tests call resetMooc*State directly.
  app.post("/mooc-mock/reset", (_req, res) => {
    resetMoocState()
    resetMoocOAuthState()
    res.status(204).end()
  })

  const moocRouter = express.Router()

  const requireAuth = options.requireAuth ?? true

  // Runs before the spec router (mirroring UserFromOAuthToken running before
  // the actix handler), so its 401/403 bodies are the raw sp331 envelope
  // rather than the spec router's ApiErrorResponse shape.
  if (requireAuth) {
    moocRouter.use((req: Request, res: Response, next) => {
      const header = req.headers.authorization
      const token =
        typeof header === "string" && header.startsWith("Bearer ")
          ? header.slice("Bearer ".length)
          : undefined
      if (!token) {
        res.status(401).json(authError("unauthorized", "Missing bearer token"))
        return
      }
      const scopes = scopesForBearer(token)
      if (!scopes) {
        res
          .status(401)
          .json(authError("unauthorized", "The access token is missing, invalid, or expired."))
        return
      }
      if (!scopes.includes(EXERCISE_SERVICES_SCOPE)) {
        res
          .status(403)
          .json(
            authError(
              "forbidden",
              "The access token does not grant the required exercise-services scope.",
            ),
          )
        return
      }
      lastAuthorization = header
      authenticatedRequestCount += 1
      next()
    })
  }

  const handle = (req: Request, res: Response): void => {
    const contentType = req.headers["content-type"] ?? ""
    const isMultipart = contentType.startsWith("multipart/")
    void api.handleRequest(
      {
        method: req.method,
        // full path incl. the mount, so it matches the spec paths
        path: req.originalUrl.split("?")[0] ?? req.path,
        query: req.query as Record<string, string>,
        // The submit requestBody is typed as an opaque string in the spec
        // (multipart/form-data). openapi-backend validates req.body against
        // that string schema but cannot parse binary multipart, so we feed it a
        // non-empty placeholder string (satisfies `type: string` + `required`)
        // and read the real parsed parts off req (req.body.submission / req.files)
        // in the handler.
        body: isMultipart ? "multipart-form-data" : req.body,
        headers: req.headers as Record<string, string>,
      },
      req,
      res,
    )
  }

  // submit is multipart -> parse it before openapi-backend (which validates but
  // does not parse binary bodies)
  moocRouter.post("/exercises/:id/submit", upload.fields([{ name: "file", maxCount: 1 }]), handle)
  moocRouter.use(handle)

  // Map multer's LIMIT_FILE_SIZE rejection to a 413 instead of a generic 500.
  moocRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "uploaded archive exceeds the size limit" })
      return
    }
    next(err)
  })

  app.use("/api/v0/exercise-services/client", moocRouter)

  // Device-flow OAuth endpoints. Registered separately and deliberately NOT
  // spec-validated (they are not part of the exercise-services client spec).
  registerMoocOAuthRoutes(app)
}

/** Builds a standalone Express app hosting only the mooc mock (used by tests). */
export const createMoocApp = (options: CreateMoocApiOptions = {}): Express => {
  const app = express()
  app.use(express.json())
  registerMoocRoutes(app, options)
  return app
}

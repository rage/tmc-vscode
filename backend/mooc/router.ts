import { createHmac, randomUUID, timingSafeEqual } from "crypto"
import fs from "fs"
import path from "path"

import type { Express, NextFunction, Request, Response } from "express"
import express from "express"
import multer from "multer"
import type { Context, Document } from "openapi-backend"
import { OpenAPIBackend } from "openapi-backend"

import { API_ERRORS, type ApiErrorMessageKey } from "./apiErrors"
import { buildTarZst } from "./archive"
import {
  createMoocFixtures,
  DEFAULT_MOOC_MOCK_BASE_URL,
  type CourseWithExercises,
  type ExerciseSlide,
  type MoocExerciseFixture,
  type MoocFixtures,
} from "./fixtures"
import {
  createMoocOAuthState,
  EXERCISE_SERVICES_SCOPE,
  expireMoocAccessToken,
  type MoocOAuthState,
  registerMoocOAuthRoutes,
  scopesForBearer,
  setDeviceFlowClock,
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
// That covers success bodies only: the spec's ApiErrorResponse constrains no
// member, so error envelopes are pinned against ./apiErrors instead.
//
// Auth: by default every resource endpoint requires a valid `Authorization:
// Bearer <token>` (see the auth middleware in registerMoocRoutes), mirroring the
// real sp331 backend's UserFromOAuthToken extractor, with the raw sp331
// 401/403 envelope so the refresh-retry/delete seam is exercised end to end.
// Pass `requireAuth: false` to opt out (e.g. a test exercising localhost, which
// the CLI sends no bearer to unless TMC_LANGS_MOOC_TRUST_LOCALHOST is set).

const SPEC_PATH = path.join(__dirname, "exercise-services-client.openapi.generated.json")

// ---- per-instance state ----
//
// Every mutable binding below belongs to ONE mock, built by registerMoocRoutes
// and closed over by that mock's handlers. Two mocks in one process -- the
// suites run several -- therefore share no submissions, uploads, auth
// observations or OAuth tokens, and each hands out URLs naming the address it
// serves on.

// The real backend uses TWO distinct submission id spaces, and this mock mirrors
// the split so the flows exercise the right ids:
//   - `/grading` is polled with the EXERCISE-TASK-SUBMISSION id.
//   - the submissions list, `/download` and `/share` use the
//     EXERCISE-SLIDE-SUBMISSION id.
// Submit returns BOTH, so a client never re-derives one from the other. Each
// submit mints one of each; the record is indexed under both so grading resolves
// by the task-submission id while list/download/share resolve by the
// slide-submission id.

/**
 * Whose submission a record is. The mock authenticates exactly one student, so
 * ownership is binary rather than a user id, and another student's submissions
 * are seeded rather than submitted.
 */
type SubmissionOwner = "caller" | "another-user"

interface SubmissionRecord {
  exerciseId: string
  /** Returned by submit; the id `/grading` is polled with. */
  taskSubmissionId: string
  /** The id the submissions list, `/download` and `/share` use. */
  slideSubmissionId: string
  owner: SubmissionOwner
  polls: number
  createdAt: string
  /** Host file ids the submit named, in request order; what `/download` returns. */
  fileIds: string[]
}

// `POST exercises/{id}/files` stores files the client names in a later submit.
// The real host binds each upload to (exercise, user) and reaps unreferenced
// ones, so the mock models the binding and a soft-delete.

interface UploadRecord {
  /**
   * The host's own file id, and the ONLY id a submit may name. Deliberately NOT
   * the client-chosen multipart field name: the real host echoes that field name
   * back on a different member and keys the file by its `file_uploads` row id,
   * so a client that confuses the two must fail here exactly as it would in
   * production.
   */
  id: string
  name: string
  /** Echoed from the part's Content-Type, as the host does; not inferred from the name. */
  mime: string
  sizeBytes: number
  /** Path segment under the spec-exempt file-store route, as the real host mints. */
  storedName: string
  /** A submit naming this file for any other exercise gets `unknown_upload`. */
  exerciseId: string
  /** Soft-deleted (reaped): a submit naming it gets `upload_expired`, not `unknown_upload`. */
  expired: boolean
}

interface MoocMockState {
  /** Absolute origin every URL this mock hands out is built from. */
  baseUrl: string
  fixtures: MoocFixtures
  /** Slide and task lookups by their OWN ids, for submit's slide/task ownership checks. */
  slideById: Map<string, ExerciseSlide>
  slideIdByTaskId: Map<string, string>
  /** The course an exercise belongs to, which is where its enrollment is recorded. */
  courseByExerciseId: Map<string, CourseWithExercises>
  /**
   * Per-exercise point weight (score_maximum), deliberately heterogeneous across
   * fixtures so progress aggregation exercises differing weights rather than a
   * uniform 1-per-exercise total. passingExercise stays 1 so the existing
   * single-exercise pythonCourse progress assertion is unaffected.
   */
  scoreMaximumByExerciseId: Map<string, number>
  submissionsByTaskId: Map<string, SubmissionRecord>
  submissionsBySlideId: Map<string, SubmissionRecord>
  submissionsByExercise: Map<string, SubmissionRecord[]>
  uploadsById: Map<string, UploadRecord>
  /** Uploaded bytes keyed by stored path segment, served by the file-store route. */
  uploadBytesByStoredName: Map<string, Buffer>
  /** One-shot: the next upload batch is stored already reaped. */
  expireNextUpload: boolean
  /** One-shot per entry: the next call to this operationId answers with this status. */
  failNextByOperation: Map<string, number>
  // The integration mock runs in a separate process from the test, so the two
  // members below record the most recent authenticated request's `Authorization`
  // header and a count, surfaced via `GET /mooc-mock/auth-state`, to let a test
  // prove the CLI actually attached the bearer it expects.
  lastAuthorization: string | undefined
  authenticatedRequestCount: number
  /** This instance's isolated device-flow + issued-token state; see oauth.ts. */
  oauth: MoocOAuthState
}

/** The half of a mock's state that is derived from its base URL. */
type FixtureIndex = Pick<
  MoocMockState,
  | "baseUrl"
  | "fixtures"
  | "slideById"
  | "slideIdByTaskId"
  | "courseByExerciseId"
  | "scoreMaximumByExerciseId"
>

const indexFixtures = (baseUrl: string): FixtureIndex => {
  const fixtures = createMoocFixtures(baseUrl)
  const slideById = new Map<string, ExerciseSlide>()
  const slideIdByTaskId = new Map<string, string>()
  const courseByExerciseId = new Map<string, CourseWithExercises>()
  for (const exercise of fixtures.exerciseById.values()) {
    slideById.set(exercise.slide.slide_id, exercise.slide)
    for (const task of exercise.slide.tasks) {
      slideIdByTaskId.set(task.task_id, exercise.slide.slide_id)
    }
  }
  for (const course of fixtures.courses) {
    for (const exercise of course.exercises) {
      courseByExerciseId.set(exercise.slide.exercise_id, course)
    }
  }
  return {
    baseUrl,
    fixtures,
    slideById,
    slideIdByTaskId,
    courseByExerciseId,
    scoreMaximumByExerciseId: new Map([
      [fixtures.passingExercise.slide.exercise_id, 1],
      [fixtures.failingExercise.slide.exercise_id, 2],
      [fixtures.pendingManualExercise.slide.exercise_id, 3],
    ]),
  }
}

const createMoocMockState = (baseUrl: string): MoocMockState => ({
  ...indexFixtures(baseUrl),
  submissionsByTaskId: new Map(),
  submissionsBySlideId: new Map(),
  submissionsByExercise: new Map(),
  uploadsById: new Map(),
  uploadBytesByStoredName: new Map(),
  expireNextUpload: false,
  failNextByOperation: new Map(),
  lastAuthorization: undefined,
  authenticatedRequestCount: 0,
  oauth: createMoocOAuthState(),
})

/**
 * Which host error a {@link MoocMockControls.failNext} status stands for. A
 * status alone is ambiguous -- several message keys share one -- so the
 * canonical key per injectable status is named here, and a status with no entry
 * cannot be injected.
 */
const FAULT_ERRORS: Record<number, ApiErrorMessageKey> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  422: "validation_error",
  426: "obsolete_client",
  500: "internal_error",
}

/** Why {@link MoocMockControls.failNext} refused to arm a fault. */
type FailNextRejection = "unknown-operation" | "unsupported-status"

/**
 * Drives one mock's state from a test or a control route. Reach it with
 * {@link moocMockOf} on the app the mock was mounted on.
 */
export interface MoocMockControls {
  /**
   * Discards submissions, uploads, the auth observation and every OAuth token
   * this instance has minted or seeded; fixtures and base URL survive.
   */
  reset: () => void
  /**
   * Soft-deletes an upload, modelling the host's reaper. Returns false for an
   * unknown id. Drives the `upload_expired` path, which is otherwise unreachable.
   */
  expireUpload: (fileId: string) => boolean
  /**
   * Arms the reaper to consume the NEXT upload batch, so the following submit sees
   * `upload_expired`. This is the only way to hit the race the CLI's upload retry
   * exists for: the reaper would otherwise have to fire inside the millisecond gap
   * between the CLI's own two calls.
   */
  expireNextUpload: () => void
  /**
   * Arms a one-shot failure: the next call to `operationId` answers with the
   * error the host raises for `status`, without running its handler. Returns why
   * it could not be armed, or undefined once armed.
   */
  failNext: (operationId: string, status: number) => FailNextRejection | undefined
  /**
   * Seeds a submission the host has no files for, so its download is an empty list.
   * Only an exercise type with no files at all is like this, and a submit through the
   * client API cannot produce one -- hence the seed.
   * Returns undefined for an unknown exercise.
   */
  seedFilelessSubmission: (
    exerciseId: string,
  ) => { taskSubmissionId: string; slideSubmissionId: string } | undefined
  /**
   * Seeds a submission belonging to a different student, so grading, download and
   * share answer 403 for it. Nothing a client can do produces one, so the owner
   * check is unreachable without this seed. Returns undefined for an unknown
   * exercise.
   */
  seedForeignSubmission: (
    exerciseId: string,
  ) => { taskSubmissionId: string; slideSubmissionId: string } | undefined
  /** Points every URL this mock hands out at `baseUrl`. */
  rebase: (baseUrl: string) => void
  /**
   * Drives this instance's device-flow clock, so a test can cross a poll
   * interval or a token lifetime without a real sleep. Pass nothing to restore
   * real wall time.
   */
  setOAuthClock: (clock?: () => number) => void
}

/** Records one submission under both of its id spaces and against its exercise. */
const retainSubmission = (
  state: MoocMockState,
  exerciseId: string,
  fileIds: string[],
  owner: SubmissionOwner = "caller",
): SubmissionRecord => {
  const record: SubmissionRecord = {
    exerciseId,
    taskSubmissionId: randomUUID(),
    slideSubmissionId: randomUUID(),
    owner,
    polls: 0,
    createdAt: new Date().toISOString(),
    fileIds: [...fileIds],
  }
  state.submissionsByTaskId.set(record.taskSubmissionId, record)
  state.submissionsBySlideId.set(record.slideSubmissionId, record)
  const list = state.submissionsByExercise.get(exerciseId) ?? []
  list.push(record)
  state.submissionsByExercise.set(exerciseId, list)
  return record
}

const createMoocMockControls = (
  state: MoocMockState,
  knownOperation: (operationId: string) => boolean,
): MoocMockControls => ({
  reset: () => {
    state.submissionsByTaskId.clear()
    state.submissionsBySlideId.clear()
    state.submissionsByExercise.clear()
    state.uploadsById.clear()
    state.uploadBytesByStoredName.clear()
    state.expireNextUpload = false
    state.failNextByOperation.clear()
    state.lastAuthorization = undefined
    state.authenticatedRequestCount = 0
    state.oauth.reset()
  },
  expireUpload: (fileId) => {
    const upload = state.uploadsById.get(fileId)
    if (!upload) {
      return false
    }
    upload.expired = true
    state.uploadBytesByStoredName.delete(upload.storedName)
    return true
  },
  expireNextUpload: () => {
    state.expireNextUpload = true
  },
  failNext: (operationId, status) => {
    if (!knownOperation(operationId)) {
      return "unknown-operation"
    }
    if (!(status in FAULT_ERRORS)) {
      return "unsupported-status"
    }
    state.failNextByOperation.set(operationId, status)
    return undefined
  },
  seedFilelessSubmission: (exerciseId) => {
    if (!state.fixtures.exerciseById.has(exerciseId)) {
      return undefined
    }
    const { taskSubmissionId, slideSubmissionId } = retainSubmission(state, exerciseId, [])
    return { taskSubmissionId, slideSubmissionId }
  },
  seedForeignSubmission: (exerciseId) => {
    if (!state.fixtures.exerciseById.has(exerciseId)) {
      return undefined
    }
    const { taskSubmissionId, slideSubmissionId } = retainSubmission(
      state,
      exerciseId,
      [],
      "another-user",
    )
    return { taskSubmissionId, slideSubmissionId }
  },
  rebase: (baseUrl) => void Object.assign(state, indexFixtures(baseUrl)),
  setOAuthClock: (clock) => setDeviceFlowClock(state.oauth, clock),
})

// ---- response envelope threaded through the postResponseHandler ----

interface MockResponse {
  status: number
  body: unknown
}

const ok = (body: unknown): MockResponse => ({ status: 200, body })

/**
 * The host's `ApiErrorResponse` envelope for `messageKey`. The live serializer
 * omits an empty `errors` array and an absent `metadata`, so neither is emitted.
 */
const apiErrorBody = (
  messageKey: ApiErrorMessageKey,
  message: string,
): Record<string, unknown> => ({
  type: API_ERRORS[messageKey].type,
  message_key: messageKey,
  message,
})

/**
 * A controlled error, status included: the host derives both the envelope's
 * `type` and the status from the variant the key names, so a handler that picked
 * its own status could disagree with the host while still satisfying the spec.
 */
const apiError = (messageKey: ApiErrorMessageKey, message: string): MockResponse => ({
  status: API_ERRORS[messageKey].status,
  body: apiErrorBody(messageKey, message),
})

/** Writes a {@link MockResponse} from a plain handler, outside the spec router. */
const send = (res: Response, { status, body }: MockResponse): void => {
  res.status(status).json(body)
}

interface CreateMoocApiOptions {
  /**
   * Test-only fault injection: the named operationId returns a spec-violating
   * body, exercising the response-validation guard (which must turn it into a
   * 500). Process-lifetime, unlike the one-shot
   * {@link MoocMockControls.failNext}; backend/index.ts reads it from
   * `MOOC_MOCK_FAULT`.
   */
  injectResponseFault?: string | undefined
  /**
   * Lowest `X-Client-Version` served, as `major.minor.patch`. Unset (the
   * default) serves everything, matching the host, whose MINIMUM_CLIENT_VERSION
   * is None -- so the 426 contract is dormant in production and a mock has to
   * name a minimum to exercise it. With one set, a missing or unparseable
   * header counts as obsolete, as on the host.
   */
  minimumClientVersion?: string | undefined
  /**
   * Bearer validation. When enabled (the default), every resource endpoint
   * requires a valid `Authorization: Bearer <token>`: missing/unknown/expired
   * -> 401 `unauthorized`, recognised but lacking the `exercise-services` scope
   * -> 403 `forbidden`. Pass `false` for the old auth-less behavior.
   */
  requireAuth?: boolean
  /**
   * Origin every absolute URL the mock hands out is built from -- stub and
   * model-solution downloads, answer-file claims and share links. Defaults to
   * the env value; createMoocApp overrides it with the address it bound, so a
   * suite on an ephemeral port gets URLs it can follow verbatim.
   */
  baseUrl?: string
}

// Header a client advertises its version on, read by every client operation
// (host: SupportedClient / check_client_version).
const CLIENT_VERSION_HEADER = "x-client-version"

/**
 * `major.minor.patch` as comparable components. Missing minor/patch count as 0
 * and anything non-numeric is unparseable, as the host parses it.
 */
const parseClientVersion = (version: string): number[] | undefined => {
  const parts = version.trim().split(".")
  const components = [parts[0] ?? "", parts[1] ?? "0", parts[2] ?? "0"].map((part) =>
    /^[0-9]+$/.test(part) ? Number(part) : Number.NaN,
  )
  return components.some((component) => Number.isNaN(component)) ? undefined : components
}

const isAtLeast = (client: number[], minimum: number[]): boolean => {
  for (const [index, component] of client.entries()) {
    const floor = minimum[index] ?? 0
    if (component !== floor) {
      return component > floor
    }
  }
  return true
}

/**
 * The host's obsolete-client rule, as a response for the operation to answer
 * with instead of running. A minimum is the only thing that arms it; with one
 * set, a missing or unparseable client version is obsolete.
 */
const obsoleteClientError = (
  minimumClientVersion: string | undefined,
  advertised: string | undefined,
): MockResponse | undefined => {
  if (minimumClientVersion === undefined) {
    return undefined
  }
  const minimum = parseClientVersion(minimumClientVersion)
  const client = advertised === undefined ? undefined : parseClientVersion(advertised)
  if (minimum && client && isAtLeast(client, minimum)) {
    return undefined
  }
  return apiError(
    "obsolete_client",
    `This client is obsolete; the minimum supported version is ${minimumClientVersion}.`,
  )
}

const findCourse = (state: MoocMockState, id: string) =>
  state.fixtures.courses.find((c) => c.course.id === id)

const scoreMaximumFor = (state: MoocMockState, exerciseId: string): number =>
  state.scoreMaximumByExerciseId.get(exerciseId) ?? 1

/**
 * Exercise services that declare `supports_native_client`, i.e. the only ones this
 * API serves. The host reads the live set from `exercise_service_info`; here it is
 * a constant, because the mock serves one plugin.
 */
const NATIVE_CLIENT_CAPABLE_SLUGS = ["tmc"]

const isClientCapable = (serviceSlug: string): boolean =>
  NATIVE_CLIENT_CAPABLE_SLUGS.includes(serviceSlug)

/**
 * The slide as a native client may see it: tasks belonging to a service that
 * cannot serve this client are not merely unusable, they are invisible, so a
 * client never holds a task id that submit would have to reject.
 */
const clientServableSlide = (slide: ExerciseSlide): ExerciseSlide => ({
  ...slide,
  tasks: slide.tasks.filter((task) => isClientCapable(task.exercise_service_slug)),
})

const isEnrolled = (state: MoocMockState, exerciseId: string): boolean =>
  state.courseByExerciseId.get(exerciseId)?.enrolled === true

const notEnrolledError = (): MockResponse =>
  apiError("not_enrolled", "User is not enrolled to this exercise's course")

/** True once a submission has been polled enough that grading has "completed". */
const isGraded = (record: SubmissionRecord): boolean => record.polls > 1

/**
 * The caller's own submissions to an exercise. Progress, the reveal rule and the
 * submissions list are all per-user on the host, so a seeded foreign submission
 * must be invisible to every one of them.
 */
const callerSubmissionsFor = (state: MoocMockState, exerciseId: string): SubmissionRecord[] =>
  (state.submissionsByExercise.get(exerciseId) ?? []).filter((record) => record.owner === "caller")

/**
 * The host's `verify_user_can_answer_exercise`: a passed deadline, then an
 * exhausted per-slide try limit. Answers with the refusal, or undefined when the
 * student may still answer.
 */
const answerRefusal = (
  state: MoocMockState,
  exercise: MoocExerciseFixture,
): MockResponse | undefined => {
  const { deadline } = exercise.slide
  // The host allows a second of slack, so a deadline one tick away is already past.
  if (deadline !== null && Date.now() + 1000 >= Date.parse(deadline)) {
    return apiError("validation_error", "Exercise deadline passed.")
  }
  const limit = exercise.maxTriesPerSlide
  if (
    limit !== undefined &&
    callerSubmissionsFor(state, exercise.slide.exercise_id).length >= limit
  ) {
    return apiError("validation_error", "You've ran out of tries.")
  }
  return undefined
}

/** The host's `verify_submission_owner`, whose message names the operation refused. */
const foreignSubmissionError = (
  record: SubmissionRecord,
  message: string,
): MockResponse | undefined =>
  record.owner === "caller" ? undefined : apiError("forbidden", message)

/**
 * The host's reveal rule (`model_solution_should_be_revealed`): full points, or
 * the slide's try limit used up. The try half counts submissions rather than
 * gradings, so it fires on the last try a student is allowed however that try
 * scores.
 */
const modelSolutionRevealed = (state: MoocMockState, exercise: MoocExerciseFixture): boolean => {
  const exerciseId = exercise.slide.exercise_id
  const records = callerSubmissionsFor(state, exerciseId)
  const limit = exercise.maxTriesPerSlide
  if (limit !== undefined && records.length >= limit) {
    return true
  }
  return records.some(
    (record) =>
      isGraded(record) &&
      outcomeOf(state, record).score_given >= scoreMaximumFor(state, exerciseId),
  )
}

/**
 * The slide as `GET exercises/{id}` serves it, with each task's model solution
 * attached once it may be revealed. The list view never reveals one, mirroring
 * the host's `client_tasks_from_slide` callers.
 */
const revealModelSolutions = (
  state: MoocMockState,
  exercise: MoocExerciseFixture,
): ExerciseSlide => {
  if (!modelSolutionRevealed(state, exercise)) {
    return exercise.slide
  }
  return {
    ...exercise.slide,
    tasks: exercise.slide.tasks.map((task) => ({
      ...task,
      model_solution_spec: exercise.modelSolution,
    })),
  }
}

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
  state: MoocMockState,
  record: SubmissionRecord,
): (typeof GRADING_OUTCOMES)[keyof typeof GRADING_OUTCOMES] =>
  GRADING_OUTCOMES[state.fixtures.exerciseById.get(record.exerciseId)?.gradingOutcome ?? "passing"]

const gradingStatus = (state: MoocMockState, record: SubmissionRecord): unknown => {
  // First poll: not graded yet. Subsequent polls: the exercise's terminal
  // grading outcome. Deterministic (poll-count based) rather than wall-clock
  // based so tests are not flaky.
  if (!isGraded(record)) {
    return "NoGradingYet"
  }
  const now = new Date().toISOString()
  const outcome = state.fixtures.exerciseById.get(record.exerciseId)?.gradingOutcome ?? "passing"
  const grading = outcomeOf(state, record)
  return {
    Grading: {
      grading_progress: grading.grading_progress,
      score_given: grading.score_given,
      grading_started_at: now,
      grading_completed_at: outcome === "pendingManual" ? null : now,
      // Plugin-private structured feedback the CLI deliberately drops. A
      // distinctive non-null value, so the reconciliation test can assert it
      // never reaches the CLI-stdout schema.
      feedback_json: { mock_feedback: "reconciliation sentinel" },
      feedback_text: grading.feedback_text,
    },
  }
}

/**
 * Builds the openapi-backend instance with all client operation handlers
 * registered, every one of them reading and writing `state` alone. Handlers
 * return a {@link MockResponse}; the postResponseHandler validates its body
 * against the spec before writing it.
 */
const createMoocApi = (state: MoocMockState, options: CreateMoocApiOptions): OpenAPIBackend => {
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

  // Validate every request against the spec, EXCEPT the multipart file upload:
  // its requestBody is an opaque `type: string` in the spec, and openapi-backend
  // only includes a requestBody in request validation when it is an object or
  // JSON, so a string multipart body always trips a spurious "missing
  // requestBody". Its path param is trivial (a uuid), the multipart rules are
  // enforced in the handler, and its response is still validated by the
  // postResponseHandler -- the drift guard that matters. Submit IS validated:
  // its body is plain JSON, so the spec's rules on its path param and on the
  // body's slide and task ids apply before the handler runs. `data_files` is
  // optional there, so nothing is rejected for omitting it.
  // NB: the constructor boolean-coerces the `validate` option, so the predicate
  // is assigned to the property directly (handleRequest honours a function).
  api.validate = (c: Context) => c.operation?.operationId !== "uploadClientExerciseFiles"

  const fault = options.injectResponseFault

  // Runs before every operation handler, as the host's SupportedClient extractor
  // runs before its actix handler -- so an obsolete client's submit records
  // nothing. Returning the 426 rather than writing it keeps it under the
  // postResponseHandler's validation, which proves 426 is documented for the
  // operation.
  const guardClient =
    (handler: (c: Context, req: Request) => MockResponse) =>
    (c: Context, req: Request, res: Response): MockResponse | undefined => {
      const obsolete = obsoleteClientError(
        options.minimumClientVersion,
        req.headers[CLIENT_VERSION_HEADER] as string | undefined,
      )
      if (obsolete) {
        return obsolete
      }
      const operationId = c.operation?.operationId
      const injected =
        operationId === undefined ? undefined : state.failNextByOperation.get(operationId)
      const injectedError = injected === undefined ? undefined : FAULT_ERRORS[injected]
      if (operationId === undefined || injected === undefined || injectedError === undefined) {
        return handler(c, req)
      }
      state.failNextByOperation.delete(operationId)
      // Written past the response validator: an injected 500 is a status the
      // spec documents nowhere, so validating it would replace the fault under
      // test with a different one.
      send(res, apiError(injectedError, `injected ${injected} fault for ${operationId}`))
      return undefined
    }

  const operations: Record<string, (c: Context, req: Request) => MockResponse> = {
    // GET /api/v0/exercise-services/client/courses
    getClientCourses: (): MockResponse => {
      if (fault === "getClientCourses") {
        // id must be a uuid + required fields missing -> spec violation
        return ok([{ id: 42 }])
      }
      return ok(state.fixtures.courses.filter((c) => c.enrolled).map((c) => c.course))
    },

    // GET /api/v0/exercise-services/client/courses/{id}
    getClientCourse: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const found = findCourse(state, id)
      if (!found) {
        return apiError("not_found", `no such course: ${id}`)
      }
      return ok(found.course)
    },

    // GET /api/v0/exercise-services/client/courses/{id}/exercises
    getClientCourseExercises: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const found = findCourse(state, id)
      if (!found) {
        return apiError("not_found", `no such course: ${id}`)
      }
      // A slide left with no servable task drops out of the listing entirely, as
      // the host's `if !tasks.is_empty()` does.
      return ok(
        found.exercises
          .map((e) => clientServableSlide(e.slide))
          .filter((slide) => slide.tasks.length > 0),
      )
    },

    // GET /api/v0/exercise-services/client/courses/{id}/progress
    getClientCourseProgress: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const found = findCourse(state, id)
      if (!found) {
        return apiError("not_found", `no such course: ${id}`)
      }
      // One zeroed entry per exercise, like the real backend, derived from this
      // run's submissions: attempted once submitted, completed/scored once a
      // submission has been polled to its terminal (FullyGraded) outcome.
      return ok({
        course_id: found.course.id,
        exercises: found.exercises.map((e) => {
          const records = callerSubmissionsFor(state, e.slide.exercise_id)
          const graded = records.filter((r) => isGraded(r))
          const scores = graded.map((r) => outcomeOf(state, r).score_given)
          const scoreGiven = scores.length > 0 ? Math.max(...scores) : 0
          const completed = graded.some(
            (r) => outcomeOf(state, r).grading_progress === "FullyGraded",
          )
          return {
            exercise_id: e.slide.exercise_id,
            score_given: scoreGiven,
            score_maximum: scoreMaximumFor(state, e.slide.exercise_id),
            completed,
            attempted: records.length > 0,
          }
        }),
      })
    },

    // GET /api/v0/exercise-services/client/exercises/{id}
    getClientExercise: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const exercise = state.fixtures.exerciseById.get(id)
      if (!exercise) {
        // An entirely unknown exercise id: the backend's get_by_id yields
        // RecordNotFound -> 404 (the spec documents 404 on this path). Distinct
        // from the not-enrolled 422 below.
        return apiError("not_found", `no such exercise: ${id}`)
      }
      if (!isEnrolled(state, id)) {
        // The backend resolves the slide but its course context is inaccessible,
        // raising a BadRequest that maps to 422 with message_key `not_enrolled`
        // (domain/error.rs). The spec documents this 422 (ApiErrorResponse).
        return notEnrolledError()
      }
      const slide = clientServableSlide(revealModelSolutions(state, exercise))
      if (slide.tasks.length === 0) {
        // The exercise exists and the student is on its course, but nothing in it
        // can be rendered here -- which the host reports as a 404, not a 422.
        return apiError("not_found", "No task of this exercise can be served to this client")
      }
      return ok(slide)
    },

    // POST /api/v0/exercise-services/client/exercises/{id}/files  (multipart)
    uploadClientExerciseFiles: (c: Context, req: Request): MockResponse => {
      const exerciseId = String(c.request.params.id)
      const exercise = state.fixtures.exerciseById.get(exerciseId)
      if (!exercise) {
        return apiError("not_found", `no such exercise: ${exerciseId}`)
      }
      // The host runs both checks BEFORE reading the multipart stream, so an upload
      // is refused for the reason a submit would be refused rather than for a
      // multipart rule below. Stored objects outlive the request, which is why the
      // gate is here at all and not only on submit.
      if (!isEnrolled(state, exerciseId)) {
        return notEnrolledError()
      }
      const refusal = answerRefusal(state, exercise)
      if (refusal) {
        return refusal
      }

      // Every multipart rule violation is a `controller_err!(BadRequest, …)` on the
      // host, which maps to 422 `validation_error` (domain/error.rs) -- NOT 400.
      const files = (req.files as MulterFile[] | undefined) ?? []
      // Parts multer classified as plain fields, i.e. parts carrying no filename.
      // Checked before the file rules because the host's per-part order cannot be
      // recovered once multer has split the parts into `files` and `body`.
      // NB multer 2.x silently DROPS a file part whose filename is present but
      // empty, so that variant stays invisible here and cannot be rejected.
      if (Object.keys((req.body ?? {}) as Record<string, unknown>).length > 0) {
        return apiError(
          "validation_error",
          "Every exercise upload part must be a file with a filename",
        )
      }
      let batchBytes = 0
      const seenFieldNames = new Set<string>()
      for (const [index, file] of files.entries()) {
        // Per-part, as the host counts: a batch that is both over-limit and
        // malformed reports the malformed part, not the count.
        if (index >= MAX_UPLOAD_FILES) {
          return apiError(
            "validation_error",
            `A maximum of ${MAX_UPLOAD_FILES} files can be uploaded at once`,
          )
        }
        if (!UUID_PATTERN.test(file.fieldname)) {
          return apiError("validation_error", "Each exercise upload field name must be a UUID")
        }
        if (seenFieldNames.has(file.fieldname)) {
          return apiError("validation_error", "Duplicate exercise upload field id")
        }
        seenFieldNames.add(file.fieldname)
        // No per-file size check: multer's `fileSize` limit aborts such a part
        // before the handler sees it, and the error middleware answers it with
        // the host's message. Only the cross-part batch total is checked here.
        batchBytes += file.buffer.length
        if (batchBytes > MAX_UPLOAD_BATCH_BYTES) {
          return apiError("validation_error", UPLOAD_TOO_LARGE_MESSAGE)
        }
      }
      if (files.length === 0) {
        return apiError("validation_error", "At least one file must be uploaded")
      }

      const reaped = state.expireNextUpload
      state.expireNextUpload = false
      const stored = files.map((file) => retainUpload(state, exerciseId, file, reaped))
      return ok({ data_files: stored.map((record) => answerFile(state, record)) })
    },

    // POST /api/v0/exercise-services/client/exercises/{id}/submit  (JSON)
    submitClientExercise: (c: Context): MockResponse => {
      const exerciseId = String(c.request.params.id)
      const exercise = state.fixtures.exerciseById.get(exerciseId)
      if (!exercise) {
        return apiError("not_found", `no such exercise: ${exerciseId}`)
      }
      if (!isEnrolled(state, exerciseId)) {
        // Consistent with getClientExercise's 422 above; the spec documents
        // this 422 on submit too.
        return notEnrolledError()
      }
      // Request validation enforced the body shape. Only the slide and task are
      // required: all three answer members are optional, and omitting them all is a
      // valid JSON answer of `null`.
      const body = c.request.requestBody as {
        exercise_slide_id: string
        exercise_task_id: string
        answer_kind?: "json" | "file" | null
        data_json?: unknown
        data_files?: string[] | null
      }
      // The URL authorizes only the exercise; the slide and task ids come from the
      // body, so an unrelated exercise's slide/task must be rejected here or a
      // client could submit into it (host: verify_slide_and_task_belong).
      const slide = state.slideById.get(body.exercise_slide_id)
      if (!slide) {
        return apiError("not_found", `no such exercise slide: ${body.exercise_slide_id}`)
      }
      const taskSlideId = state.slideIdByTaskId.get(body.exercise_task_id)
      if (!taskSlideId) {
        return apiError("not_found", `no such exercise task: ${body.exercise_task_id}`)
      }
      if (slide.exercise_id !== exerciseId) {
        return apiError(
          "validation_error",
          `Exercise slide ${slide.slide_id} does not belong to exercise ${exerciseId}`,
        )
      }
      if (taskSlideId !== slide.slide_id) {
        return apiError(
          "validation_error",
          `Exercise task ${body.exercise_task_id} does not belong to exercise slide ${slide.slide_id}`,
        )
      }
      const task = slide.tasks.find((candidate) => candidate.task_id === body.exercise_task_id)
      // Every listing hides a task this client cannot be served, so naming one
      // means holding an id from somewhere else; persisting the answer would leave
      // it to fail deep inside a service that cannot read it (host:
      // verify_task_is_client_capable).
      if (task && !isClientCapable(task.exercise_service_slug)) {
        return apiError(
          "validation_error",
          `Exercise task ${task.task_id} belongs to the exercise service '${task.exercise_service_slug}', which cannot be served to this client`,
        )
      }
      // The two answer shapes the flat body allows but the answer model does not.
      // Checked here, after the slide/task ownership checks and before the per-upload
      // ones, in the host's own order (domain/exercises.rs: verify_named_uploads).
      const namedFiles = body.data_files ?? []
      const isJsonAnswer = (body.answer_kind ?? "json") === "json"
      if (isJsonAnswer) {
        if (namedFiles.length > 0) {
          return apiError(
            "validation_error",
            "A json answer cannot name uploaded files. Send answer_kind 'file' to submit files.",
          )
        }
      } else if (namedFiles.length === 0) {
        return apiError("validation_error", "A file answer must name at least one uploaded file.")
      }
      // The mock runs no exercise service, so a plugin's own answer validation is
      // a blind spot -- deliberately, except here. A tmc exercise's answer IS its
      // archive, so the host takes a fileless one and the tmc service fails it at
      // grading; the mock refuses it at submit instead. That keeps
      // seedFilelessSubmission the only route to a submission with no files, which
      // is what its doc comment claims.
      if (isJsonAnswer && task?.exercise_service_slug === "tmc") {
        return apiError(
          "validation_error",
          "The tmc exercise service cannot grade an answer that names no files.",
        )
      }
      // Deduplicating instead would record one file twice and list it twice in a
      // download, hiding the client defect (host: verify_uploads_are_distinct).
      const namedOnce = new Set<string>()
      for (const fileId of namedFiles) {
        if (namedOnce.has(fileId)) {
          return apiError("duplicate_upload", `Uploaded file ${fileId} was named more than once`)
        }
        namedOnce.add(fileId)
      }
      for (const fileId of namedFiles) {
        const upload = state.uploadsById.get(fileId)
        // A file bound to another exercise is indistinguishable from one that was
        // never uploaded, exactly as in the host: both are `unknown_upload`.
        if (!upload || upload.exerciseId !== exerciseId) {
          return apiError(
            "unknown_upload",
            `Uploaded file ${fileId} was not uploaded for this exercise by this user`,
          )
        }
        if (upload.expired) {
          return apiError(
            "upload_expired",
            `Uploaded file ${fileId} is no longer available; upload it again`,
          )
        }
      }
      // Last, as on the host, where grading is what enforces the deadline and the
      // try limit: everything about the answer itself is settled first.
      const refusal = answerRefusal(state, exercise)
      if (refusal) {
        return refusal
      }
      const record = retainSubmission(state, exerciseId, namedFiles)
      return ok({
        task_submission_id: record.taskSubmissionId,
        slide_submission_id: record.slideSubmissionId,
      })
    },

    // GET /api/v0/exercise-services/client/submissions/{id}/grading
    // (id = exercise-task-submission id, from submit)
    getClientSubmissionGrading: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const record = state.submissionsByTaskId.get(id)
      if (!record) {
        // Unknown submission: the backend's get_by_id yields RecordNotFound ->
        // 404 (the spec now documents 404 on this path). Mirrors the real
        // backend rather than the previous synthetic 200 NoGradingYet.
        return apiError("not_found", `no such submission: ${id}`)
      }
      const foreign = foreignSubmissionError(
        record,
        "Cannot view another user's submission grading",
      )
      if (foreign) {
        return foreign
      }
      record.polls += 1
      return ok(gradingStatus(state, record))
    },

    // GET /api/v0/exercise-services/client/exercises/{id}/submissions
    getClientExerciseSubmissions: (c: Context): MockResponse => {
      const exerciseId = String(c.request.params.id)
      const records = callerSubmissionsFor(state, exerciseId)
      // newest first -- each item's `id` is the slide-submission id. A graded
      // submission reports the exercise's actual grading outcome (score +
      // progress); an as-yet-ungraded one reports nulls.
      const items = [...records].toReversed().map((record) => {
        const graded = isGraded(record)
        const outcome = outcomeOf(state, record)
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
    // (id = exercise-slide-submission id, from the submissions list or submit)
    downloadClientSubmission: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const record = state.submissionsBySlideId.get(id)
      if (!record) {
        return apiError("not_found", `no such submission: ${id}`)
      }
      const foreign = foreignSubmissionError(record, "Cannot download another user's submission")
      if (foreign) {
        return foreign
      }
      // A submission made from no files is a 200 with an empty list, not a 404:
      // the host resolves this from its own upload records, and having none is
      // not the same as the submission not existing. The host's join filters
      // soft-deleted rows, so an explicitly reaped file drops out of the listing;
      // retention never drops a submission's own uploads (see retainUpload).
      // Order numbers come from the position in the answer as submitted, so a reaped
      // file leaves a gap rather than renumbering the ones that survive it.
      const data_files = record.fileIds
        .map((fileId, orderNumber) => ({ upload: state.uploadsById.get(fileId), orderNumber }))
        .filter(
          (entry): entry is { upload: UploadRecord; orderNumber: number } =>
            entry.upload !== undefined && !entry.upload.expired,
        )
        .map((entry) => answerFile(state, entry.upload, entry.orderNumber))
      return ok({ data_files })
    },

    // POST /api/v0/exercise-services/client/submissions/{id}/share
    // (id = exercise-slide-submission id)
    shareClientSubmission: (c: Context): MockResponse => {
      const id = String(c.request.params.id)
      const record = state.submissionsBySlideId.get(id)
      if (!record) {
        // The backend looks the submission up before it can check ownership, so an
        // id it has no row for is a 404 here exactly as it is on grading and
        // download; the 403 below belongs to a submission that exists and is
        // someone else's.
        return apiError("not_found", `no such submission: ${id}`)
      }
      const foreign = foreignSubmissionError(record, "Cannot share another user's submission")
      if (foreign) {
        return foreign
      }
      const token = randomUUID()
      return ok({ paste_url: `${state.baseUrl}/shared-submissions/${token}` })
    },
  }

  api.register(
    Object.fromEntries(
      Object.entries(operations).map(([operationId, handler]) => [
        operationId,
        guardClient(handler),
      ]),
    ),
  )

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
    const { status, body } = c.response as MockResponse
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

/** The subset of multer's file shape the upload handler reads. */
interface MulterFile {
  fieldname: string
  originalname: string
  mimetype: string
  buffer: Buffer
}

// The host's upload limits (controllers/helpers/file_uploading.rs). Kept identical
// so a client that exceeds them fails here too rather than only in production.
const MAX_UPLOAD_FILES = 10
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024
const MAX_UPLOAD_BATCH_BYTES = 100 * 1024 * 1024
const UPLOAD_TOO_LARGE_MESSAGE = "Exercise upload exceeds the 100 MiB per-file or batch limit"

// The host requires every multipart field name to be a UUID the client picked.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---- download claims ----
//
// An answer file's `url` is not a path to the object: it is a capability for that one
// file for one hour, which the host mints fresh on every response and redirects to the
// object store (base/src/jwt.rs, controllers/files.rs: redirect_claimed_file). A client
// must treat it as opaque, must not persist it, and must follow the redirect -- so the
// mock has to make it opaque and make it expire, or none of that is exercised.
//
// An HMAC rather than a real JWT: the client never inspects it, and forging one is the
// only thing a test could want to do that a JWT library would make harder.
const DOWNLOAD_CLAIM_PARAM = "download-claim"
const DOWNLOAD_CLAIM_SECRET = "mooc-mock-download-claim"
const DOWNLOAD_CLAIM_LIFETIME_SECONDS = 60 * 60

const signClaim = (fileUploadId: string, expiresAt: number): string =>
  createHmac("sha256", DOWNLOAD_CLAIM_SECRET).update(`${fileUploadId}.${expiresAt}`).digest("hex")

/** The `url` an answer file is read through, claim minted here and now. */
const claimedFileUrl = (state: MoocMockState, fileUploadId: string): string => {
  const expiresAt = Math.floor(Date.now() / 1000) + DOWNLOAD_CLAIM_LIFETIME_SECONDS
  const claim = `${expiresAt}.${signClaim(fileUploadId, expiresAt)}`
  return `${state.baseUrl}/api/v0/files/claimed/${fileUploadId}?${DOWNLOAD_CLAIM_PARAM}=${claim}`
}

/** Whether `claim` authorizes `fileUploadId` right now. */
const claimAuthorizes = (claim: string, fileUploadId: string): boolean => {
  const [expiresAt, mac] = claim.split(".")
  if (!expiresAt || !mac || !/^[0-9]+$/.test(expiresAt)) {
    return false
  }
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) {
    return false
  }
  // The claim names one file, so a claim for another one must not open this one.
  const expected = signClaim(fileUploadId, Number(expiresAt))
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
}

// `files` is one over the limit so a just-over-limit batch reaches the handler and
// gets the host's own message. `fileSize` matches the host's per-file cap: the host
// aborts mid-stream too, and the error middleware below maps the rejection to the
// host's message, so there is no handler-side per-file check.
const upload = multer({
  limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_UPLOAD_FILES + 1 },
})

// Host messages for the limits multer enforces before the handler runs.
const MULTER_ERROR_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: UPLOAD_TOO_LARGE_MESSAGE,
  LIMIT_FILE_COUNT: `A maximum of ${MAX_UPLOAD_FILES} files can be uploaded at once`,
}

/** Path prefix the host stores client uploads under (`CLIENT_UPLOAD_PATH_PREFIX`). */
const CLIENT_UPLOAD_PATH_PREFIX = "exercise-services-client"

// Caps retained uploads so a long-lived mock doesn't accumulate them unboundedly;
// oldest is evicted first. Uploads a submission was made from are spared even past
// the cap, as the host's reaper spares them (`NOT EXISTS … exercise_task_submission_files`):
// evicting one would silently turn a later restore of that submission into a no-op.
const MAX_RETAINED_UPLOADS = 32

/**
 * An upload as the wire reports it. `orderNumber` is the file's position in the answer it
 * belongs to, so it is null for an upload that is not part of one yet -- which is every
 * file the upload endpoint returns.
 */
const answerFile = (
  state: MoocMockState,
  stored: UploadRecord,
  orderNumber: number | null = null,
) => ({
  id: stored.id,
  name: stored.name,
  mime: stored.mime,
  size_bytes: stored.sizeBytes,
  order_number: orderNumber,
  url: claimedFileUrl(state, stored.id),
})

/**
 * Records one uploaded part. The returned `id` is freshly minted and is NEVER the
 * client's field name -- see {@link UploadRecord.id}.
 */
const retainUpload = (
  state: MoocMockState,
  exerciseId: string,
  file: MulterFile,
  reaped: boolean,
): UploadRecord => {
  const storedName = randomUUID().replaceAll("-", "")
  const record: UploadRecord = {
    id: randomUUID(),
    name: file.originalname,
    mime: file.mimetype,
    sizeBytes: file.buffer.length,
    storedName,
    exerciseId,
    expired: reaped,
  }
  state.uploadsById.set(record.id, record)
  if (!reaped) {
    state.uploadBytesByStoredName.set(storedName, file.buffer)
  }
  evictOldUploads(state)
  return record
}

/** Ids named by some submission, which retention must not evict. */
const submittedUploadIds = (state: MoocMockState): Set<string> => {
  const ids = new Set<string>()
  for (const submission of state.submissionsByTaskId.values()) {
    for (const fileId of submission.fileIds) {
      ids.add(fileId)
    }
  }
  return ids
}

const evictOldUploads = (state: MoocMockState): void => {
  if (state.uploadsById.size <= MAX_RETAINED_UPLOADS) {
    return
  }
  const submitted = submittedUploadIds(state)
  for (const [id, evicted] of state.uploadsById) {
    if (state.uploadsById.size <= MAX_RETAINED_UPLOADS) {
      return
    }
    if (submitted.has(id)) {
      continue
    }
    state.uploadsById.delete(id)
    state.uploadBytesByStoredName.delete(evicted.storedName)
  }
}

/**
 * Mounts the mooc mock onto an existing Express app:
 *   - `/api/v0/exercise-services/client/*`  -> spec-routed + validated client API
 *   - `/mooc-archives/*` -> the .tar.zst stub archives referenced by each
 *     exercise's `stub_download_url`. This route is INTENTIONALLY OUTSIDE the
 *     OpenAPI spec: `stub_download_url` is an arbitrary absolute file-store URL
 *     in the real backend, so it is deliberately spec-exempt here.
 *   - `/api/v0/files/claimed/:id` -> redirects an answer file's claim URL to the
 *     object, and `/api/v0/files/<prefix>/:name` serves it. Both spec-exempt for
 *     the same reason: they are file-store URLs, not client API routes.
 */
export const registerMoocRoutes = (
  app: Express,
  options: CreateMoocApiOptions = {},
): MoocMockControls => {
  const state = createMoocMockState(options.baseUrl ?? DEFAULT_MOOC_MOCK_BASE_URL)
  const api = createMoocApi(state, options)
  const controls = createMoocMockControls(
    state,
    (operationId) => api.getOperation(operationId) !== undefined,
  )
  app.locals.moocMock = controls

  // Spec-exempt archive route (see doc comment above).
  app.get("/mooc-archives/:archive", (req, res, next) => {
    const archive = req.params.archive.replace(/\.tar\.zst$/, "")
    const exercise = state.fixtures.exerciseByArchiveSlug.get(archive)
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

  // Spec-exempt claim route: resolves an answer file's `url` to the object, as the
  // real host does (controllers/files.rs: redirect_claimed_file). The Location is
  // RELATIVE on purpose, as the host's is: it resolves against whichever host the
  // request arrived on, so a client reaching the mock by any name still follows it.
  app.get("/api/v0/files/claimed/:id", (req, res, next) => {
    const claim = req.query[DOWNLOAD_CLAIM_PARAM]
    if (typeof claim !== "string") {
      // actix's query extractor rejects the missing parameter before the handler.
      return res.status(400).json(apiErrorBody("validation_error", "Missing download claim"))
    }
    if (!claimAuthorizes(claim, req.params.id)) {
      const rejected = apiError("validation_error", "Download claim does not authorize this file")
      return res.status(rejected.status).json(rejected.body)
    }
    const stored = state.uploadsById.get(req.params.id)
    if (!stored || !state.uploadBytesByStoredName.has(stored.storedName)) {
      return next()
    }
    res.setHeader("cache-control", "max-age=300, private")
    return res.redirect(302, `/api/v0/files/${CLIENT_UPLOAD_PATH_PREFIX}/${stored.storedName}`)
  })

  // Spec-exempt file-store route: serves the exact bytes of a client upload, so
  // an old-submission download returns THAT submission's own content rather than
  // the exercise stub, making the restore flow testable end to end. The real
  // host's upload URLs are `/api/v0/files/<prefix>/<random>` and sit outside the
  // client spec, so this path shape is faithful and deliberately spec-exempt.
  app.get(`/api/v0/files/${CLIENT_UPLOAD_PATH_PREFIX}/:name`, (req, res, next) => {
    const bytes = state.uploadBytesByStoredName.get(req.params.name)
    if (!bytes) {
      return next()
    }
    res.setHeader("Content-Type", "application/octet-stream")
    res.send(bytes)
  })

  // The /mooc-mock/* control routes below sit on the app rather than on
  // moocRouter, so they stay outside the bearer middleware: a test drives them
  // before it holds a token, and the real backend has no counterpart to
  // authenticate them against. They parse their own JSON bodies, as the OAuth
  // routes parse their own form bodies.
  const json = express.json()

  // Spec-exempt observation route; see MoocMockState's auth-observation members.
  app.get("/mooc-mock/auth-state", (_req, res) => {
    res.json({
      lastAuthorization: state.lastAuthorization,
      authenticatedRequestCount: state.authenticatedRequestCount,
    })
  })

  // Spec-exempt reset route: lets an out-of-process consumer sharing one
  // long-lived mock (notably the Playwright fixtures) isolate each test.
  app.post("/mooc-mock/reset", (_req, res) => {
    controls.reset()
    res.status(204).end()
  })

  // Spec-exempt seeding route for out-of-process consumers; see
  // {@link MoocMockControls.seedFilelessSubmission}.
  app.post("/mooc-mock/seed-fileless-submission", json, (req, res) => {
    const exerciseId = String((req.body as { exercise_id?: unknown })?.exercise_id ?? "")
    const seeded = controls.seedFilelessSubmission(exerciseId)
    if (!seeded) {
      res.status(404).json({ error: `no such exercise: ${exerciseId}` })
      return
    }
    res.json({
      task_submission_id: seeded.taskSubmissionId,
      slide_submission_id: seeded.slideSubmissionId,
    })
  })

  // Spec-exempt seeding route for out-of-process consumers; see
  // {@link MoocMockControls.seedForeignSubmission}.
  app.post("/mooc-mock/seed-foreign-submission", json, (req, res) => {
    const exerciseId = String((req.body as { exercise_id?: unknown })?.exercise_id ?? "")
    const seeded = controls.seedForeignSubmission(exerciseId)
    if (!seeded) {
      res.status(404).json({ error: `no such exercise: ${exerciseId}` })
      return
    }
    res.json({
      task_submission_id: seeded.taskSubmissionId,
      slide_submission_id: seeded.slideSubmissionId,
    })
  })

  // Spec-exempt reaper simulation for out-of-process consumers: arms the reaper
  // on the next upload so the submit that follows it sees `upload_expired`.
  app.post("/mooc-mock/expire-next-upload", (_req, res) => {
    controls.expireNextUpload()
    res.status(204).end()
  })

  // Spec-exempt fault injection for out-of-process consumers: the named
  // operation answers once with the host error for `status`. Without it a tier
  // outside this process can reach no error the fixtures do not already
  // produce -- a 5xx above all, which is what the client's retry and
  // error-reporting paths are written for.
  app.post("/mooc-mock/fail-next", json, (req, res) => {
    const { operationId, status } = (req.body ?? {}) as {
      operationId?: unknown
      status?: unknown
    }
    if (typeof operationId !== "string" || typeof status !== "number") {
      res.status(400).json({ error: "operationId must be a string and status a number" })
      return
    }
    const rejected = controls.failNext(operationId, status)
    if (rejected === "unknown-operation") {
      res.status(404).json({ error: `no such client operation: ${operationId}` })
      return
    }
    if (rejected === "unsupported-status") {
      res.status(400).json({
        error: `no host error answers with ${status}; injectable: ${Object.keys(FAULT_ERRORS).join(", ")}`,
      })
      return
    }
    res.status(204).end()
  })

  // Spec-exempt token invalidation for out-of-process consumers: expires the
  // named access token (or every live one), so the next resource call 401s while
  // the client still believes its stored token is good -- the only way to reach
  // the reactive refresh-and-retry path from outside this process.
  app.post("/mooc-mock/expire-access-token", json, (req, res) => {
    const accessToken = (req.body as { access_token?: unknown })?.access_token
    if (accessToken !== undefined && typeof accessToken !== "string") {
      res.status(400).json({ error: "access_token must be a string" })
      return
    }
    if (!expireMoocAccessToken(state.oauth, accessToken)) {
      res.status(404).json({ error: `no such access token: ${accessToken}` })
      return
    }
    res.status(204).end()
  })

  const moocRouter = express.Router()

  // The router parses its own JSON bodies rather than assuming the host app
  // mounted a parser: `handle` forwards req.body to openapi-backend, which
  // validates the submit body against the spec.
  moocRouter.use(json)

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
        send(res, apiError("unauthorized", "Missing bearer token"))
        return
      }
      const scopes = scopesForBearer(state.oauth, token)
      if (!scopes) {
        send(res, apiError("unauthorized", "The access token is missing, invalid, or expired."))
        return
      }
      if (!scopes.includes(EXERCISE_SERVICES_SCOPE)) {
        send(
          res,
          apiError(
            "forbidden",
            "The access token does not grant the required exercise-services scope.",
          ),
        )
        return
      }
      state.lastAuthorization = header
      state.authenticatedRequestCount += 1
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

  // The file upload is multipart -> parse it before openapi-backend (which
  // validates but does not parse binary bodies). Field names are client-chosen
  // UUIDs, so `any()` is the only accepting shape.
  moocRouter.post("/exercises/:id/files", upload.any(), handle)
  moocRouter.use(handle)

  // Multer rejects an over-size or over-count part before the handler sees it;
  // answer it as the host answers the same violation.
  moocRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      send(
        res,
        apiError(
          "validation_error",
          MULTER_ERROR_MESSAGES[err.code] ?? `Failed to read multipart field: ${err.code}`,
        ),
      )
      return
    }
    next(err)
  })

  app.use("/api/v0/exercise-services/client", moocRouter)

  // Device-flow OAuth endpoints. Registered separately and deliberately NOT
  // spec-validated (they are not part of the exercise-services client spec).
  registerMoocOAuthRoutes(app, state.oauth, () => state.baseUrl)

  return controls
}

/** The mock mounted on `app`, for a test that drives its state directly. */
export const moocMockOf = (app: Express): MoocMockControls =>
  app.locals.moocMock as MoocMockControls

/**
 * Builds a standalone Express app hosting only the mooc mock (used by tests).
 * Unless `baseUrl` names one, the app rebases its mock onto the address it
 * actually binds, so a suite listening on port 0 gets URLs it can follow
 * verbatim instead of ones naming the default port.
 */
export const createMoocApp = (options: CreateMoocApiOptions = {}): Express => {
  const app = express()
  const mock = registerMoocRoutes(app, options)
  if (options.baseUrl !== undefined) {
    return app
  }
  type Listen = Express["listen"]
  const bind = app.listen.bind(app) as Listen
  app.listen = ((...args: Parameters<Listen>) => {
    const server = bind(...args)
    // Prepended so the base URL is right before the caller's own listening
    // callback runs and starts driving the mock.
    server.prependListener("listening", () => {
      const address = server.address()
      if (address !== null && typeof address !== "string") {
        mock.rebase(`http://localhost:${address.port}`)
      }
    })
    return server
  }) as Listen
  return app
}

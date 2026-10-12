import type { Express, NextFunction, Request, RequestHandler, Response } from "express"
import express from "express"

import type {
  Course,
  CourseData,
  CourseDetails,
  CourseExercise,
  ExerciseDetails,
  NewSubmission,
  Organization,
  Submission,
  SubmissionFeedbackResponse,
  SubmissionFinished,
} from "../../shared/generated/langs"
import { MOCK_TMC_ACCESS_TOKEN } from "../mockSession"
import { EXERCISE_SERVICES_SCOPE } from "../mooc/oauth"
import type { BackendCourse, ExerciseWithFile } from "../utils"
import {
  createCourse,
  createExercise,
  createFinishedSubmission,
  createOldSubmission,
  createOrganization,
  failingExerciseId,
  passingExerciseId,
  respondWithFile,
} from "../utils"

interface DetailsForLangs {
  exercises: {
    id: number
    checksum: string
    course_name: string
    exercise_name: string
    hide_submission_results: boolean
  }[]
}

const testOrganization = createOrganization({
  information: "This is a test organization from a local development server.",
  name: "Test Organization",
  slug: "test",
})

export const organizations = [testOrganization]

let courseId = 1

const pythonCourse = createCourse({
  description: "This is a test python course from local development server.",
  id: courseId++,
  name: "python-course",
  title: "Python Course",
})

const javaCourse = createCourse({
  description: "This is a test java course from local development server.",
  id: courseId++,
  name: "java-course",
  title: "Java Course",
})

export const testCourses = [pythonCourse, javaCourse]

const organizationCourses = [
  {
    organization: testOrganization,
    courses: testCourses,
  },
]

const pythonExercisePassing = createExercise({
  checksum: "abc123",
  id: passingExerciseId,
  name: "part01-01_passing_exercise",
  points: [{ id: 0, name: "1.passing_exercise" }],
  path: ["test-python-course", "part01-01_passing_exercise.zip"],
})

const pythonExerciseFailing = createExercise({
  checksum: "bcd234",
  id: failingExerciseId,
  name: "part01-02_failing_exercise",
  points: [{ id: 1, name: "2.failing_exercise" }],
  path: ["test-python-course", "part01-02_failing_exercise.zip"],
})

const pythonExercises = [pythonExercisePassing, pythonExerciseFailing]

const javaExercisePassing = createExercise({
  checksum: "abc123",
  id: 12345,
  name: "part01-01_passing_exercise",
  points: [{ id: 0, name: "1.passing_exercise" }],
  path: ["test-java-course", "part01-01_passing_exercise.zip"],
})

const javaExercises = [javaExercisePassing]

export interface CourseWithExercises {
  course: BackendCourse
  exercises: ExerciseWithFile[]
}

export const courseExercises: CourseWithExercises[] = [
  { course: pythonCourse, exercises: pythonExercises },
  { course: javaCourse, exercises: javaExercises },
]

// Grading is decided by exercise id: only the failing fixture reports a failed
// test case, so a client can be driven through both outcomes. The names are the
// unittest ids the packed python exercises really produce, so a client rendering
// them shows what a real run would.
const testCasesOf = (exerciseId: number): { name: string; successful: boolean }[] =>
  exerciseId === failingExerciseId
    ? [{ name: "test.test_failing_exercise.FailingExercise.test_failing", successful: false }]
    : [{ name: "test.test_passing_exercise.PassingExercise.test_passing", successful: true }]

/**
 * The sandbox states a submission reports before it finishes, one per poll, so a
 * client walks all of them on every machine. Deriving them from elapsed time
 * instead skips states: the CLI's polls are a second apart, already past any
 * threshold short enough to keep a test fast.
 */
const SANDBOX_PROGRESSION = ["created", "sending_to_sandbox", "processing_on_sandbox"] as const

/** What a submission's URL answers: tmc-langs models only the finished shape. */
type SubmissionStatusReport =
  | { status: "processing"; sandbox_status: (typeof SANDBOX_PROGRESSION)[number] }
  | SubmissionFinished

interface SubmissionRecord {
  submission: Submission
  /** Archive served back for this submission's download. */
  file: string
  polls: number
}

const seededSubmissions = (): SubmissionRecord[] => [
  {
    submission: createOldSubmission({
      courseId: pythonCourse.id,
      exerciseName: pythonExercisePassing.exercise.name,
      id: 1,
      passed: true,
      points: pythonExercisePassing.exercise.name,
      timestamp: new Date(2000, 1, 1),
      userId: 1,
    }),
    file: pythonExercisePassing.file,
    polls: 0,
  },
]

interface TmcMockState {
  submissions: SubmissionRecord[]
  nextSubmissionId: number
}

const createTmcMockState = (): TmcMockState => ({
  submissions: seededSubmissions(),
  nextSubmissionId: 2,
})

/**
 * Drives one legacy TMC mock's state from a test or a control route. Reach it
 * with {@link tmcMockOf} on the app the mock was mounted on.
 */
export interface TmcMockControls {
  /**
   * Discards every submission made since the last reset, leaving the one
   * pre-existing old submission the fixtures declare. Courses and exercises are
   * immutable and survive.
   */
  reset: () => void
}

const createTmcMockControls = (state: TmcMockState): TmcMockControls => ({
  reset: () => {
    state.submissions = seededSubmissions()
    state.nextSubmissionId = 2
  },
})

export const tmcMockOf = (app: Express): TmcMockControls => app.locals.tmcMock as TmcMockControls

// Absolute URLs are built from the request rather than a configured port so the
// mock can be reached under an ephemeral port, and so the URLs it hands out
// stay same-origin with whatever root the CLI was pointed at -- which is what
// decides whether the CLI attaches its bearer to them.
const originOf = (req: Request): string => `${req.protocol}://${req.get("host") ?? "localhost"}`

const exerciseFixtures = courseExercises.flatMap(({ course, exercises }) =>
  exercises.map(({ exercise, file }) => ({ course, exercise, file })),
)

const findCourse = (params: Record<string, unknown>): CourseWithExercises | undefined =>
  courseExercises.find(({ course }) => course.id.toString() === params.courseId)

const findExercise = (
  params: Record<string, unknown>,
): (typeof exerciseFixtures)[number] | undefined =>
  exerciseFixtures.find(({ exercise }) => exercise.id.toString() === params.exerciseId)

const findOrganization = (
  params: Record<string, unknown>,
): (typeof organizationCourses)[number] | undefined =>
  organizationCourses.find(({ organization }) => organization.slug === params.slug)

/**
 * The handlers of a route answering for the fixture `find` picks out of the path, behind
 * `guards`. A path naming no fixture skips the route before any guard, so it answers 404, token
 * or not, as an unregistered path would.
 */
const forFixture = <Fixture>(
  find: (params: Record<string, unknown>) => Fixture | undefined,
  guards: RequestHandler[],
  handler: (fixture: Fixture, req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler[] => {
  const fixtures = new WeakMap<Request, Fixture>()
  return [
    (req, _res, next) => {
      const fixture = find(req.params)
      if (fixture === undefined) {
        next("route")
        return
      }
      fixtures.set(req, fixture)
      next()
    },
    ...guards,
    (req, res, next) => {
      handler(fixtures.get(req) as Fixture, req, res, next)
    },
  ]
}

/**
 * Turns away a request that carries neither {@link MOCK_TMC_ACCESS_TOKEN} nor a
 * courses.mooc.fi token with the exercise-services scope, as tmc-server's
 * `unauthorize_guest!` turns away a guest, down to the response body the CLI
 * parses.
 */
const requireAccessToken =
  (options: RegisterV8RoutesOptions): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1]
    const isAuthenticated =
      token === MOCK_TMC_ACCESS_TOKEN ||
      (token !== undefined &&
        (options.introspectMoocToken?.(token)?.includes(EXERCISE_SERVICES_SCOPE) ?? false))
    if (options.requireAuth === false || isAuthenticated) {
      next()
      return
    }
    res.status(401).json({ error: "Authentication required" })
  }

export interface RegisterV8RoutesOptions {
  /** Defaults to true, as tmc-server's own API is not open to a guest. */
  requireAuth?: boolean
  /**
   * The courses.mooc.fi introspection tmc-server consults with
   * `ACCEPT_COURSES_MOOC_FI_TOKENS` on: the scopes an active token carries, or
   * undefined. Without it only the legacy token is accepted.
   */
  introspectMoocToken?: (token: string) => string[] | undefined
}

/**
 * Mounts the legacy TMC server's API v8 surface, plus the `/feedback` endpoint
 * its submission results point at and the spec-exempt `/tmc-mock/reset` control
 * route.
 *
 * Which routes authenticate mirrors tmc-server: the organization endpoints, the
 * exercise-details query and the exercise stub download are readable by a
 * guest, everything else needs a token.
 */
export const registerV8Routes = (
  app: Express,
  options: RegisterV8RoutesOptions = {},
): TmcMockControls => {
  const state = createTmcMockState()
  const controls = createTmcMockControls(state)
  app.locals.tmcMock = controls

  const authenticated = requireAccessToken(options)

  // getTmcCourseData(0), settings leg
  app.get(
    "/api/v8/courses/:courseId",
    ...forFixture(findCourse, [authenticated], ({ course }, _req, res) =>
      res.json(course satisfies CourseData),
    ),
  )

  // getTmcCourseData(0), exercises leg
  app.get(
    "/api/v8/courses/:courseId/exercises",
    ...forFixture(findCourse, [authenticated], ({ exercises }, _req, res) =>
      res.json(exercises.map((e) => e.exercise) satisfies CourseExercise[]),
    ),
  )

  // getOrganizations()
  app.get("/api/v8/org.json", (_req, res: Response<Organization[]>) => res.json(organizations))

  app.get(
    "/api/v8/org/:slug.json",
    ...forFixture(findOrganization, [], ({ organization }, _req, res) =>
      res.json(organization satisfies Organization),
    ),
  )

  // getTmcCourseData()
  app.get(
    "/api/v8/core/courses/:courseId",
    ...forFixture(findCourse, [authenticated], ({ course, exercises }, _req, res) =>
      res.json({
        course: { ...course, exercises: exercises.map((e) => e.exercise) },
      } satisfies { course: CourseDetails }),
    ),
  )

  // downloadTmcExercises(); before the routes below, whose `:exerciseId` would match "details".
  app.get("/api/v8/core/exercises/details", (req, res: Response<DetailsForLangs>) => {
    // tmc-langs sends several ids as one comma-separated value.
    const rawIds = req.query.ids
    const ids = (Array.isArray(rawIds) ? rawIds : [rawIds]).flatMap((id) => String(id).split(","))
    return res.json({
      exercises: exerciseFixtures
        .filter(({ exercise }) => ids.includes(exercise.id.toString()))
        .map(({ course, exercise }) => ({
          id: exercise.id,
          checksum: exercise.checksum,
          course_name: course.name,
          exercise_name: exercise.name,
          hide_submission_results: false,
        })),
    })
  })

  app.get(
    "/api/v8/core/exercises/:exerciseId",
    ...forFixture(findExercise, [authenticated], ({ course, exercise }, _req, res) =>
      res.json({
        ...exercise,
        course_id: course.id,
        course_name: course.name,
      } satisfies ExerciseDetails),
    ),
  )

  // downloadExercise(1)
  app.get(
    "/api/v8/core/exercises/:exerciseId/download",
    ...forFixture(findExercise, [], ({ file }, _req, res) => respondWithFile(res, file)),
  )

  // submitExercise(1)
  // submitExerciseToPaste(1, ...)
  app.post(
    "/api/v8/core/exercises/:exerciseId/submissions",
    ...forFixture(findExercise, [authenticated], ({ course, exercise, file }, req, res) => {
      const newSubmissionId = state.nextSubmissionId++
      state.submissions.push({
        submission: createOldSubmission({
          courseId: course.id,
          exerciseName: exercise.name,
          id: newSubmissionId,
          passed: exercise.id !== failingExerciseId,
          timestamp: new Date(),
          userId: 0,
        }),
        file,
        polls: 0,
      })
      const origin = originOf(req)
      return res.json({
        paste_url: `${origin}/paste/${newSubmissionId}`,
        show_submission_url: `${origin}/submissions/${newSubmissionId}`,
        submission_url: `${origin}/api/v8/core/exercises/${exercise.id}/submissions/${newSubmissionId}`,
      } satisfies NewSubmission)
    }),
  )

  app.get(
    "/api/v8/core/exercises/:exerciseId/submissions/:id",
    ...forFixture(findExercise, [authenticated], ({ course, exercise }, req, res, next) => {
      const id = String(req.params.id)
      const record = state.submissions.find((s) => s.submission.id.toString() === id)
      if (!record) {
        return next()
      }

      const sandboxStatus = SANDBOX_PROGRESSION[record.polls++]
      if (sandboxStatus) {
        return res.json({
          status: "processing",
          sandbox_status: sandboxStatus,
        } satisfies SubmissionStatusReport)
      }

      return res.json(
        createFinishedSubmission({
          courseName: course.name,
          exerciseName: exercise.name,
          id: Math.trunc(Number(id)),
          testCases: testCasesOf(exercise.id),
        }) satisfies SubmissionStatusReport,
      )
    }),
  )

  // getOldSubmissions(1)
  app.get(
    "/api/v8/exercises/:exerciseId/users/current/submissions",
    ...forFixture(findExercise, [authenticated], ({ exercise }, _req, res) =>
      res.json(
        state.submissions
          .filter((s) => s.submission.exercise_name === exercise.name)
          .map((s) => s.submission) satisfies Submission[],
      ),
    ),
  )

  // getCourses("test")
  app.get(
    "/api/v8/core/org/:slug/courses",
    ...forFixture(findOrganization, [authenticated], ({ courses }, _req, res) =>
      res.json(courses satisfies Course[]),
    ),
  )

  // If submission exists, return arbitrary archive
  app.get("/api/v8/core/submissions/:id/download", authenticated, (req, res, next) => {
    const record = state.submissions.find((s) => s.submission.id.toString() === req.params.id)
    if (!record) {
      return next()
    }
    return respondWithFile(res, record.file)
  })

  // submitSubmissionFeedback(...)
  app.post("/feedback", authenticated, (_req, res: Response<SubmissionFeedbackResponse>) =>
    res.json({ api_version: 8, status: "ok" }),
  )

  // Spec-exempt reset route, outside the token check: it isolates one test from
  // the previous one's submissions in the long-lived mock the Playwright tier
  // shares, and the real server has no counterpart to authenticate it against.
  app.post("/tmc-mock/reset", (_req, res) => {
    controls.reset()
    res.status(204).end()
  })

  return controls
}

/**
 * A standalone app carrying the legacy TMC mock, for tests that drive it over an
 * ephemeral port instead of the shared mock server.
 */
export const createTmcApp = (options: RegisterV8RoutesOptions = {}): Express => {
  const app = express()
  app.use(express.json())
  registerV8Routes(app, options)
  app.use((_req, res) => {
    res.status(404).json({ error: "Unhandled endpoint" })
  })
  return app
}

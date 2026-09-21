import type { Express, NextFunction, Request, RequestHandler, Response } from "express"
import express from "express"

import type {
  Course,
  CourseDetails,
  CourseExercise,
  CourseSettings,
  ExerciseDetails,
  OldSubmission,
  Organization,
  SubmissionFeedbackResponse,
  SubmissionResponse,
  SubmissionStatusReport,
} from "../../src/api/types"
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
import { MOCK_TMC_ACCESS_TOKEN } from "./accessToken"
import oauthRouter from "./oauth"

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

interface SubmissionRecord {
  submission: OldSubmission
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

/**
 * Turns away a request that does not carry {@link MOCK_TMC_ACCESS_TOKEN}, as
 * tmc-server's `unauthorize_guest!` turns away a guest, down to the response
 * body the CLI parses. Pass `requireAuth: false` to mount the routes open.
 */
const requireAccessToken =
  (requireAuth: boolean): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!requireAuth || req.get("authorization") === `Bearer ${MOCK_TMC_ACCESS_TOKEN}`) {
      next()
      return
    }
    res.status(401).json({ error: "Authentication required" })
  }

export interface RegisterV8RoutesOptions {
  /** Defaults to true, as tmc-server's own API is not open to a guest. */
  requireAuth?: boolean
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

  const authenticated = requireAccessToken(options.requireAuth ?? true)

  // getCourseSettings(0)
  for (const course of testCourses) {
    app.get(`/api/v8/courses/${course.id}`, authenticated, (_req, res: Response<CourseSettings>) =>
      res.json(course),
    )
  }

  // getCourseExercises(0)
  for (const { course, exercises } of courseExercises) {
    app.get(
      `/api/v8/courses/${course.id}/exercises`,
      authenticated,
      (_req, res: Response<CourseExercise[]>) => res.json(exercises.map((e) => e.exercise)),
    )
  }

  // getOrganizations()
  app.get("/api/v8/org.json", (_req, res: Response<Organization[]>) => res.json(organizations))

  // getOrganizations("test")
  for (const org of organizations) {
    app.get(`/api/v8/org/${org.slug}.json`, (_req, res: Response<Organization>) => {
      res.json(org)
    })
  }

  // getCourseDetails(0)
  for (const { course, exercises } of courseExercises) {
    app.get(
      `/api/v8/core/courses/${course.id}`,
      authenticated,
      (_req, res: Response<CourseDetails>) =>
        res.json({
          course: {
            ...course,
            exercises: exercises.map((e) => e.exercise),
          },
        }),
    )
  }

  // downloadExercises()
  app.get("/api/v8/core/exercises/details", (req, res: Response<DetailsForLangs>) => {
    const rawIds = req.query.ids
    const ids = Array.isArray(rawIds) ? rawIds : [rawIds]
    const downloadTargets: DetailsForLangs["exercises"] = []
    courseExercises.forEach((ce) => {
      ce.exercises
        .filter(({ exercise: e }) => ids.includes(e.id.toString()))
        .forEach(({ exercise: e }) => {
          downloadTargets.push({
            id: e.id,
            checksum: e.checksum,
            course_name: ce.course.name,
            exercise_name: e.name,
            hide_submission_results: false,
          })
        })
    })
    return res.json({
      exercises: downloadTargets,
    })
  })

  // getExerciseDetails(1)
  for (const { course, exercises } of courseExercises) {
    for (const { exercise } of exercises) {
      app.get(
        `/api/v8/core/exercises/${exercise.id}`,
        authenticated,
        (_req, res: Response<ExerciseDetails>) =>
          res.json({ ...exercise, course_id: course.id, course_name: course.name }),
      )
    }
  }

  // downloadExercise(1)
  for (const { exercises } of courseExercises) {
    for (const { exercise, file } of exercises) {
      app.get(`/api/v8/core/exercises/${exercise.id}/download`, (_req, res) => {
        return respondWithFile(res, file)
      })
    }
  }

  // submitExercise(1)
  // submitExerciseToPaste(1, ...)
  for (const { course, exercises } of courseExercises) {
    for (const { exercise, file } of exercises) {
      app.post(
        `/api/v8/core/exercises/${exercise.id}/submissions`,
        authenticated,
        (req, res: Response<SubmissionResponse>) => {
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
          })
        },
      )
    }
  }

  for (const { course, exercises } of courseExercises) {
    for (const { exercise } of exercises) {
      app.get(
        `/api/v8/core/exercises/${exercise.id}/submissions/:id`,
        authenticated,
        (req, res: Response<SubmissionStatusReport>, next) => {
          const id = req.params.id
          const record = state.submissions.find((s) => s.submission.id.toString() === id)
          if (!record) {
            return next()
          }

          const sandboxStatus = SANDBOX_PROGRESSION[record.polls++]
          if (sandboxStatus) {
            return res.json({ status: "processing", sandbox_status: sandboxStatus })
          }

          return res.json(
            createFinishedSubmission({
              courseName: course.name,
              exerciseName: exercise.name,
              id: Math.trunc(Number(id)),
              testCases: testCasesOf(exercise.id),
            }),
          )
        },
      )
    }
  }

  // getOldSubmissions(1)
  for (const { exercises } of courseExercises) {
    for (const { exercise } of exercises) {
      app.get(
        `/api/v8/exercises/${exercise.id}/users/current/submissions`,
        authenticated,
        (_req, res: Response<OldSubmission[]>) =>
          res.json(
            state.submissions
              .filter((s) => s.submission.exercise_name === exercise.name)
              .map((s) => s.submission),
          ),
      )
    }
  }

  // getCourses("test")
  for (const { organization, courses } of organizationCourses) {
    app.get(
      `/api/v8/core/org/${organization.slug}/courses`,
      authenticated,
      (_req, res: Response<Course[]>) => res.json(courses),
    )
  }

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
 * A standalone app carrying the legacy TMC mock and its OAuth endpoint, for
 * tests that drive it over an ephemeral port instead of the shared mock server.
 */
export const createTmcApp = (options: RegisterV8RoutesOptions = {}): Express => {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))
  app.use("/oauth", oauthRouter)
  registerV8Routes(app, options)
  app.use((_req, res) => {
    res.status(404).json({ error: "Unhandled endpoint" })
  })
  return app
}

import path from "path"

// Fixture data for the courses.mooc.fi (`/api/v0/exercise-services/client`) mock.
//
// Shapes mirror the vendored OpenAPI schemas (Course / ExerciseSlide /
// ExerciseTask). Ids are FIXED UUIDs so integration + conformance tests can
// hardcode them. The mooc client keys everything by UUID (unlike the legacy
// TMC mock's integer ids).
//
// NB on public_spec: the OpenAPI spec types public_spec / assignment /
// model_solution_spec as opaque `{}` (envelope-level validation only), but the
// CLI deserialises public_spec into tmc-mooc-client's PublicSpec struct, so the
// CONTENT here must be a valid tmc PublicSpec (type/archive_name/
// stub_download_url/student_file_paths/checksum) even though the mock's own
// response validation treats it as free-form. See
// tmc-langs-rust/crates/tmc-mooc-client/src/exercise.rs.

// Where a mock serves when nothing names an address: the port backend/index.ts
// listens on.
export const DEFAULT_MOOC_MOCK_BASE_URL = process.env.MOOC_MOCK_BASE_URL ?? "http://localhost:4001"

// Content-Type the CLI sends for a submission archive, and what the tmc exercise
// service writes for the same archive made in its IFrame. The host echoes the part's
// type into `AnswerFile.mime` without checking it, so nothing rejects a wrong one --
// the only guard is that all three repos spell it the same. Keep in step with
// tmc-langs-rust's ANSWER_ARCHIVE_MIME and services/tmc/src/util/answerArchive.ts.
export const TMC_ARCHIVE_MIME = "application/x-zstd-compressed-tar"

const RESOURCES = path.resolve(__dirname, "..", "resources", "test-python-course")

export interface EditorPublicSpec {
  type: "editor"
  archive_name: string
  stub_download_url: string
  student_file_paths: string[]
  checksum: string
}

/**
 * A browser exercise's public spec. It carries the same archive members as an
 * editor one -- the IFrame still needs the stub -- so `type` is the only thing
 * telling a native client it can neither download nor submit this task.
 */
export interface BrowserPublicSpec {
  type: "browser"
  archive_name: string
  stub_download_url: string
  student_file_paths: string[]
  checksum: string
  browser_test: { runtime: "python"; script: string }
}

export type PublicSpec = EditorPublicSpec | BrowserPublicSpec

/**
 * What the `tmc` exercise service emits (`services/tmc/src/util/stateInterfaces.ts`)
 * and tmc-mooc-client deserializes. The backend forwards it only once the model
 * solution may be revealed, so a wrong shape here breaks every command on an
 * exercise the student has already solved -- see the `model_solution_spec` note
 * above on why the OpenAPI spec cannot catch that.
 */
export interface ModelSolutionSpec {
  type: "editor" | "browser"
  solution_download_url: string
}

export interface ExerciseTask {
  task_id: string
  order_number: number
  assignment: unknown
  /** Only a service declaring `supports_native_client` can be served to this client. */
  exercise_service_slug: string
  public_spec: PublicSpec
  /** Null as stored; the mock reveals {@link MoocExerciseFixture.modelSolution} per the reveal rule. */
  model_solution_spec: ModelSolutionSpec | null
}

export interface ExerciseSlide {
  slide_id: string
  exercise_id: string
  course_id: string
  exercise_name: string
  exercise_order_number: number
  deadline: string | null
  tasks: ExerciseTask[]
}

export interface Course {
  id: string
  slug: string
  name: string
  description: string | null
  organization_name: string
}

/**
 * Deterministic grading result the mock returns for an exercise's submissions
 * (once polled past NoGradingYet):
 *   - `passing`       -> FullyGraded, full score
 *   - `failing`       -> Failed, zero score
 *   - `pendingManual` -> PendingManual (terminal-for-student), partial score
 */
export type GradingOutcome = "passing" | "failing" | "pendingManual"

export interface MoocExerciseFixture {
  slide: ExerciseSlide
  /** Slug used in the archive route path (`/mooc-archives/<slug>.tar.zst`). */
  archiveSlug: string
  /** Directory whose contents are packed into the served .tar.zst. */
  sourceDir: string
  /** Grading result the mock returns for this exercise's submissions. */
  gradingOutcome: GradingOutcome
  /** Served by `GET exercises/{id}` once the mock's reveal rule allows it. */
  modelSolution: ModelSolutionSpec
  /**
   * Submissions the student may make to one slide. Unset means unlimited, as an
   * exercise with `limit_number_of_tries` false; the count is per slide, and
   * every fixture slide is its exercise's only one.
   */
  maxTriesPerSlide?: number | undefined
}

const ORG = "Test Organization"

// ---- courses ----

export const pythonCourse: Course = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "mooc-python-course",
  name: "MOOC Python Course",
  description: "A test python course served by the local mooc mock backend.",
  organization_name: ORG,
}

export const extraCourse: Course = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "mooc-extra-course",
  name: "MOOC Extra Course",
  description: null,
  organization_name: ORG,
}

// Holds the exercises that are not a plain submittable editor exercise. Each one
// makes a host refusal or a client branch reachable that the two courses above
// cannot reach.
export const variantsCourse: Course = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "mooc-variants-course",
  name: "MOOC Variants Course",
  description: null,
  organization_name: ORG,
}

// A course the student is NOT enrolled on. Every gate a submit passes through
// starts with enrollment, so the mock needs a real course to fail it against.
export const notEnrolledCourse: Course = {
  id: "44444444-4444-4444-8444-444444444444",
  slug: "mooc-unenrolled-course",
  name: "MOOC Unenrolled Course",
  description: null,
  organization_name: ORG,
}

// ---- exercises ----

// Fixed rather than computed from the current time, so the same request is
// refused or accepted on every run and in every timezone.
const PAST_DEADLINE = "2000-01-01T00:00:00.000Z"
const FUTURE_DEADLINE = "2100-01-01T00:00:00.000Z"

/** One task of a fixture slide; its position in the array is its order number. */
interface TaskFixture {
  taskId: string
  /** Decides the public spec shape: only an editor task is downloadable and submittable. */
  type: "editor" | "browser"
  /** Defaults to `tmc`, the only slug the mock's client API can serve. */
  serviceSlug?: string
}

const makeExercise = (params: {
  baseUrl: string
  exerciseId: string
  slideId: string
  courseId: string
  tasks: TaskFixture[]
  name: string
  order: number
  archiveSlug: string
  sourceDir: string
  studentFiles: string[]
  checksum: string
  gradingOutcome?: GradingOutcome
  deadline?: string
  maxTriesPerSlide?: number
}): MoocExerciseFixture => {
  const archiveUrl = `${params.baseUrl}/mooc-archives/${params.archiveSlug}.tar.zst`
  const archiveSpec = {
    archive_name: `${params.archiveSlug}.tar.zst`,
    stub_download_url: archiveUrl,
    student_file_paths: params.studentFiles,
    checksum: params.checksum,
  }
  return {
    archiveSlug: params.archiveSlug,
    sourceDir: params.sourceDir,
    gradingOutcome: params.gradingOutcome ?? "passing",
    maxTriesPerSlide: params.maxTriesPerSlide,
    modelSolution: {
      type: "editor",
      solution_download_url: archiveUrl,
    },
    slide: {
      slide_id: params.slideId,
      exercise_id: params.exerciseId,
      course_id: params.courseId,
      exercise_name: params.name,
      exercise_order_number: params.order,
      deadline: params.deadline ?? null,
      tasks: params.tasks.map((task, orderNumber) => ({
        task_id: task.taskId,
        order_number: orderNumber,
        assignment: [],
        exercise_service_slug: task.serviceSlug ?? "tmc",
        model_solution_spec: null,
        public_spec:
          task.type === "editor"
            ? { type: "editor", ...archiveSpec }
            : {
                type: "browser",
                ...archiveSpec,
                browser_test: { runtime: "python", script: "print('hello')" },
              },
      })),
    },
  }
}

// An exercise id present in no course -- an entirely UNKNOWN id. The backend's
// get_by_id yields RecordNotFound, so this drives the 404 path (not the 422
// not-enrolled path). Also drives the bulk-download error path.
export const nonexistentExerciseId = "ffffffff-0000-4000-8000-000000000000"

// The exercise of {@link notEnrolledCourse}: a real exercise whose course the
// current user is not enrolled on, which the backend answers with 422
// `not_enrolled` -- distinct from an entirely unknown id (404 above).
export const notEnrolledExerciseId = "eeeeeeee-0000-4000-8000-000000000000"

export interface CourseWithExercises {
  course: Course
  /**
   * Whether the mock's single student is enrolled. Viewing, uploading to and
   * submitting an exercise are all gated on it before any other rule, so a
   * course with it false is the only way to reach the host's `not_enrolled`.
   */
  enrolled: boolean
  exercises: MoocExerciseFixture[]
}

export interface MoocFixtures {
  courses: CourseWithExercises[]
  /** Flat lookup by exercise id across all courses. */
  exerciseById: Map<string, MoocExerciseFixture>
  /** Archive lookup by the slug used in the stub_download_url path. */
  exerciseByArchiveSlug: Map<string, MoocExerciseFixture>
  passingExercise: MoocExerciseFixture
  failingExercise: MoocExerciseFixture
  pendingManualExercise: MoocExerciseFixture
  browserExercise: MoocExerciseFixture
  mixedTaskExercise: MoocExerciseFixture
  pastDeadlineExercise: MoocExerciseFixture
  futureDeadlineExercise: MoocExerciseFixture
  limitedTriesExercise: MoocExerciseFixture
  notClientCapableExercise: MoocExerciseFixture
  notEnrolledExercise: MoocExerciseFixture
}

/**
 * The fixture courses and exercises, with every absolute URL they carry pointing
 * back at `baseUrl` -- the address the mock serving them is reachable at. A
 * client that follows a stub or model-solution URL verbatim therefore reaches
 * the mock that handed it out rather than whatever else holds the default port.
 *
 * Ids, names and checksums do not vary with `baseUrl`, so a test may read them
 * off the {@link DEFAULT_MOOC_MOCK_BASE_URL} set exported below.
 */
export const createMoocFixtures = (baseUrl: string): MoocFixtures => {
  // Exercise A lives in pythonCourse, exercise B in extraCourse -- this makes the
  // bulk download-or-update path resolve exercise -> course by scanning ALL
  // enrolled courses' slides (there is no exercise->course API endpoint), which
  // is exactly the semantic the CLI relies on.
  // exercise_name is a slug-like, hyphenated string ("part<NN>-<rest>") so the
  // extension's course-details view groups it the same way it groups tmc
  // exercises (it splits on the first hyphen into group + exercise name). It also
  // matches the packed source directory name.
  const passingExercise = makeExercise({
    baseUrl,
    exerciseId: "a1a1a1a1-0000-4000-8000-000000000001",
    slideId: "a1a1a1a1-0000-4000-8000-000000000101",
    courseId: pythonCourse.id,
    tasks: [{ taskId: "a1a1a1a1-0000-4000-8000-000000000201", type: "editor" }],
    name: "part01-01_passing_exercise",
    order: 0,
    archiveSlug: "passing-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-passing",
  })

  const failingExercise = makeExercise({
    baseUrl,
    exerciseId: "b2b2b2b2-0000-4000-8000-000000000001",
    slideId: "b2b2b2b2-0000-4000-8000-000000000101",
    courseId: extraCourse.id,
    tasks: [{ taskId: "b2b2b2b2-0000-4000-8000-000000000201", type: "editor" }],
    name: "part01-02_failing_exercise",
    order: 0,
    archiveSlug: "failing-exercise",
    sourceDir: path.join(RESOURCES, "part01-02_failing_exercise"),
    studentFiles: ["src/failing_exercise.py"],
    checksum: "mooc-checksum-failing",
    gradingOutcome: "failing",
  })

  // A second exercise in extraCourse whose grading ends in PendingManual (awaiting
  // a human), the terminal-for-student state. Reuses the failing exercise's source
  // tree for its archive -- only its grading outcome matters here.
  const pendingManualExercise = makeExercise({
    baseUrl,
    exerciseId: "c3c3c3c3-0000-4000-8000-000000000001",
    slideId: "c3c3c3c3-0000-4000-8000-000000000101",
    courseId: extraCourse.id,
    tasks: [{ taskId: "c3c3c3c3-0000-4000-8000-000000000201", type: "editor" }],
    name: "part01-03_pending_manual_exercise",
    order: 1,
    archiveSlug: "pending-manual-exercise",
    sourceDir: path.join(RESOURCES, "part01-02_failing_exercise"),
    studentFiles: ["src/failing_exercise.py"],
    checksum: "mooc-checksum-pending-manual",
    gradingOutcome: "pendingManual",
  })

  // Answered only in the exercise service's IFrame: a native client can neither
  // download nor submit it, which is the whole of what makes
  // `editor_stub_download_url` / `editor_task_id` return None.
  const browserExercise = makeExercise({
    baseUrl,
    exerciseId: "d4d4d4d4-0000-4000-8000-000000000001",
    slideId: "d4d4d4d4-0000-4000-8000-000000000101",
    courseId: variantsCourse.id,
    tasks: [{ taskId: "d4d4d4d4-0000-4000-8000-000000000201", type: "browser" }],
    name: "part02-01_browser_exercise",
    order: 0,
    archiveSlug: "browser-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-browser",
  })

  // Two tasks the client may be served, only the second of them submittable, so
  // `TmcExerciseSlide::editor_task` has to select rather than take the first.
  const mixedTaskExercise = makeExercise({
    baseUrl,
    exerciseId: "e5e5e5e5-0000-4000-8000-000000000001",
    slideId: "e5e5e5e5-0000-4000-8000-000000000101",
    courseId: variantsCourse.id,
    tasks: [
      { taskId: "e5e5e5e5-0000-4000-8000-000000000201", type: "browser" },
      { taskId: "e5e5e5e5-0000-4000-8000-000000000202", type: "editor" },
    ],
    name: "part02-02_mixed_task_exercise",
    order: 1,
    archiveSlug: "mixed-task-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-mixed-task",
  })

  const pastDeadlineExercise = makeExercise({
    baseUrl,
    exerciseId: "f6f6f6f6-0000-4000-8000-000000000001",
    slideId: "f6f6f6f6-0000-4000-8000-000000000101",
    courseId: variantsCourse.id,
    tasks: [{ taskId: "f6f6f6f6-0000-4000-8000-000000000201", type: "editor" }],
    name: "part02-03_past_deadline_exercise",
    order: 2,
    archiveSlug: "past-deadline-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-past-deadline",
    deadline: PAST_DEADLINE,
  })

  // The other side of the deadline gate: a deadline that is set but has not
  // passed must not refuse anything.
  const futureDeadlineExercise = makeExercise({
    baseUrl,
    exerciseId: "a7a7a7a7-0000-4000-8000-000000000001",
    slideId: "a7a7a7a7-0000-4000-8000-000000000101",
    courseId: variantsCourse.id,
    tasks: [{ taskId: "a7a7a7a7-0000-4000-8000-000000000201", type: "editor" }],
    name: "part02-04_future_deadline_exercise",
    order: 3,
    archiveSlug: "future-deadline-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-future-deadline",
    deadline: FUTURE_DEADLINE,
  })

  // One try, so a second submit is refused and the model solution is revealed
  // after the first: the limit has to be exhaustible within a test rather than
  // merely declared. It grades as failing, so full points cannot be what reveals
  // the solution here.
  const limitedTriesExercise = makeExercise({
    baseUrl,
    exerciseId: "b8b8b8b8-0000-4000-8000-000000000001",
    slideId: "b8b8b8b8-0000-4000-8000-000000000101",
    courseId: variantsCourse.id,
    tasks: [{ taskId: "b8b8b8b8-0000-4000-8000-000000000201", type: "editor" }],
    name: "part02-05_limited_tries_exercise",
    order: 4,
    archiveSlug: "limited-tries-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-limited-tries",
    gradingOutcome: "failing",
    maxTriesPerSlide: 1,
  })

  // Belongs to a service that does not declare `supports_native_client`, so the
  // host hides the task from every listing and refuses a submit naming it.
  const notClientCapableExercise = makeExercise({
    baseUrl,
    exerciseId: "c9c9c9c9-0000-4000-8000-000000000001",
    slideId: "c9c9c9c9-0000-4000-8000-000000000101",
    courseId: variantsCourse.id,
    tasks: [
      { taskId: "c9c9c9c9-0000-4000-8000-000000000201", type: "editor", serviceSlug: "quizzes" },
    ],
    name: "part02-06_quiz_exercise",
    order: 5,
    archiveSlug: "quiz-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-quiz",
  })

  const notEnrolledExercise = makeExercise({
    baseUrl,
    exerciseId: notEnrolledExerciseId,
    slideId: "eeeeeeee-0000-4000-8000-000000000101",
    courseId: notEnrolledCourse.id,
    tasks: [{ taskId: "eeeeeeee-0000-4000-8000-000000000201", type: "editor" }],
    name: "part03-01_unenrolled_exercise",
    order: 0,
    archiveSlug: "unenrolled-exercise",
    sourceDir: path.join(RESOURCES, "part01-01_passing_exercise"),
    studentFiles: ["src/passing_exercise.py"],
    checksum: "mooc-checksum-unenrolled",
  })

  const courses: CourseWithExercises[] = [
    { course: pythonCourse, enrolled: true, exercises: [passingExercise] },
    { course: extraCourse, enrolled: true, exercises: [failingExercise, pendingManualExercise] },
    {
      course: variantsCourse,
      enrolled: true,
      exercises: [
        browserExercise,
        mixedTaskExercise,
        pastDeadlineExercise,
        futureDeadlineExercise,
        limitedTriesExercise,
        notClientCapableExercise,
      ],
    },
    { course: notEnrolledCourse, enrolled: false, exercises: [notEnrolledExercise] },
  ]

  const exerciseById = new Map<string, MoocExerciseFixture>()
  const exerciseByArchiveSlug = new Map<string, MoocExerciseFixture>()
  for (const { exercises } of courses) {
    for (const exercise of exercises) {
      exerciseById.set(exercise.slide.exercise_id, exercise)
      exerciseByArchiveSlug.set(exercise.archiveSlug, exercise)
    }
  }

  return {
    courses,
    exerciseById,
    exerciseByArchiveSlug,
    passingExercise,
    failingExercise,
    pendingManualExercise,
    browserExercise,
    mixedTaskExercise,
    pastDeadlineExercise,
    futureDeadlineExercise,
    limitedTriesExercise,
    notClientCapableExercise,
    notEnrolledExercise,
  }
}

// The default-address fixture set, for readers that only need ids and names.
export const {
  courses,
  exerciseById,
  exerciseByArchiveSlug,
  passingExercise,
  failingExercise,
  pendingManualExercise,
  browserExercise,
  mixedTaskExercise,
  pastDeadlineExercise,
  futureDeadlineExercise,
  limitedTriesExercise,
  notClientCapableExercise,
  notEnrolledExercise,
} = createMoocFixtures(DEFAULT_MOOC_MOCK_BASE_URL)

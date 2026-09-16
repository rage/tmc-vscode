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
// CONTENT here must be a valid editor PublicSpec (type/archive_name/
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
  exercise_service_slug: string
  public_spec: EditorPublicSpec
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
  /** Served by `GET exercises/{id}` once this exercise has been solved for full points. */
  modelSolution: ModelSolutionSpec
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

// ---- exercises ----

const makeExercise = (params: {
  baseUrl: string
  exerciseId: string
  slideId: string
  courseId: string
  taskId: string
  name: string
  order: number
  archiveSlug: string
  sourceDir: string
  studentFiles: string[]
  checksum: string
  gradingOutcome?: GradingOutcome
}): MoocExerciseFixture => {
  const archiveUrl = `${params.baseUrl}/mooc-archives/${params.archiveSlug}.tar.zst`
  return {
    archiveSlug: params.archiveSlug,
    sourceDir: params.sourceDir,
    gradingOutcome: params.gradingOutcome ?? "passing",
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
      deadline: null,
      tasks: [
        {
          task_id: params.taskId,
          order_number: 0,
          assignment: [],
          exercise_service_slug: "tmc",
          model_solution_spec: null,
          public_spec: {
            type: "editor",
            archive_name: `${params.archiveSlug}.tar.zst`,
            stub_download_url: archiveUrl,
            student_file_paths: params.studentFiles,
            checksum: params.checksum,
          },
        },
      ],
    },
  }
}

// An exercise id present in no course -- an entirely UNKNOWN id. The backend's
// get_by_id yields RecordNotFound, so this drives the 404 path (not the 422
// not-enrolled path). Also drives the bulk-download error path.
export const nonexistentExerciseId = "ffffffff-0000-4000-8000-000000000000"

// An exercise id that resolves to a real exercise whose course the current user
// is NOT enrolled in. The backend returns 422 with message_key `not_enrolled`
// for this case -- distinct from an entirely unknown id (404 above). Present in
// no course listing; the mock recognises this id explicitly so the 422
// not-enrolled contract stays exercised after unknown ids moved to 404.
export const notEnrolledExerciseId = "eeeeeeee-0000-4000-8000-000000000000"

export interface CourseWithExercises {
  course: Course
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
    taskId: "a1a1a1a1-0000-4000-8000-000000000201",
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
    taskId: "b2b2b2b2-0000-4000-8000-000000000201",
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
    taskId: "c3c3c3c3-0000-4000-8000-000000000201",
    name: "part01-03_pending_manual_exercise",
    order: 1,
    archiveSlug: "pending-manual-exercise",
    sourceDir: path.join(RESOURCES, "part01-02_failing_exercise"),
    studentFiles: ["src/failing_exercise.py"],
    checksum: "mooc-checksum-pending-manual",
    gradingOutcome: "pendingManual",
  })

  const courses: CourseWithExercises[] = [
    { course: pythonCourse, exercises: [passingExercise] },
    { course: extraCourse, exercises: [failingExercise, pendingManualExercise] },
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
} = createMoocFixtures(DEFAULT_MOOC_MOCK_BASE_URL)

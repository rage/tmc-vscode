// Representative tmc-langs-cli stdout messages for the langs contract test
// (src/test/langsSchema.test.ts). Shapes follow the generated contract
// artifacts in tmc-langs-rust (bindings.schema.json / bindings.d.ts); see
// shared/langsSchema.ts for the conventions.

const UUID_A = "018f6f9b-1c2d-7e3f-8a4b-5c6d7e8f9a0b"
const UUID_B = "550e8400-e29b-41d4-a716-446655440000"
const UUID_C = "67e55044-10b1-426f-9247-bb680e5fe0c8"

interface CliOutputFixture {
  name: string
  value: unknown
}

/** Wraps an output-data payload into a full CliOutput message. */
function outputData(kind: string, data: unknown): unknown {
  return {
    "output-kind": "output-data",
    status: "finished",
    message: "Executed command successfully",
    result: "executed-command",
    data: { "output-data-kind": kind, "output-data": data },
  }
}

const course = {
  id: 590,
  name: "mooc-java-programming-i",
  title: "Java Programming I",
  description: "Introduction to programming.",
  details_url: "https://tmc.mooc.fi/api/v8/core/courses/590",
  unlock_url: "https://tmc.mooc.fi/api/v8/core/courses/590/unlock",
  reviews_url: "https://tmc.mooc.fi/api/v8/core/courses/590/reviews",
  comet_url: "",
  spyware_urls: ["http://spyware.testmycode.net/"],
}

const exercise = {
  id: 83114,
  name: "part01-Part01_01.Sandbox",
  locked: false,
  deadline_description: "2026-08-19 23:59:59 +0300",
  deadline: "2026-08-19T23:59:59.999+03:00",
  soft_deadline: null,
  soft_deadline_description: null,
  checksum: "f25e139769b2688e213938bf85d09fb8",
  return_url: "https://tmc.mooc.fi/api/v8/core/exercises/83114/submissions",
  zip_url: "https://tmc.mooc.fi/api/v8/core/exercises/83114/download",
  returnable: true,
  requires_review: false,
  attempted: false,
  completed: false,
  reviewed: false,
  all_review_points_given: true,
  memory_limit: null,
  runtime_params: ["-Xss64M"],
  valgrind_strategy: "fail",
  code_review_requests_enabled: false,
  run_tests_locally_action_enabled: true,
  latest_submission_url: null,
  latest_submission_id: null,
  solution_zip_url: null,
}

// Flattened — see the CourseDetails serialize-contract note in langsSchema.test.ts
const courseDetails = {
  ...course,
  unlockables: [],
  exercises: [exercise],
}

const courseExercise = {
  id: 83114,
  available_points: [{ id: 954510, exercise_id: 83114, name: "01-01", requires_review: false }],
  awarded_points: [],
  name: "part01-Part01_01.Sandbox",
  publish_time: null,
  solution_visible_after: null,
  deadline: "2026-08-19T23:59:59.999+03:00",
  soft_deadline: null,
  disabled: false,
  unlocked: true,
}

const courseData = {
  name: "mooc-java-programming-i",
  hide_after: null,
  hidden: false,
  cache_version: 51,
  spreadsheet_key: null,
  hidden_if_registered_after: null,
  refreshed_at: "2026-07-01T14:53:44.892+03:00",
  locked_exercise_points_visible: true,
  description: "Introduction to programming.",
  paste_visibility: null,
  formal_name: null,
  certificate_downloadable: false,
  certificate_unlock_spec: null,
  organization_id: 21,
  disabled_status: "enabled",
  title: "Java Programming I",
  material_url: "",
  course_template_id: 100,
  hide_submission_results: false,
  external_scoreboard_url: null,
  organization_slug: "mooc",
}

const exerciseSubmission = {
  exercise_name: "part01-Part01_01.Sandbox",
  id: 7402793,
  user_id: 131421,
  course_id: 590,
  created_at: "2026-07-13T09:12:33.123+03:00",
  all_tests_passed: true,
  points: "01-01",
  submitted_zip_url: "https://tmc.mooc.fi/api/v8/core/submissions/7402793/download",
  paste_url: null,
  processing_time: 25,
  reviewed: false,
  requests_review: false,
}

const submission = {
  id: 7402793,
  user_id: 131421,
  pretest_error: null,
  created_at: "2026-07-13T09:12:33.123+03:00",
  exercise_name: "part01-Part01_01.Sandbox",
  course_id: 590,
  processed: true,
  all_tests_passed: true,
  points: "01-01",
  processing_tried_at: "2026-07-13T09:12:33.456+03:00",
  processing_began_at: "2026-07-13T09:12:34.001+03:00",
  processing_completed_at: "2026-07-13T09:12:58.999+03:00",
  times_sent_to_sandbox: 1,
  processing_attempts_started_at: "2026-07-13T09:12:33.123+03:00",
  params_json: null,
  requires_review: false,
  requests_review: false,
  reviewed: false,
  message_for_reviewer: "",
  newer_submission_reviewed: false,
  review_dismissed: false,
  paste_available: false,
  message_for_paste: "",
  paste_key: null,
}

const organization = {
  name: "MOOC",
  information: "Massive Open Online Courses from the University of Helsinki",
  slug: "mooc",
  logo_path: "/system/organizations/logos/000/000/021/original/mooc-logo.png",
  pinned: true,
}

const review = {
  submission_id: 7402793,
  exercise_name: "part01-Part01_01.Sandbox",
  id: 12,
  marked_as_read: false,
  reviewer_name: "Reviewer",
  review_body: "Looks good",
  points: ["01-01"],
  points_not_awarded: [],
  url: "https://tmc.mooc.fi/submissions/7402793/reviews",
  update_url: "https://tmc.mooc.fi/api/v8/core/courses/590/reviews/12",
  created_at: "2026-07-14T10:00:00.000+03:00",
  updated_at: "2026-07-14T10:00:00.000+03:00",
}

const newSubmission = {
  show_submission_url: "https://tmc.mooc.fi/api/v8/core/submissions/7402793",
  paste_url: "https://tmc.mooc.fi/paste/8VVBEYCqjB9U9M8M",
  submission_url: "https://tmc.mooc.fi/submissions/7402793",
}

const submissionFinished = {
  api_version: 7,
  all_tests_passed: true,
  user_id: 131421,
  login: "student@example.com",
  course: "mooc-java-programming-i",
  exercise_name: "part01-Part01_01.Sandbox",
  status: "ok",
  points: ["01-01"],
  valgrind: null,
  submission_url: "https://tmc.mooc.fi/submissions/7402793",
  solution_url: "https://tmc.mooc.fi/exercises/83114/solution",
  submitted_at: "2026-07-13T09:12:33.123+03:00",
  processing_time: 25,
  reviewed: false,
  requests_review: false,
  paste_url: null,
  message_for_paste: null,
  missing_review_points: [],
  test_cases: [
    {
      name: "SandboxTest test",
      successful: true,
      message: null,
      exception: null,
      detailed_message: null,
    },
  ],
  feedback_questions: [
    { id: 1, question: "How difficult was this?", kind: { IntRange: { lower: 1, upper: 5 } } },
    { id: 2, question: "Free feedback", kind: "Text" },
  ],
  feedback_answer_url: "https://tmc.mooc.fi/api/v8/core/submissions/7402793/feedback",
  error: null,
  validations: {
    strategy: "WARN",
    validationErrors: {
      "Sandbox.java": [
        {
          column: 1,
          line: 5,
          message: "Indentation incorrect.",
          sourceName: "Sandbox.java",
        },
      ],
    },
  },
}

const moocCourse = {
  id: UUID_A,
  slug: "introduction-to-everything",
  name: "Introduction to Everything",
  description: "An example course.",
  organization_name: "University of Helsinki",
}

const moocExerciseSlide = {
  slide_id: UUID_A,
  exercise_id: UUID_B,
  course_id: UUID_A,
  exercise_name: "Best exercise",
  exercise_order_number: 1,
  deadline: "2026-08-19T23:59:59.999999Z",
  tasks: [
    {
      task_id: UUID_C,
      order_number: 0,
      assignment: { type: "doc", content: [] },
      public_spec: {
        type: "editor",
        archive_name: "part01.tar.zst",
        stub_download_url: "https://courses.mooc.fi/api/v0/files/stub.tar.zst",
        student_file_paths: ["src/main.rs"],
        checksum: "1234abcd",
        browser_test: { runtime: "python", script: "print('hello')", error: null },
      },
      model_solution_spec: {
        type: "Editor",
        download_url: "https://courses.mooc.fi/api/v0/files/solution.tar.zst",
      },
      checksum: "1234abcd",
    },
    {
      task_id: UUID_B,
      order_number: 1,
      assignment: null,
      public_spec: null,
      model_solution_spec: {
        type: "Browser",
        solution_files: [{ filepath: "src/main.rs", contents: "fn main() {}" }],
      },
      checksum: null,
    },
  ],
}

const validCliOutputFixtures: CliOutputFixture[] = [
  // envelope kinds
  {
    name: "status-update: client-update-data / exercise-download",
    value: {
      "output-kind": "status-update",
      "update-data-kind": "client-update-data",
      finished: false,
      message: "Downloading exercise",
      "percent-done": 0.5,
      time: 1234,
      data: {
        "client-update-data-kind": "exercise-download",
        id: 83114,
        path: "/home/student/tmcdata/course/part01",
      },
    },
  },
  {
    name: "status-update: client-update-data / posted-submission",
    value: {
      "output-kind": "status-update",
      "update-data-kind": "client-update-data",
      finished: false,
      message: "Posted submission",
      "percent-done": 0.5,
      time: 5000,
      data: {
        "client-update-data-kind": "posted-submission",
        ...newSubmission,
      },
    },
  },
  {
    name: "status-update: none",
    value: {
      "output-kind": "status-update",
      "update-data-kind": "none",
      finished: true,
      message: "Finished",
      "percent-done": 1.0,
      time: 8000,
      data: null,
    },
  },
  {
    name: "notification",
    value: {
      "output-kind": "notification",
      "notification-kind": "warning",
      message: "Your Python version is outdated",
    },
  },
  {
    name: "output-data with null data",
    value: {
      "output-kind": "output-data",
      status: "finished",
      message: "Logged in",
      result: "logged-in",
      data: null,
    },
  },
  // error kinds
  {
    name: "error: generic",
    value: {
      "output-kind": "output-data",
      status: "finished",
      message: "Something went wrong",
      result: "error",
      data: {
        "output-data-kind": "error",
        "output-data": { kind: "generic", trace: ["error", "caused by: io error"] },
      },
    },
  },
  {
    name: "error: failed-exercise-download",
    value: {
      "output-kind": "output-data",
      status: "finished",
      message: "Failed to download exercises",
      result: "error",
      data: {
        "output-data-kind": "error",
        "output-data": {
          kind: {
            "failed-exercise-download": {
              completed: [
                {
                  id: 1,
                  "course-slug": "course",
                  "exercise-slug": "ex1",
                  path: "/p/ex1",
                },
              ],
              skipped: [],
              failed: [
                [
                  {
                    id: 2,
                    "course-slug": "course",
                    "exercise-slug": "ex2",
                    path: "/p/ex2",
                  },
                  ["download failed"],
                ],
              ],
            },
          },
          trace: ["error"],
        },
      },
    },
  },
  // one fixture per remaining DataKind variant
  {
    name: "validation (result)",
    value: outputData("validation", {
      strategy: "WARN",
      validation_errors: {
        "Sandbox.java": [
          {
            column: 1,
            line: 5,
            message: "Indentation incorrect.",
            source_name: "Sandbox.java",
          },
        ],
      },
    }),
  },
  { name: "validation (null)", value: outputData("validation", null) },
  { name: "available-points", value: outputData("available-points", ["01-01", "01-02"]) },
  { name: "exercises", value: outputData("exercises", ["/path/to/exercise"]) },
  {
    name: "exercise-packaging-configuration",
    value: outputData("exercise-packaging-configuration", {
      student_file_paths: ["src"],
      exercise_file_paths: ["test", "pom.xml"],
    }),
  },
  {
    name: "refresh-result",
    value: outputData("refresh-result", {
      "new-cache-path": "/cache/course",
      "course-options": { hide_after: null },
      exercises: [
        {
          name: "part01-Part01_01.Sandbox",
          checksum: "f25e139769b2688e213938bf85d09fb8",
          points: ["01-01"],
          "sandbox-image": "eu.gcr.io/moocfi-public/tmc-sandbox-java",
          "tmcproject-yml": {
            extra_student_files: [],
            extra_exercise_files: [],
            force_update: [],
          },
        },
      ],
    }),
  },
  {
    name: "test-result",
    value: outputData("test-result", {
      status: "TESTS_FAILED",
      testResults: [
        {
          name: "SandboxTest test",
          successful: false,
          points: ["01-01"],
          message: "expected 3 but was 4",
          exception: ["java.lang.AssertionError"],
        },
      ],
      logs: { stdout: "..." },
    }),
  },
  {
    name: "exercise-desc",
    value: outputData("exercise-desc", {
      name: "Part01_01.Sandbox",
      tests: [{ name: "SandboxTest test", points: ["01-01"] }],
    }),
  },
  { name: "updated-exercises", value: outputData("updated-exercises", [{ id: 83114 }]) },
  {
    name: "combined-course-data",
    value: outputData("combined-course-data", {
      details: courseDetails,
      exercises: [courseExercise],
      settings: courseData,
    }),
  },
  { name: "course-details", value: outputData("course-details", courseDetails) },
  { name: "course-exercises", value: outputData("course-exercises", [courseExercise]) },
  { name: "course-data", value: outputData("course-data", courseData) },
  { name: "courses", value: outputData("courses", [course]) },
  {
    name: "exercise-details",
    value: outputData("exercise-details", {
      course_name: "mooc-java-programming-i",
      course_id: 590,
      code_review_requests_enabled: false,
      run_tests_locally_action_enabled: true,
      exercise_name: "part01-Part01_01.Sandbox",
      exercise_id: 83114,
      unlocked_at: null,
      deadline: "2026-08-19T23:59:59.999+03:00",
      submissions: [exerciseSubmission],
    }),
  },
  { name: "submissions", value: outputData("submissions", [submission]) },
  {
    name: "update-result",
    value: outputData("update-result", { created: [exercise], updated: [] }),
  },
  { name: "organization", value: outputData("organization", organization) },
  { name: "organizations", value: outputData("organizations", [organization]) },
  { name: "reviews", value: outputData("reviews", [review]) },
  {
    name: "token",
    value: outputData("token", {
      access_token: "abcdef",
      token_type: "bearer",
      scope: "public",
    }),
  },
  { name: "new-submission", value: outputData("new-submission", newSubmission) },
  {
    name: "submission-feedback-response",
    value: outputData("submission-feedback-response", { api_version: 8, status: "ok" }),
  },
  {
    name: "submission-finished",
    value: outputData("submission-finished", submissionFinished),
  },
  { name: "config-value (string)", value: outputData("config-value", "/projects/dir") },
  { name: "config-value (null)", value: outputData("config-value", null) },
  {
    name: "compressed-project-hash",
    value: outputData("compressed-project-hash", "9f86d081884c7d659a2feaa0c55ad015"),
  },
  {
    name: "submission-sandbox",
    value: outputData("submission-sandbox", "https://sandbox.example.com/1"),
  },
  {
    name: "local-tmc-exercises",
    value: outputData("local-tmc-exercises", [
      { "exercise-slug": "part01-Part01_01.Sandbox", "exercise-path": "/p/ex" },
    ]),
  },
  {
    name: "local-mooc-exercises",
    value: outputData("local-mooc-exercises", [
      { "exercise-slug": "mooc-ex", "exercise-id": UUID_B, "exercise-path": "/p/mooc-ex" },
    ]),
  },
  {
    name: "tmc-exercise-download",
    value: outputData("tmc-exercise-download", {
      downloaded: [{ id: 1, "course-slug": "course", "exercise-slug": "ex1", path: "/p/ex1" }],
      skipped: [],
      failed: [
        [
          { id: 2, "course-slug": "course", "exercise-slug": "ex2", path: "/p/ex2" },
          ["download failed"],
        ],
      ],
    }),
  },
  {
    name: "mooc-exercise-download",
    value: outputData("mooc-exercise-download", {
      downloaded: [{ "exercise-id": UUID_C, path: "/p/mooc-ex" }],
      skipped: [{ "exercise-id": UUID_B, path: "/p/mooc-ex2" }],
    }),
  },
  { name: "tmc-config", value: outputData("tmc-config", { projects_dir: "/projects" }) },
  {
    name: "mooc-updated-exercises",
    value: outputData("mooc-updated-exercises", [UUID_B, UUID_C]),
  },
  { name: "mooc-course", value: outputData("mooc-course", moocCourse) },
  { name: "mooc-courses", value: outputData("mooc-courses", [moocCourse]) },
  {
    name: "mooc-exercise-slides",
    value: outputData("mooc-exercise-slides", [moocExerciseSlide]),
  },
  { name: "mooc-exercise-slide", value: outputData("mooc-exercise-slide", moocExerciseSlide) },
  {
    name: "mooc-submission-finished",
    value: outputData("mooc-submission-finished", { submission_id: UUID_A }),
  },
  // forward compatibility: unknown extra fields must not fail validation
  {
    name: "unknown extra field is tolerated",
    value: {
      "output-kind": "notification",
      "notification-kind": "info",
      message: "hello",
      "added-in-a-future-version": { x: 1 },
    },
  },
]

const invalidCliOutputFixtures: CliOutputFixture[] = [
  { name: "not an object", value: "finished" },
  {
    name: "missing output-kind",
    value: { status: "finished", message: "m", result: "executed-command", data: null },
  },
  {
    name: "unknown output-kind",
    value: { "output-kind": "surprise", message: "m" },
  },
  {
    name: "unknown output-data-kind",
    value: outputData("mooc-course-instances", []),
  },
  {
    name: "error trace with non-string elements",
    value: {
      "output-kind": "output-data",
      status: "finished",
      message: "m",
      result: "error",
      data: {
        "output-data-kind": "error",
        "output-data": { kind: "generic", trace: [42] },
      },
    },
  },
  {
    name: "tmc course with string id",
    value: outputData("courses", [{ ...course, id: "590" }]),
  },
  {
    name: "mooc course with non-uuid id",
    value: outputData("mooc-courses", [{ ...moocCourse, id: 590 }]),
  },
  {
    name: "status-update none with object data",
    value: {
      "output-kind": "status-update",
      "update-data-kind": "none",
      finished: true,
      message: "m",
      "percent-done": 1.0,
      time: 1,
      data: { unexpected: true },
    },
  },
  {
    name: "notification with invalid notification-kind",
    value: { "output-kind": "notification", "notification-kind": "fatal", message: "m" },
  },
  {
    name: "output-data with missing result",
    value: {
      "output-kind": "output-data",
      status: "finished",
      message: "m",
      data: null,
    },
  },
]

export type { CliOutputFixture }
export { invalidCliOutputFixtures, validCliOutputFixtures }

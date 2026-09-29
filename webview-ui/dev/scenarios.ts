import type { SubmissionFinished } from "../src/shared/langsSchema"
import type {
  CourseDetailsPanel,
  ExerciseGroup,
  ExerciseTestsPanel,
  ExtensionToWebview,
  Panel,
  WebviewToExtension,
} from "../src/shared/shared"
import { makeMoocKind, makeTmcKind } from "../src/shared/shared"
import {
  MOOC_INSTANCE_ID,
  moocExerciseGroup,
  moocLocalCourse,
  moocLocalExercise,
  testResult,
  testResultData,
  tmcLocalCourse,
  tmcLocalExercise,
} from "../src/test/fixtures"

/** One screen in one state, reproduced by answering the panel the way the extension host would. */
export interface Scenario {
  /** Stable key for URLs and test titles, `<panel>/<state>`. */
  id: string
  panel: Panel
  /** The host's answer to a message the webview posts; `ready` is answered with `panel`. */
  reply?: (message: WebviewToExtension) => ExtensionToWebview[]
  /** Posted once the panel is on screen, the way a running operation reports its progress. */
  pushes?: ExtensionToWebview[]
}

const tmcCourse = tmcLocalCourse({
  title: "Python Programming 2026",
  exercises: Array.from({ length: 6 }, (_, index) => ({
    id: 101 + index,
    availablePoints: 2,
    awardedPoints: index < 2 ? 2 : 0,
    name: `part01-0${index + 1}_exercise`,
    deadline: null,
    passed: index < 2,
    softDeadline: null,
  })),
  availablePoints: 12,
  awardedPoints: 4,
})
const moocCourse = moocLocalCourse({ newExercises: [] })

function groupExercise(index: number, passed: boolean): ExerciseGroup["exercises"][number] {
  return {
    id: makeTmcKind({ tmcExerciseId: 101 + index }),
    name: `part0${Math.floor(index / 3) + 1}-0${(index % 3) + 1}_exercise`,
    isHard: index % 2 === 0,
    hardDeadlineString: "Deadline: 31.12.2026 23:59",
    softDeadlineString: "Soft deadline: 24.12.2026 23:59",
    deadlineIso: "2026-12-31T23:59:00Z",
    passed,
  }
}

function tmcGroups(): ExerciseGroup[] {
  return [
    {
      name: "part01",
      nextDeadlineString: "Next deadline: 31.12.2026 23:59",
      defaultOpen: true,
      exercises: [groupExercise(0, true), groupExercise(1, true), groupExercise(2, false)],
    },
    {
      name: "part02",
      nextDeadlineString: "Next deadline: 31.12.2026 23:59",
      defaultOpen: false,
      exercises: [groupExercise(3, false), groupExercise(4, false), groupExercise(5, false)],
    },
  ]
}

function courseDetailsPanel(id: number, courseId: CourseDetailsPanel["courseId"]): Panel {
  return { id, type: "CourseDetails", courseId, exerciseStatuses: { tmc: {}, mooc: {} } }
}

function answerCourseDetails(
  panel: { id: number },
  course: typeof tmcCourse,
  groups: ExerciseGroup[],
  statuses: Extract<ExtensionToWebview, { type: "setExerciseStatuses" }>["statuses"],
) {
  return (message: WebviewToExtension): ExtensionToWebview[] => {
    if (message.type !== "requestCourseDetailsData") {
      return []
    }
    const target = { type: "CourseDetails" as const, id: panel.id }
    return [
      { type: "setCourseData", target, courseData: course },
      { type: "setCourseGroups", target, offlineMode: false, exerciseGroups: groups },
      {
        type: "setExerciseStatuses",
        target: { type: "CourseDetails" },
        courseId: message.sourcePanel.courseId,
        statuses,
      },
      { type: "reply", target, requestId: message.requestId, outcome: { ok: true } },
    ]
  }
}

function answerMyCourses(courses: (typeof tmcCourse)[]) {
  return (message: WebviewToExtension): ExtensionToWebview[] => {
    if (message.type !== "requestMyCoursesData") {
      return []
    }
    const target = { type: "MyCourses" as const, id: message.sourcePanel.id }
    return [
      { type: "setMyCourses", target, courses },
      { type: "setTmcDataPath", target, tmcDataPath: "/home/student/tmcdata" },
      { type: "setTmcDataSize", target, tmcDataSize: "12.3 MB" },
      { type: "reply", target, requestId: message.requestId, outcome: { ok: true } },
    ]
  }
}

const testsPanel: ExerciseTestsPanel = {
  id: 20,
  type: "ExerciseTests",
  course: tmcCourse,
  exercise: tmcLocalExercise({ id: 103, name: "part01-03_exercise", availablePoints: 2 }),
  // The host's `Uri`; the webview never reads it.
  exerciseUri: {} as ExerciseTestsPanel["exerciseUri"],
  testRunId: 1,
}
const testsTarget = { type: "ExerciseTests" as const, id: testsPanel.id }

const submissionPanel = {
  id: 30,
  type: "ExerciseSubmission" as const,
  course: tmcCourse,
  exercise: tmcLocalExercise({ id: 103, name: "part01-03_exercise", availablePoints: 2 }),
}
const submissionTarget = { type: "ExerciseSubmission" as const, id: submissionPanel.id }

function submissionFinished(overrides: Partial<SubmissionFinished>): SubmissionFinished {
  return {
    api_version: 7,
    all_tests_passed: true,
    user_id: 1,
    login: "student",
    course: "python-course",
    exercise_name: "part01-03_exercise",
    status: "ok",
    points: ["1.3"],
    valgrind: null,
    submission_url: "https://tmc.mooc.fi/submissions/1",
    solution_url: "https://tmc.mooc.fi/solutions/1",
    submitted_at: "2026-09-29T12:00:00Z",
    processing_time: 3,
    reviewed: false,
    requests_review: false,
    paste_url: null,
    message_for_paste: null,
    missing_review_points: [],
    test_cases: [
      { name: "test_sum", successful: true, message: null, detailed_message: null, exception: [] },
    ],
    feedback_questions: null,
    feedback_answer_url: null,
    error: null,
    validations: null,
    ...overrides,
  }
}

const statusUpdates = (fractions: [number, string][]): ExtensionToWebview[] =>
  fractions.map(([fraction, message]) => ({
    type: "submissionStatusUpdate",
    target: submissionTarget,
    fraction,
    message,
  }))

/** Every scenario the dev harness offers and the accessibility tests walk through. */
export const SCENARIOS: Scenario[] = [
  {
    id: "welcome/logged-out",
    panel: { id: 1, type: "Welcome", version: "3.5.3", loggedIn: false },
  },
  { id: "welcome/logged-in", panel: { id: 1, type: "Welcome", version: "3.5.3", loggedIn: true } },
  {
    id: "my-courses/two-courses",
    panel: { id: 2, type: "MyCourses" },
    reply: answerMyCourses([tmcCourse, moocCourse]),
  },
  { id: "my-courses/empty", panel: { id: 2, type: "MyCourses" }, reply: answerMyCourses([]) },
  {
    id: "course-details/tmc",
    panel: courseDetailsPanel(3, makeTmcKind({ courseId: 42 })),
    reply: answerCourseDetails({ id: 3 }, tmcCourse, tmcGroups(), [
      [makeTmcKind({ tmcExerciseId: 101 }), "opened"],
      [makeTmcKind({ tmcExerciseId: 102 }), "closed"],
      [makeTmcKind({ tmcExerciseId: 103 }), "missing"],
      [makeTmcKind({ tmcExerciseId: 104 }), "downloading"],
      [makeTmcKind({ tmcExerciseId: 105 }), "downloadFailed"],
      [makeTmcKind({ tmcExerciseId: 106 }), "expired"],
    ]),
  },
  {
    id: "course-details/mooc",
    panel: courseDetailsPanel(4, makeMoocKind({ instanceId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 4 }, moocCourse, [moocExerciseGroup()], []),
  },
  // Never answered, so the panel shows its loading state until the request times out.
  { id: "course-details/loading", panel: courseDetailsPanel(5, makeTmcKind({ courseId: 42 })) },
  { id: "exercise-tests/running", panel: testsPanel },
  {
    id: "exercise-tests/passed",
    panel: testsPanel,
    pushes: [{ type: "testResults", target: testsTarget, testResults: testResultData() }],
  },
  {
    id: "exercise-tests/failed",
    panel: testsPanel,
    pushes: [
      {
        type: "testResults",
        target: testsTarget,
        testResults: testResultData({
          testResult: {
            logs: { stdout: "Hello\n" },
            status: "TESTS_FAILED",
            testResults: [
              testResult({ name: "test_prints_hello" }),
              testResult({
                name: "test_sum",
                successful: false,
                message: "Expected 3 but got 2",
                exception: ["Traceback (most recent call last):", '  File "test.py", line 4'],
              }),
            ],
          },
          styleValidationResult: {
            strategy: "WARN",
            validation_errors: {
              "src/main.py": [
                { column: 1, line: 3, message: "Missing docstring", source_name: "pylint" },
              ],
            },
          },
        }),
      },
    ],
  },
  {
    id: "exercise-tests/error",
    panel: testsPanel,
    pushes: [
      {
        type: "testError",
        target: testsTarget,
        error: { message: "Running the tests failed", details: "python3: not found" },
      },
    ],
  },
  {
    id: "exercise-submission/processing",
    panel: submissionPanel,
    pushes: [
      {
        type: "submissionStatusUrl",
        target: submissionTarget,
        url: "https://tmc.mooc.fi/submissions/1",
      },
      ...statusUpdates([
        [0.1, "Submission received"],
        [0.4, "Waiting in queue"],
      ]),
    ],
  },
  {
    id: "exercise-submission/tmc-passed",
    panel: submissionPanel,
    pushes: [
      ...statusUpdates([
        [0.5, "Submission received"],
        [1, "Testing finished"],
      ]),
      {
        type: "submissionResult",
        target: submissionTarget,
        result: submissionFinished({
          feedback_answer_url: "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback",
        }),
        questions: [
          { id: 1, kind: "intrange", lower: 1, upper: 5, question: "How difficult was this?" },
          { id: 2, kind: "text", question: "Anything else?" },
        ],
      },
    ],
  },
  {
    id: "exercise-submission/tmc-failed",
    panel: submissionPanel,
    pushes: [
      {
        type: "submissionResult",
        target: submissionTarget,
        result: submissionFinished({
          all_tests_passed: false,
          status: "fail",
          points: [],
          test_cases: [
            {
              name: "test_sum",
              successful: false,
              message: "Expected 3 but got 2",
              detailed_message: null,
              exception: ["AssertionError"],
            },
          ],
        }),
        questions: [],
      },
    ],
  },
  {
    id: "exercise-submission/mooc-graded",
    panel: {
      id: 31,
      type: "ExerciseSubmission",
      course: moocCourse,
      exercise: moocLocalExercise(),
    },
    pushes: [
      {
        type: "moocSubmissionResult",
        target: { type: "ExerciseSubmission", id: 31 },
        result: {
          status: "grading",
          grading: {
            grading_progress: "FullyGraded",
            score_given: 2.5,
            grading_started_at: "2026-09-29T12:00:00Z",
            grading_completed_at: "2026-09-29T12:00:05Z",
            feedback_text: "Well done!",
          },
        },
      },
    ],
  },
  {
    id: "exercise-submission/error",
    panel: submissionPanel,
    pushes: [
      {
        type: "submissionStatusError",
        target: submissionTarget,
        error: { message: "Submitting failed", details: "The server returned 500" },
      },
    ],
  },
  {
    id: "mooc-login/awaiting",
    panel: { id: 40, type: "MoocLogin" },
    reply: (message) =>
      message.type === "moocLogin"
        ? [
            {
              type: "moocDeviceCode",
              target: { type: "MoocLogin", id: 40 },
              userCode: "WDJB-MJHT",
              verificationUri: "https://courses.mooc.fi/device",
              verificationUriComplete: "https://courses.mooc.fi/device?user_code=WDJB-MJHT",
              expiresIn: 900,
              interval: 5,
            },
          ]
        : [],
  },
  {
    id: "mooc-login/error",
    panel: { id: 41, type: "MoocLogin" },
    reply: (message) =>
      message.type === "moocLogin"
        ? [
            {
              type: "reply",
              target: { type: "MoocLogin", id: 41 },
              requestId: message.requestId,
              outcome: { ok: false, error: { message: "the sign-in code expired." } },
            },
          ]
        : [],
  },
  {
    id: "initialization-error-help/errors",
    panel: { id: 50, type: "InitializationErrorHelp" },
    reply: (message) =>
      message.type === "requestInitializationErrors"
        ? [
            {
              type: "reply",
              target: { type: "InitializationErrorHelp", id: 50 },
              requestId: message.requestId,
              outcome: {
                ok: true,
                value: {
                  cliFolder: "/home/student/.local/share/tmc/cli",
                  initializationErrors: {
                    tmc: {
                      error: "Failed to download the TMC-langs CLI",
                      stack: "Error: ENOTFOUND",
                    },
                    userData: null,
                    workspaceManager: null,
                    exerciseDecorationProvider: null,
                    resources: null,
                  },
                },
              },
            },
          ]
        : [],
  },
]

/** The scenario with `id`, or the first one, so a stale link still opens something. */
export function findScenario(id: string | null): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? (SCENARIOS[0] as Scenario)
}

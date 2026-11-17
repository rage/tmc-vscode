import type { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../../shared/langsSchema"
import type {
  AddCoursePanel,
  CatalogCourse,
  CourseDetailsPanel,
  CourseHomeExercise,
  CourseHomeView,
  DeadlineText,
  ExerciseSection,
  ExtensionToWebview,
  LoginPanel,
  LoginView,
  MoocCatalog,
  Panel,
  RequestType,
  SubmissionHistoryEntry,
  TmcOrganizations,
  WebviewState,
  WebviewToExtension,
} from "../../shared/lib"
import {
  makeMoocKind,
  makeTmcKind,
  SUBMIT_REFUSAL_LABELS,
  submitRefusalSentence,
} from "../../shared/lib"
import {
  inProgressView,
  moocGradingView,
  standingView,
  submitFailedView,
  testedLocallyView,
  tmcResultView,
} from "../../src/panels/submissionView"
import {
  courseHomeExercise,
  courseHomeView,
  MOOC_INSTANCE_ID,
  moocGrading as baseMoocGrading,
  submissionFinished as baseSubmissionFinished,
  submissionViewMessage,
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
  /** What VS Code hands the document as saved, as after the student left it in this state. */
  savedState?: WebviewState
}

function deadline(
  at: string,
  absolute: string,
  relative: string | null,
  brief: string,
): DeadlineText {
  return { at, absolute, relative, brief }
}

const DUE_SOON = deadline(
  "2026-10-23T20:59:00Z",
  "Oct 23, 2026, 11:59 PM",
  "in 3 days",
  "in 3 days",
)
const DUE_LATER = deadline("2026-11-06T21:59:00Z", "Nov 6, 2026, 11:59 PM", null, "Nov 6, 2026")
const PAST = deadline("2026-10-09T20:59:00Z", "Oct 9, 2026, 11:59 PM", null, "Oct 9, 2026")

const tmcCourse = courseHomeView({
  title: "Python Programming 2026",
  organization: "mooc",
  description: "An introduction to programming in Python.",
  materialUrl: "https://example.com/python-programming-2026",
  awardedPoints: 9,
  availablePoints: 16,
  nextDeadline: DUE_SOON,
  hasSoftDeadlines: true,
  isWorkspaceOpen: true,
  updates: [{ id: makeTmcKind({ tmcExerciseId: 103 }), name: "03_sum_of_numbers" }],
  parts: [
    {
      key: "part01",
      name: "Part 1",
      isDefaultOpen: false,
      exercises: [
        courseHomeExercise(101, "01_hello_world", {
          status: "closed",
          passed: true,
          awardedPoints: 1,
          deadline: PAST,
        }),
        courseHomeExercise(102, "02_greeting", {
          status: "closed",
          passed: true,
          awardedPoints: 2,
          availablePoints: 2,
          deadline: PAST,
        }),
      ],
    },
    {
      key: "part02",
      name: "Part 2",
      isDefaultOpen: true,
      exercises: [
        courseHomeExercise(103, "03_sum_of_numbers", {
          status: "opened",
          passed: true,
          awardedPoints: 2,
          availablePoints: 2,
          isUpdateable: true,
          deadline: DUE_SOON,
        }),
        courseHomeExercise(104, "04_loops", {
          status: "opened",
          passed: true,
          awardedPoints: 4,
          availablePoints: 4,
          deadline: DUE_SOON,
        }),
        courseHomeExercise(105, "05_fizz_buzz", {
          status: "opened",
          availablePoints: 2,
          deadline: DUE_SOON,
          isSoftDeadline: true,
        }),
        courseHomeExercise(106, "06_prime_numbers", {
          availablePoints: 3,
          deadline: DUE_LATER,
        }),
        courseHomeExercise(107, "07_matrix", { status: "new", availablePoints: 2 }),
      ],
    },
  ],
  newExercises: [{ id: makeTmcKind({ tmcExerciseId: 107 }), name: "07_matrix" }],
})

const MOOC_COURSE_URL = "https://courses.mooc.fi/org/uh-cs/courses/introduction-to-programming"

function moocExercise(id: number, name: string, overrides: Partial<CourseHomeExercise> = {}) {
  return courseHomeExercise(id, name, {
    id: makeMoocKind({ moocExerciseId: moocExerciseUuid(id) }),
    materialUrl: `${MOOC_COURSE_URL}/chapter-1/exercise-${id}`,
    ...overrides,
  })
}

function moocExerciseUuid(id: number): string {
  return `cccccccc-cccc-4ccc-accc-${String(id).padStart(12, "0")}`
}

const moocParts = (downloading: boolean): CourseHomeView["parts"] => [
  {
    key: "chapter:1",
    name: "Getting started",
    isDefaultOpen: true,
    exercises: [
      moocExercise(1, "Hello, world!", {
        status: downloading ? "opened" : "missing",
        deadline: DUE_SOON,
      }),
      moocExercise(2, "Reading input", {
        status: downloading ? "downloading" : "missing",
        deadline: DUE_SOON,
      }),
      moocExercise(3, "Arithmetic", {
        status: downloading ? "downloading" : "missing",
        availablePoints: 2,
        deadline: DUE_SOON,
      }),
    ],
  },
  {
    key: "chapter:2",
    name: "Conditionals and loops",
    isDefaultOpen: true,
    exercises: [
      moocExercise(4, "Is it even?", {
        status: downloading ? "downloading" : "missing",
        deadline: DUE_LATER,
      }),
      moocExercise(5, "Counting down", { deadline: DUE_LATER }),
    ],
  },
]

const moocCourse = courseHomeView({
  backend: "mooc",
  title: "Introduction to Programming",
  organization: "University of Helsinki",
  description: null,
  materialUrl: MOOC_COURSE_URL,
  availablePoints: 6,
  nextDeadline: DUE_SOON,
  aiPolicy: { policy: "no_ai", isAiAllowed: false },
  parts: moocParts(false),
})

const moocCourseInWorkspace = courseHomeView({
  ...moocCourse,
  isWorkspaceOpen: true,
  nextExercise: {
    id: makeMoocKind({ moocExerciseId: moocExerciseUuid(2) }),
    name: "Reading input",
    isOnDisk: true,
  },
  parts: moocParts(false).map((part) => ({
    ...part,
    exercises: part.exercises.map((ex, index) => ({
      ...ex,
      status: "opened",
      ...(part.key === "chapter:1" && index === 0 ? { passed: true, awardedPoints: 1 } : {}),
    })),
  })),
})

/** The course in its workspace once its backend refuses it: what is on disk stays. */
function moocCourseOutOfReach(accessLoss: "forbidden" | "notFound"): CourseHomeView {
  const refusal = accessLoss === "forbidden" ? "courseForbidden" : "courseNotFound"
  const { nextExercise: _none, nextDeadline: _passed, ...rest } = moocCourseInWorkspace
  return courseHomeView({
    ...rest,
    accessLoss,
    parts: rest.parts.map((part) => ({
      ...part,
      exercises: part.exercises.map((ex) => ({
        ...ex,
        submitRefusal: {
          label: SUBMIT_REFUSAL_LABELS[refusal],
          sentence: submitRefusalSentence(refusal, ex.name),
        },
      })),
    })),
  })
}

const moocCourseWithRules = courseHomeView({
  ...moocCourse,
  isWorkspaceOpen: true,
  parts: [
    {
      key: "chapter:1",
      name: "Getting started",
      isDefaultOpen: true,
      exercises: [
        moocExercise(1, "Hello, world!", { status: "opened", triesLeft: 2, deadline: DUE_SOON }),
        moocExercise(2, "Reading input", {
          status: "opened",
          submitRefusal: {
            label: "deadline passed",
            sentence: "The deadline of Reading input has passed, so it can no longer be submitted.",
          },
        }),
        moocExercise(3, "Arithmetic", {
          status: "opened",
          isOutOfTries: true,
          submitRefusal: {
            label: "no tries left",
            sentence: "You have no tries left on Arithmetic, so it can no longer be submitted.",
          },
        }),
      ],
    },
    {
      key: "chapter:2",
      name: "Conditionals and loops",
      isDefaultOpen: true,
      lockedReason: "Locked until you have completed the chapters before it.",
      exercises: [
        moocExercise(4, "Is it even?", {
          submitRefusal: {
            label: "chapter not unlocked yet",
            sentence:
              'Is it even? can be submitted once you have completed the chapters before the chapter "Conditionals and loops".',
          },
        }),
      ],
    },
  ],
})

const restrictedCourse = courseHomeView({
  ...tmcCourse,
  // The updates were just applied, which is what the notice says.
  parts: tmcCourse.parts.map((part) => ({
    ...part,
    exercises: part.exercises.map((ex) => ({ ...ex, isUpdateable: false })),
  })),
  isRestricted: true,
  isOffline: true,
  newExercises: [],
  updates: [],
  recentlyUpdated: ["03_sum_of_numbers", "04_loops"],
})

function courseDetailsPanel(id: number, courseId: CourseDetailsPanel["courseId"]): Panel {
  return { id, type: "CourseDetails", courseId }
}

function answerCourseDetails(panel: { id: number }, view: CourseHomeView) {
  return (message: WebviewToExtension): ExtensionToWebview[] => {
    if (message.type !== "requestCourseDetailsData") {
      return []
    }
    const target = { type: "CourseDetails" as const, id: panel.id }
    return [
      { type: "reply", target, requestId: message.requestId, outcome: { ok: true, value: view } },
    ]
  }
}

const submissionPanel = {
  id: 30,
  type: "ExerciseSubmission" as const,
  exerciseId: makeTmcKind({ tmcExerciseId: 3 }),
  backend: "tmc" as const,
  exerciseName: "part01-03_exercise",
  courseTitle: "Python Programming 2026",
}

function submissionFinished(overrides: Partial<SubmissionFinished>): SubmissionFinished {
  return baseSubmissionFinished({
    exercise_name: "part01-03_exercise",
    points: ["1.3"],
    solution_url: "https://tmc.mooc.fi/solutions/1",
    test_cases: [
      { name: "test_sum", successful: true, message: null, detailed_message: null, exception: [] },
    ],
    ...overrides,
  })
}

const moocSubmissionPanel = {
  id: 31,
  type: "ExerciseSubmission" as const,
  exerciseId: makeMoocKind({ moocExerciseId: "mooc-exercise-uuid" }),
  backend: "mooc" as const,
  exerciseName: "Sum of three numbers",
  courseTitle: "Introduction to Programming",
  organization: "University of Helsinki",
}

/** The host's answers to what a results panel asks of its History and Get help. */
function answerResultsRequests(
  panel: { id: number },
  history: SubmissionHistoryEntry[],
): (message: WebviewToExtension) => ExtensionToWebview[] {
  return (message) => {
    const target = { type: "ExerciseSubmission" as const, id: panel.id }
    switch (message.type) {
      case "requestSubmissionHistory":
        return [
          {
            type: "reply",
            target,
            requestId: message.requestId,
            outcome: { ok: true, value: history },
          },
        ]
      case "pasteExercise":
        return [
          {
            type: "reply",
            target,
            requestId: message.requestId,
            outcome: {
              ok: true,
              value: { link: `${MOOC_COURSE_URL}/shared-submissions/5f0c2a`, isReused: true },
            },
          },
        ]
      default:
        return []
    }
  }
}

function openSection(
  panel: { id: number },
  section: ExerciseSection,
  shouldPaste = false,
): ExtensionToWebview {
  return {
    type: "openExerciseSection",
    target: { type: "ExerciseSubmission", id: panel.id },
    section,
    serial: 1,
    shouldPaste,
  }
}

const moocHistory: SubmissionHistoryEntry[] = [
  {
    key: "sub-3",
    createdAt: "2026-10-01T08:40:12Z",
    dateLabel: "11:40:12 AM",
    kind: "submission",
    points: { given: 2, max: 3 },
    status: "Some tests failed",
    isPassed: false,
    isNewestGraded: true,
    isShared: false,
  },
  {
    key: "sub-1",
    createdAt: "2026-09-29T14:02:55Z",
    dateLabel: "Sep 29, 2026, 5:02:55 PM",
    kind: "submission",
    points: { given: 0, max: 3 },
    status: "Tests failed",
    isPassed: false,
    isNewestGraded: false,
    isShared: false,
  },
  {
    key: "paste-1",
    createdAt: "2026-09-30T10:15:00Z",
    dateLabel: "Sep 30, 2026, 1:15:00 PM",
    kind: "paste",
    status: "Not graded",
    isPassed: false,
    isNewestGraded: false,
    isShared: true,
  },
  {
    key: "backup-1",
    createdAt: "2026-09-30T09:00:00Z",
    dateLabel: "Sep 30, 2026, 12:00:00 PM",
    kind: "backup",
    status: "Not graded",
    isPassed: false,
    isNewestGraded: false,
    isShared: false,
  },
]

const moocResultsPanel = { ...moocSubmissionPanel, id: 32 }

const moocStandingPanel = { ...moocSubmissionPanel, id: 33 }

const tmcResultsPanel = { ...submissionPanel, id: 34 }

function moocGrading(
  overrides: Parameters<typeof baseMoocGrading>[0],
): ExerciseTaskSubmissionStatus {
  return baseMoocGrading({
    score_given: 2.5,
    grading_started_at: "2026-09-29T12:00:00Z",
    grading_completed_at: "2026-09-29T12:00:05Z",
    feedback_text: "Well done!",
    ...overrides,
  })
}

/** Every scenario the dev harness offers and the accessibility tests walk through. */

const loginPanel: LoginPanel = { id: 60, type: "Login", isAddingCourse: false }

function loginScenario(id: string, view: LoginView): Scenario {
  return {
    id: `login/${id}`,
    panel: loginPanel,
    pushes: [{ type: "loginView", target: { id: loginPanel.id, type: "Login" }, view }],
  }
}

// The visual tier fixes the clock at 2026-10-01T09:00:00Z.
const LOGIN_EXPIRES_AT = "2026-10-01T09:15:00.000Z"

const addCoursePanel: AddCoursePanel = { id: 70, type: "AddCourse" }

function catalogCourse(name: string, overrides: Partial<CatalogCourse> = {}): CatalogCourse {
  return {
    key: `key:${name}`,
    name,
    organization: "University of Helsinki",
    isAdded: false,
    ...overrides,
  }
}

const enrolledCourses: MoocCatalog = {
  kind: "listed",
  items: [
    catalogCourse("Introduction to everything", {
      description:
        "A whirlwind tour of programming, from the first print to files and objects, " +
        "with exercises tested on your own computer.",
    }),
    catalogCourse("Python Programming 2026", {
      description: "The University of Helsinki's introduction to programming in Python.",
      isAdded: true,
    }),
    catalogCourse("Data Analysis with Python", { organization: "Aalto University" }),
  ],
}

const tmcOrganizations: TmcOrganizations = {
  kind: "listed",
  items: [
    {
      slug: "mooc",
      name: "MOOC",
      description: "Open online courses of the University of Helsinki.",
    },
    { slug: "hy", name: "University of Helsinki" },
    { slug: "aalto", name: "Aalto University", description: "Courses taught at Aalto." },
  ],
}

type CatalogRequest = Extract<
  RequestType,
  "requestMoocCatalog" | "requestTmcOrganizations" | "requestTmcCourses"
>

/** Answers the add-course screen's listings; a request left out of `answers` stays pending. */
function answerCatalog(
  answers: Partial<
    Record<CatalogRequest, { ok: true; value: unknown } | { ok: false; error: { message: string } }>
  >,
) {
  return (message: WebviewToExtension): ExtensionToWebview[] => {
    if (!("requestId" in message) || !(message.type in answers)) {
      return []
    }
    const outcome = answers[message.type as CatalogRequest]
    return outcome
      ? [
          {
            type: "reply",
            target: { type: "AddCourse", id: addCoursePanel.id },
            requestId: message.requestId,
            outcome,
          } as ExtensionToWebview,
        ]
      : []
  }
}

function addCourseScenario(
  id: string,
  answers: Parameters<typeof answerCatalog>[0],
  savedState?: WebviewState,
): Scenario {
  return {
    id: `add-course/${id}`,
    panel: addCoursePanel,
    reply: answerCatalog(answers),
    ...(savedState ? { savedState } : {}),
  }
}

const LOG_TAIL = [
  "[2026-10-01 08:58:10:120] [INFO] Downloading 1 exercise of Python Programming 2026",
  "[2026-10-01 08:58:12:004] [ERROR] Failed to download the exercise. Server Error: tmc.mooc.fi " +
    "returned 500 Internal Server Error",
].join("\n")

/** Answers the help screen's request for the log. */
function answerLogTail(panelId: number): NonNullable<Scenario["reply"]> {
  return (message) =>
    message.type === "requestLogTail"
      ? [
          {
            type: "reply",
            target: { id: panelId, type: "ErrorHelp" },
            requestId: message.requestId,
            outcome: { ok: true, value: LOG_TAIL },
          },
        ]
      : []
}

export const SCENARIOS: Scenario[] = [
  {
    id: "course-details/tmc",
    panel: courseDetailsPanel(3, makeTmcKind({ courseId: 42 })),
    reply: answerCourseDetails({ id: 3 }, tmcCourse),
  },
  {
    id: "course-details/mooc",
    panel: courseDetailsPanel(4, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 4 }, moocCourse),
  },
  {
    id: "course-details/mooc-in-workspace",
    panel: courseDetailsPanel(60, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 60 }, moocCourseInWorkspace),
  },
  {
    id: "course-details/mooc-not-enrolled",
    panel: courseDetailsPanel(61, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 61 }, { ...moocCourse, isNotEnrolled: true }),
  },
  {
    id: "course-details/mooc-no-access",
    panel: courseDetailsPanel(63, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 63 }, moocCourseOutOfReach("forbidden")),
  },
  {
    id: "course-details/mooc-course-removed",
    panel: courseDetailsPanel(64, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 64 }, moocCourseOutOfReach("notFound")),
  },
  {
    id: "course-details/mooc-downloading",
    panel: courseDetailsPanel(6, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails(
      { id: 6 },
      { ...moocCourse, isWorkspaceOpen: true, parts: moocParts(true) },
    ),
  },
  {
    id: "course-details/mooc-submission-rules",
    panel: courseDetailsPanel(62, makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 62 }, moocCourseWithRules),
  },
  {
    id: "course-details/restricted",
    panel: courseDetailsPanel(7, makeTmcKind({ courseId: 42 })),
    reply: answerCourseDetails({ id: 7 }, restrictedCourse),
  },
  {
    id: "course-details/action-failed",
    panel: courseDetailsPanel(8, makeTmcKind({ courseId: 42 })),
    reply: answerCourseDetails({ id: 8 }, tmcCourse),
    pushes: [
      {
        type: "operationFailed",
        target: { id: 8, type: "CourseDetails" },
        failure: {
          serial: 1,
          tone: "error",
          title: "Failed to download the exercises.",
          error: {
            message: "tmc.mooc.fi returned an error (500). Try again later.",
            detailsId: "download-failure",
          },
        },
      },
      {
        type: "operationFailed",
        target: { id: 8, type: "CourseDetails" },
        failure: {
          serial: 2,
          tone: "warning",
          error: {
            message:
              "You have over 50 exercises open, which can slow VS Code down. Close the ones you have finished.",
          },
        },
      },
    ],
  },
  // Never answered, so the panel shows its loading state until the request times out.
  { id: "course-details/loading", panel: courseDetailsPanel(5, makeTmcKind({ courseId: 42 })) },
  {
    id: "exercise-submission/processing",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(
        submissionPanel.id,
        inProgressView("grading", {
          fraction: 0.4,
          steps: ["Submission received", "Waiting in queue"],
          submissionUrl: "https://tmc.mooc.fi/submissions/1",
        }),
      ),
    ],
  },
  {
    id: "exercise-submission/tmc-passed",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(submissionPanel.id, {
        ...tmcResultView(
          submissionFinished({
            points: ["1.3", "1.4"],
            feedback_answer_url: "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback",
          }),
          [
            { id: 1, kind: "intrange", lower: 1, upper: 5, question: "How difficult was this?" },
            { id: 2, kind: "text", question: "Anything else?" },
          ],
          2,
        ),
        isExercisePassed: true,
      }),
    ],
  },
  {
    id: "exercise-submission/tmc-failed",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(submissionPanel.id, {
        isExercisePassed: false,
        ...tmcResultView(
          submissionFinished({
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
          [],
          2,
        ),
      }),
    ],
  },
  {
    id: "exercise-submission/tmc-failed-tests",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(submissionPanel.id, {
        ...tmcResultView(
          submissionFinished({
            all_tests_passed: false,
            status: "fail",
            points: ["1.3"],
            test_cases: [
              {
                name: "SumTest: test_sum_of_positives",
                successful: true,
                message: null,
                detailed_message: null,
                exception: [],
              },
              {
                name: "SumTest: test_sum_of_negatives",
                successful: false,
                message:
                  "With the input -1, -2 your program printed\n-1\nbut the expected output was\n-3",
                detailed_message: null,
                exception: [
                  "Traceback (most recent call last):",
                  '  File "test/test_sum.py", line 21, in test_sum_of_negatives',
                  "AssertionError: '-1' != '-3'",
                ],
              },
              {
                name: "SumTest: test_empty_input",
                successful: false,
                message:
                  "Your program crashed: ValueError: invalid literal for int() with base 10: ''",
                detailed_message: null,
                exception: [],
              },
            ],
          }),
          [],
          2,
        ),
        isExercisePassed: false,
      }),
    ],
  },
  {
    id: "exercise-submission/tmc-passed-next",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(submissionPanel.id, {
        ...tmcResultView(submissionFinished({ points: ["1.3", "1.4"] }), [], 2),
        isExercisePassed: true,
        nextExercise: { name: "part01-04_exercise" },
      }),
    ],
  },
  {
    id: "exercise-submission/mooc-passed",
    panel: moocSubmissionPanel,
    pushes: [
      submissionViewMessage(moocSubmissionPanel.id, {
        ...moocGradingView(
          moocGrading({
            score_given: 3,
            feedback_text: "Tests passed",
            exercise_progress: {
              exercise_id: "mooc-exercise-uuid",
              score_given: 3,
              score_maximum: 3,
              completed: true,
              attempted: true,
              standing: "Passed",
              max_tries: null,
              tries_left: null,
              pending_teacher_review: null,
              exercise_locked: false,
            },
          }),
          3,
        ),
        isExercisePassed: true,
        nextExercise: { name: "Average of three numbers" },
      }),
    ],
  },
  {
    id: "exercise-submission/mooc-failed",
    panel: moocSubmissionPanel,
    pushes: [
      submissionViewMessage(moocSubmissionPanel.id, {
        ...moocGradingView(moocGrading({ score_given: 0, feedback_text: "Tests failed" }), 3),
        isExercisePassed: false,
      }),
    ],
  },
  {
    id: "exercise-submission/mooc-out-of-tries",
    panel: moocSubmissionPanel,
    pushes: [
      submissionViewMessage(moocSubmissionPanel.id, {
        ...moocGradingView(moocGrading({ score_given: 0, feedback_text: "Tests failed" }), 3),
        isExercisePassed: false,
        solutionUrl: `${MOOC_COURSE_URL}/chapter-1/exercise-3`,
        submitRefusal:
          "You have no tries left on Sum of three numbers, so it can no longer be submitted.",
        triesLeft: 0,
      }),
    ],
  },
  {
    id: "exercise-submission/mooc-history",
    panel: moocResultsPanel,
    reply: answerResultsRequests(moocResultsPanel, moocHistory),
    pushes: [
      submissionViewMessage(moocResultsPanel.id, {
        ...moocGradingView(moocGrading({ score_given: 2, feedback_text: null }), 3),
        isExercisePassed: false,
        triesLeft: 2,
      }),
      openSection(moocResultsPanel, "history"),
    ],
  },
  {
    id: "exercise-submission/mooc-get-help",
    panel: moocStandingPanel,
    reply: answerResultsRequests(moocStandingPanel, moocHistory),
    pushes: [
      submissionViewMessage(
        moocStandingPanel.id,
        standingView(
          makeMoocKind({
            id: "mooc-exercise-uuid",
            name: "Sum of three numbers",
            availablePoints: 3,
            awardedPoints: 0,
            deadline: null,
            passed: false,
          }),
          undefined,
        ),
      ),
      openSection(moocStandingPanel, "getHelp", true),
    ],
  },
  {
    id: "exercise-submission/tmc-tested-locally",
    panel: tmcResultsPanel,
    reply: answerResultsRequests(tmcResultsPanel, []),
    pushes: [submissionViewMessage(tmcResultsPanel.id, testedLocallyView())],
  },
  {
    id: "exercise-submission/tested-locally-logged-out",
    panel: tmcResultsPanel,
    reply: answerResultsRequests(tmcResultsPanel, []),
    pushes: [
      submissionViewMessage(tmcResultsPanel.id, { ...testedLocallyView(), isLoggedOut: true }),
    ],
  },
  {
    id: "exercise-submission/mooc-grading",
    panel: moocSubmissionPanel,
    pushes: [
      submissionViewMessage(
        moocSubmissionPanel.id,
        inProgressView("grading", {
          steps: ["Grading has not started yet", "Grading in progress"],
        }),
      ),
    ],
  },
  {
    id: "exercise-submission/mooc-graded",
    panel: moocSubmissionPanel,
    pushes: [
      submissionViewMessage(moocSubmissionPanel.id, {
        ...moocGradingView(moocGrading({}), 3),
        isExercisePassed: false,
      }),
    ],
  },
  {
    id: "exercise-submission/mooc-timed-out",
    panel: moocSubmissionPanel,
    reply: (message) =>
      message.type === "keepWaitingForGrading"
        ? [
            submissionViewMessage(
              moocSubmissionPanel.id,
              inProgressView("grading", { steps: ["Grading in progress"] }),
            ),
            submissionViewMessage(moocSubmissionPanel.id, moocGradingView(moocGrading({}), 3)),
            {
              type: "reply",
              target: { type: "ExerciseSubmission", id: moocSubmissionPanel.id },
              requestId: message.requestId,
              outcome: { ok: true },
            },
          ]
        : [],
    pushes: [
      submissionViewMessage(
        moocSubmissionPanel.id,
        moocGradingView(moocGrading({ grading_progress: "Pending", score_given: null }), 3),
      ),
    ],
  },
  {
    id: "exercise-submission/mooc-manual-review",
    panel: moocSubmissionPanel,
    pushes: [
      submissionViewMessage(
        moocSubmissionPanel.id,
        moocGradingView(
          moocGrading({
            grading_progress: "PendingManual",
            score_given: null,
            feedback_text: null,
          }),
          3,
        ),
      ),
    ],
  },
  {
    id: "exercise-submission/action-failed",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(
        submissionPanel.id,
        tmcResultView(submissionFinished({ points: ["1.3", "1.4"] }), [], 2),
      ),
      {
        type: "operationFailed",
        target: { id: submissionPanel.id, type: "ExerciseSubmission" },
        failure: {
          serial: 3,
          tone: "error",
          error: { message: "This exercise is no longer downloaded." },
        },
      },
    ],
  },
  {
    id: "exercise-submission/error",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(
        submissionPanel.id,
        submitFailedView({
          message: "tmc.mooc.fi returned an error (500). Try again later.",
          detailsId: "submit-failure",
        }),
      ),
    ],
  },
  loginScenario("requesting-code", { phase: "requestingCode" }),
  loginScenario("waiting", {
    phase: "waiting",
    userCode: "WXYZ-0001",
    verificationUrl: "https://courses.mooc.fi/oauth_device",
    expiresAt: LOGIN_EXPIRES_AT,
  }),
  loginScenario("denied", {
    phase: "failed",
    failure: "denied",
    error: { message: "The login was denied in the browser." },
  }),
  loginScenario("expired", {
    phase: "failed",
    failure: "expired",
    error: { message: "The login code expired before it was approved." },
  }),
  loginScenario("unreachable", {
    phase: "failed",
    failure: "unreachable",
    error: {
      message: "Could not reach courses.mooc.fi. Check your internet connection.",
      detailsId: "login-failure",
    },
  }),
  addCourseScenario("loading", {}),
  addCourseScenario("courses", {
    requestMoocCatalog: { ok: true, value: enrolledCourses },
    requestTmcOrganizations: { ok: true, value: tmcOrganizations },
  }),
  addCourseScenario(
    "organization",
    {
      requestMoocCatalog: { ok: true, value: enrolledCourses },
      requestTmcOrganizations: { ok: true, value: tmcOrganizations },
      requestTmcCourses: {
        ok: true,
        value: [
          catalogCourse("Java Programming I", {
            organization: "MOOC",
            description: "The basics of programming in Java.",
          }),
          catalogCourse("Java Programming II", { organization: "MOOC", isAdded: true }),
        ],
      },
    },
    { screen: "AddCourse", ui: { organization: "mooc" } },
  ),
  addCourseScenario("not-enrolled", {
    requestMoocCatalog: { ok: true, value: { kind: "listed", items: [] } },
    requestTmcOrganizations: { ok: true, value: tmcOrganizations },
  }),
  addCourseScenario("unavailable", {
    requestMoocCatalog: { ok: true, value: { kind: "loggedOut" } },
    requestTmcOrganizations: {
      ok: false,
      error: { message: "Could not reach tmc.mooc.fi. Check your internet connection." },
    },
  }),
  {
    id: "error-help/startup",
    panel: {
      id: 50,
      type: "ErrorHelp",
      topic: {
        kind: "startup",
        failures: [
          {
            service: "tmc-langs",
            error: "Failed to download the TMC-langs CLI",
            stack: "Error: ENOTFOUND",
            hint:
              "A proxy, firewall or antivirus program blocking network requests can cause this. " +
              "Try adding an exception for the directory '/home/student/.local/share/tmc/cli'.",
          },
        ],
      },
    },
    reply: answerLogTail(50),
  },
  {
    id: "error-help/operation",
    panel: {
      id: 51,
      type: "ErrorHelp",
      topic: {
        kind: "operation",
        detailsId: "download-failure",
        details: {
          summary: "Failed to download the exercise. tmc.mooc.fi returned an error (500).",
          actions: [],
          causeChain:
            "Server Error: tmc.mooc.fi returned 500 Internal Server Error\n" +
            "GET https://tmc.mooc.fi/api/v8/core/exercises/1/download\n\n" +
            "Caused by: Error: connection reset by peer",
          occurredAt: "2026-10-01T08:58:12.000Z",
        },
      },
    },
    reply: answerLogTail(51),
  },
  {
    id: "error-help/operation-cleared",
    panel: {
      id: 52,
      type: "ErrorHelp",
      topic: { kind: "operation", detailsId: "before-reload", details: null },
    },
    reply: answerLogTail(52),
  },
  {
    id: "error-help/general",
    panel: {
      id: 53,
      type: "ErrorHelp",
      topic: {
        kind: "general",
        hint:
          "An antivirus program can stop the TestMyCode tools from running, and a proxy or " +
          "firewall can block their network requests. Try adding an exception for the directory " +
          "'/home/student/.local/share/tmc/cli'.",
      },
    },
    reply: answerLogTail(53),
  },
]

/** The scenario with `id`, or the first one, so a stale link still opens something. */
export function findScenario(id: string | null): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? (SCENARIOS[0] as Scenario)
}

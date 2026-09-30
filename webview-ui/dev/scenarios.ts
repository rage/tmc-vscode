import {
  inProgressView,
  moocGradingView,
  submitFailedView,
  tmcResultView,
} from "../../src/panels/submissionView"
import type { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../src/shared/langsSchema"
import type {
  CourseDetailsPanel,
  ExtensionToWebview,
  Panel,
  WebviewToExtension,
} from "../src/shared/shared"
import { makeMoocKind, makeTmcKind } from "../src/shared/shared"
import {
  MOOC_INSTANCE_ID,
  moocGrading as baseMoocGrading,
  moocLocalCourse,
  submissionFinished as baseSubmissionFinished,
  submissionViewMessage,
  tmcLocalCourse,
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
    deadline: index === 3 ? "2026-12-31T21:59:00Z" : null,
    passed: index < 2,
    softDeadline: index === 3 ? "2026-12-24T21:59:00Z" : null,
  })),
  availablePoints: 12,
  awardedPoints: 4,
  materialUrl: "https://example.com/python-programming-2026",
})
const moocCourse = moocLocalCourse({ newExercises: [] })

function courseDetailsPanel(id: number, courseId: CourseDetailsPanel["courseId"]): Panel {
  return { id, type: "CourseDetails", courseId }
}

function answerCourseDetails(panel: { id: number }, course: typeof tmcCourse) {
  return (message: WebviewToExtension): ExtensionToWebview[] => {
    if (message.type !== "requestCourseDetailsData") {
      return []
    }
    const target = { type: "CourseDetails" as const, id: panel.id }
    return [
      { type: "reply", target, requestId: message.requestId, outcome: { ok: true, value: course } },
    ]
  }
}

const submissionPanel = {
  id: 30,
  type: "ExerciseSubmission" as const,
  backend: "tmc" as const,
  courseSlug: "python-course",
  exerciseSlug: "part01-03_exercise",
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
  backend: "mooc" as const,
  courseSlug: "mooc-course",
  exerciseSlug: "mooc-exercise",
}

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
export const SCENARIOS: Scenario[] = [
  {
    id: "course-details/tmc",
    panel: courseDetailsPanel(3, makeTmcKind({ courseId: 42 })),
    reply: answerCourseDetails({ id: 3 }, tmcCourse),
  },
  {
    id: "course-details/mooc",
    panel: courseDetailsPanel(4, makeMoocKind({ instanceId: MOOC_INSTANCE_ID })),
    reply: answerCourseDetails({ id: 4 }, moocCourse),
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
      submissionViewMessage(
        submissionPanel.id,
        tmcResultView(
          submissionFinished({
            feedback_answer_url: "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback",
          }),
          [
            { id: 1, kind: "intrange", lower: 1, upper: 5, question: "How difficult was this?" },
            { id: 2, kind: "text", question: "Anything else?" },
          ],
          2,
        ),
      ),
    ],
  },
  {
    id: "exercise-submission/tmc-failed",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(
        submissionPanel.id,
        tmcResultView(
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
      ),
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
    pushes: [submissionViewMessage(moocSubmissionPanel.id, moocGradingView(moocGrading({}), 3))],
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
    id: "exercise-submission/error",
    panel: submissionPanel,
    pushes: [
      submissionViewMessage(
        submissionPanel.id,
        submitFailedView({ message: "Submitting failed", details: "The server returned 500" }),
      ),
    ],
  },
  {
    id: "initialization-error-help/errors",
    panel: {
      id: 50,
      type: "InitializationErrorHelp",
      cliFolder: "/home/student/.local/share/tmc/cli",
      initializationErrors: {
        tmc: { error: "Failed to download the TMC-langs CLI", stack: "Error: ENOTFOUND" },
        userData: null,
        workspaceManager: null,
        exerciseDecorationProvider: null,
        resources: null,
      },
    },
  },
]

/** The scenario with `id`, or the first one, so a stale link still opens something. */
export function findScenario(id: string | null): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? (SCENARIOS[0] as Scenario)
}

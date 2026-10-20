// Shared fixtures for the webview component tests. Built to satisfy the zod
// schemas in `shared/shared` so a dispatched `MessageEvent` survives the
// `MessageToWebviewSchema.safeParse` gate in `addMessageListener` and a click
// handler's posted payload survives `WebviewToExtensionSchema.safeParse`.

import type {
  ExerciseTaskSubmissionStatus,
  SubmissionFinished,
  TestCase,
} from "../../../shared/langsSchema"
import type {
  CourseHomeExercise,
  CourseHomeView,
  ExtensionToWebview,
  InitializationErrorHelpPanel,
  SubmissionView,
} from "../../../shared/lib"
import { makeTmcKind } from "../../../shared/lib"

// valid v4 UUIDs (version nibble 4, variant nibble 8-b); mooc ids validate as `z.uuid()`
export const MOOC_INSTANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

export function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    name: "test_case",
    successful: true,
    message: "",
    detailed_message: null,
    exception: [],
    ...overrides,
  }
}

export function initializationErrorHelpPanel(
  failures: InitializationErrorHelpPanel["failures"] = [],
): InitializationErrorHelpPanel {
  return { id: 4, type: "InitializationErrorHelp", failures }
}

/** A TMC server's graded submission of `part01-01_hello`, all tests passed. */
export function submissionFinished(
  overrides: Partial<SubmissionFinished> = {},
): SubmissionFinished {
  return {
    api_version: 7,
    all_tests_passed: true,
    user_id: 1,
    login: "student",
    course: "python-course",
    exercise_name: "part01-01_hello",
    status: "ok",
    points: ["1.1"],
    valgrind: null,
    submission_url: "https://tmc.mooc.fi/submissions/1",
    solution_url: null,
    submitted_at: "2026-09-29T00:00:00Z",
    processing_time: 1,
    reviewed: false,
    requests_review: false,
    paste_url: null,
    message_for_paste: null,
    missing_review_points: [],
    test_cases: [],
    feedback_questions: null,
    feedback_answer_url: null,
    error: null,
    validations: null,
    ...overrides,
  }
}

type MoocGrading = Extract<ExerciseTaskSubmissionStatus, { status: "grading" }>["grading"]

/** A courses.mooc.fi grading, fully graded with no score unless `overrides` say otherwise. */
export function moocGrading(overrides: Partial<MoocGrading> = {}): ExerciseTaskSubmissionStatus {
  return {
    status: "grading",
    grading: {
      grading_progress: "FullyGraded",
      score_given: null,
      grading_started_at: null,
      grading_completed_at: null,
      feedback_text: null,
      exercise_progress: null,
      ...overrides,
    },
  }
}

export function submissionViewMessage(panelId: number, view: SubmissionView): ExtensionToWebview {
  return { type: "submissionView", target: { type: "ExerciseSubmission", id: panelId }, view }
}

/** A not-downloaded, unpassed one-point exercise row of the course home. */
export function courseHomeExercise(
  id: number,
  name: string,
  overrides: Partial<CourseHomeExercise> = {},
): CourseHomeExercise {
  return {
    id: makeTmcKind({ tmcExerciseId: id }),
    name,
    status: "missing",
    passed: false,
    isOutOfTries: false,
    awardedPoints: 0,
    availablePoints: 1,
    isSoftDeadline: false,
    isUpdateable: false,
    ...overrides,
  }
}

/** The course home of a tmc course just added: one part, nothing downloaded, nothing to say. */
export function courseHomeView(overrides: Partial<CourseHomeView> = {}): CourseHomeView {
  return {
    backend: "tmc",
    title: "Python Programming 2026",
    organization: "mooc",
    description: null,
    materialUrl: null,
    awardedPoints: 0,
    availablePoints: 2,
    hasSoftDeadlines: false,
    isExamMode: false,
    isDisabled: false,
    isOffline: false,
    isLoggedIn: true,
    isWorkspaceOpen: false,
    isRestricted: false,
    newExercises: [],
    updates: [],
    recentlyUpdated: [],
    parts: [
      {
        key: "part01",
        name: "Part 1",
        isDefaultOpen: true,
        exercises: [courseHomeExercise(1, "01_hello"), courseHomeExercise(2, "02_loops")],
      },
    ],
    ...overrides,
  }
}

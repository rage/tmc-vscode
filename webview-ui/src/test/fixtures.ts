// Shared fixtures for the webview component tests. Built to satisfy the zod
// schemas in `shared/shared` so a dispatched `MessageEvent` survives the
// `MessageToWebviewSchema.safeParse` gate in `addMessageListener` and a click
// handler's posted payload survives `WebviewToExtensionSchema.safeParse`.

import type {
  ExerciseTaskSubmissionStatus,
  SubmissionFinished,
  TestCase,
} from "../shared/langsSchema"
import type {
  ExtensionToWebview,
  InitializationErrorHelpPanel,
  LocalCourseData,
  SharedMoocCourseData,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
  SubmissionView,
} from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"

// valid v4 UUIDs (version nibble 4, variant nibble 8-b); mooc ids validate as `z.uuid()`
export const MOOC_INSTANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const MOOC_EXERCISE_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc"

export function tmcCourseData(overrides: Partial<SharedTmcCourseData> = {}): SharedTmcCourseData {
  return {
    id: 42,
    name: "python-course",
    title: "Python Course",
    description: "A course about Python.",
    organization: "mooc",
    exercises: [
      {
        id: 101,
        availablePoints: 2,
        awardedPoints: 1,
        name: "part01-01_hello",
        deadline: null,
        passed: true,
        softDeadline: null,
      },
    ],
    availablePoints: 2,
    awardedPoints: 1,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
    ...overrides,
  }
}

export function moocCourseData(
  overrides: Partial<SharedMoocCourseData> = {},
): SharedMoocCourseData {
  return {
    id: MOOC_INSTANCE_ID,
    name: "mooc-python",
    title: "MOOC Python",
    description: "A mooc.fi course about Python.",
    organization: "mooc",
    exercises: [
      {
        id: MOOC_EXERCISE_ID,
        availablePoints: 3,
        awardedPoints: 0,
        name: "loops",
        deadline: null,
        passed: false,
        softDeadline: null,
      },
    ],
    availablePoints: 3,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
    ...overrides,
  }
}

export function tmcLocalCourse(overrides: Partial<SharedTmcCourseData> = {}): LocalCourseData {
  return makeTmcKind(tmcCourseData(overrides))
}

export function moocLocalCourse(overrides: Partial<SharedMoocCourseData> = {}): LocalCourseData {
  return makeMoocKind(moocCourseData(overrides))
}

export function tmcExercise(
  overrides: Partial<SharedTmcCourseExercise> = {},
): SharedTmcCourseExercise {
  return {
    id: 101,
    availablePoints: 2,
    awardedPoints: 1,
    name: "part01-01_hello",
    deadline: null,
    passed: true,
    softDeadline: null,
    ...overrides,
  }
}

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
  initializationErrors: Partial<InitializationErrorHelpPanel["initializationErrors"]> = {},
): InitializationErrorHelpPanel {
  return {
    id: 4,
    type: "InitializationErrorHelp",
    cliFolder: "/tmp/cli",
    initializationErrors: {
      tmc: null,
      userData: null,
      workspaceManager: null,
      exerciseDecorationProvider: null,
      resources: null,
      ...initializationErrors,
    },
  }
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

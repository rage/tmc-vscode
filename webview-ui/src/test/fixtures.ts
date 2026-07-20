// Shared fixtures for the webview component tests. Built to satisfy the zod
// schemas in `shared/shared` so a dispatched `MessageEvent` survives the
// `MessageToWebviewSchema.safeParse` gate in `addMessageListener` and a click
// handler's posted payload survives `WebviewToExtensionSchema.safeParse`.

import type { TestResult } from "../shared/langsSchema"
import type {
  ExerciseGroup,
  LocalCourseData,
  LocalCourseExercise,
  SharedMoocCourseData,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
  TestResultData,
} from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"

// valid v4 UUIDs (version nibble 4, variant nibble 8-b); mooc ids validate as `z.uuid()`
export const MOOC_INSTANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
export const MOOC_COURSE_ID = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb"
export const MOOC_EXERCISE_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc"

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
    courseId: MOOC_COURSE_ID,
    name: "mooc-python",
    instanceName: null,
    title: "MOOC Python",
    description: "A mooc.fi course about Python.",
    courseDescription: "A mooc.fi course about Python.",
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

// a single-part exercise group referencing a tmc exercise id
export function tmcExerciseGroup(overrides: Partial<ExerciseGroup> = {}): ExerciseGroup {
  return {
    name: "part01",
    nextDeadlineString: "No deadline",
    exercises: [
      {
        id: makeTmcKind({ tmcExerciseId: 101 }),
        name: "part01-01_hello",
        isHard: false,
        hardDeadlineString: "",
        softDeadlineString: "",
        passed: true,
      },
    ],
    ...overrides,
  }
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

export function tmcLocalExercise(
  overrides: Partial<SharedTmcCourseExercise> = {},
): LocalCourseExercise {
  return makeTmcKind(tmcExercise(overrides))
}

export function testResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: "test_case",
    successful: true,
    message: "",
    points: ["1"],
    exception: [],
    ...overrides,
  }
}

// a passing TmcExercise test-run result, for the `testResults` webview message
export function testResultData(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testResult: {
      logs: {},
      status: "PASSED",
      testResults: [testResult()],
    },
    id: makeTmcKind({ tmcExerciseId: 101 }),
    courseSlug: "python-course",
    exerciseName: "part01-01_hello",
    tmcLogs: {},
    ...overrides,
  }
}

// a single-part exercise group referencing a mooc (uuid) exercise id
export function moocExerciseGroup(overrides: Partial<ExerciseGroup> = {}): ExerciseGroup {
  return {
    name: "part01",
    nextDeadlineString: "No deadline",
    exercises: [
      {
        id: makeMoocKind({ moocExerciseId: MOOC_EXERCISE_ID }),
        name: "loops",
        isHard: false,
        hardDeadlineString: "",
        softDeadlineString: "",
        passed: false,
      },
    ],
    ...overrides,
  }
}

// Shared fixtures for the webview component tests. Built to satisfy the zod
// schemas in `shared/shared` so a dispatched `MessageEvent` survives the
// `MessageToWebviewSchema.safeParse` gate in `addMessageListener` and a click
// handler's posted payload survives `WebviewToExtensionSchema.safeParse`.

import type { TestResult } from "../shared/langsSchema"
import type {
  LocalCourseData,
  LocalCourseExercise,
  SharedMoocCourseData,
  SharedMoocCourseExercise,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
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

export function moocLocalExercise(
  overrides: Partial<SharedMoocCourseExercise> = {},
): LocalCourseExercise {
  return makeMoocKind({
    id: MOOC_EXERCISE_ID,
    availablePoints: 3,
    awardedPoints: 0,
    name: "loops",
    deadline: null,
    passed: false,
    softDeadline: null,
    ...overrides,
  })
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

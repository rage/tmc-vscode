import type {
  LocalCourseData,
  SharedMoocCourseData,
  SharedMoocCourseExercise,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
} from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"

export const MOOC_COURSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

/** An unpassed one-point exercise of {@link tmcLocalCourse}. */
export function tmcCourseExercise(
  overrides: Partial<SharedTmcCourseExercise> = {},
): SharedTmcCourseExercise {
  return {
    id: 1,
    name: "part01-01_hello",
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    softDeadline: null,
    passed: false,
    ...overrides,
  }
}

/** An unpassed one-point exercise of {@link moocLocalCourse}. */
export function moocCourseExercise(
  overrides: Partial<SharedMoocCourseExercise> = {},
): SharedMoocCourseExercise {
  return {
    id: "cccccccc-cccc-4ccc-accc-cccccccccccc",
    name: "loops",
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    softDeadline: null,
    passed: false,
    ...overrides,
  }
}

/** A stored tmc course, `python-course`, with no exercises unless given. */
export function tmcLocalCourse(overrides: Partial<SharedTmcCourseData> = {}): LocalCourseData {
  return makeTmcKind({
    id: 42,
    name: "python-course",
    title: "Python Course",
    description: "",
    organization: "mooc",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
    ...overrides,
  })
}

/** A stored courses.mooc.fi course, `mooc-python`, with no exercises unless given. */
export function moocLocalCourse(overrides: Partial<SharedMoocCourseData> = {}): LocalCourseData {
  return makeMoocKind({
    id: MOOC_COURSE_ID,
    name: "mooc-python",
    title: "MOOC Python",
    description: null,
    organization: "mooc",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
    ...overrides,
  })
}

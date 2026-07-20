import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type Langs from "../../api/langs"
import type {
  CourseInstance,
  DownloadOrUpdateMoocCourseExercisesResult,
  DownloadOrUpdateTmcCourseExercisesResult,
  LocalTmcExercise,
  TmcExerciseSlide,
} from "../../shared/langsSchema"
import {
  checkExerciseUpdates,
  checkMoocExerciseUpdates,
  closedExercisesPythonCourse,
  listLocalCourseExercisesPythonCourse,
  moocCourseInstance,
  moocEnrolledCourseInstances,
  moocExerciseSlides,
} from "../fixtures/tmc"

const NOT_MOCKED_ERROR = Err(new Error("Method was not mocked."))

export interface TMCMockValues {
  clean: Result<void, Error>
  downloadExercises: Result<
    [DownloadOrUpdateTmcCourseExercisesResult, DownloadOrUpdateMoocCourseExercisesResult],
    Error
  >
  listLocalCourseExercisesPythonCourse: Result<LocalTmcExercise[], Error>
  getSettingClosedExercises: Result<string[], Error>
  getSettingProjectsDir: Result<string, Error>
  migrateExercise: Result<void, Error>
  moveProjectsDirectory: Result<void, Error>
  setSettingClosedExercises: Result<void, Error>
  checkExerciseUpdates: Result<{ id: number }[], Error>
  checkMoocExerciseUpdates: Result<string[], Error>
  getMoocCourseInstanceData: Result<[CourseInstance, TmcExerciseSlide[]], Error>
  getEnrolledMoocCourseInstances: Result<CourseInstance[], Error>
}

export function createTMCMock(): [Langs, TMCMockValues] {
  const values: TMCMockValues = {
    clean: Ok.EMPTY,
    downloadExercises: NOT_MOCKED_ERROR,
    listLocalCourseExercisesPythonCourse: Ok(listLocalCourseExercisesPythonCourse),
    getSettingClosedExercises: Ok(closedExercisesPythonCourse),
    getSettingProjectsDir: Ok("/langs/path/to/exercises"),
    migrateExercise: Ok.EMPTY,
    moveProjectsDirectory: Ok.EMPTY,
    setSettingClosedExercises: Ok.EMPTY,
    checkExerciseUpdates: Ok(checkExerciseUpdates),
    checkMoocExerciseUpdates: Ok(checkMoocExerciseUpdates),
    getMoocCourseInstanceData: Ok([moocCourseInstance, moocExerciseSlides]),
    getEnrolledMoocCourseInstances: Ok(moocEnrolledCourseInstances),
  }

  return [setupMockValues(values), values]
}

export function createFailingTMCMock(): [Langs, TMCMockValues] {
  const error = Err(new Error())
  const values: TMCMockValues = {
    clean: error,
    downloadExercises: NOT_MOCKED_ERROR,
    listLocalCourseExercisesPythonCourse: error,
    getSettingClosedExercises: error,
    getSettingProjectsDir: error,
    migrateExercise: error,
    moveProjectsDirectory: error,
    setSettingClosedExercises: error,
    checkExerciseUpdates: error,
    checkMoocExerciseUpdates: error,
    getMoocCourseInstanceData: error,
    getEnrolledMoocCourseInstances: error,
  }

  return [setupMockValues(values), values]
}

function setupMockValues(values: TMCMockValues): Langs {
  const mock = {
    clean: vi.fn(async () => values.clean),
    listLocalCourseExercises: vi.fn(async (backend: string, slug: string) =>
      backend === "tmc" && slug === "test-python-course"
        ? values.listLocalCourseExercisesPythonCourse
        : NOT_MOCKED_ERROR,
    ),
    getSetting: vi.fn(async (key: string) =>
      key === "closed-exercises-for:test-python-course"
        ? values.getSettingClosedExercises
        : NOT_MOCKED_ERROR,
    ),
    setSetting: vi.fn(async (key: string, _value: unknown) =>
      key === "closed-exercises-for:test-python-course"
        ? values.setSettingClosedExercises
        : NOT_MOCKED_ERROR,
    ),
    migrateExercise: vi.fn(async () => values.migrateExercise),
    moveProjectsDirectory: vi.fn(async () => values.moveProjectsDirectory),
    checkTmcExerciseUpdates: vi.fn(async () => values.checkExerciseUpdates),
    checkMoocExerciseUpdates: vi.fn(async () => values.checkMoocExerciseUpdates),
    getMoocCourseInstanceData: vi.fn(async () => values.getMoocCourseInstanceData),
    getEnrolledMoocCourseInstances: vi.fn(async () => values.getEnrolledMoocCourseInstances),
    downloadExercises: vi.fn(
      async (
        _identifiers: unknown,
        _downloadTemplate: unknown,
        cb?: (value: { id: number; percent: number }) => void,
      ) => {
        void cb
        return values.downloadExercises
      },
    ),
  }

  return mock as unknown as Langs
}

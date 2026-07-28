import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type Langs from "../../api/langs"
import type {
  CourseInstance,
  DownloadOrUpdateMoocCourseExercisesResult,
  DownloadOrUpdateTmcCourseExercisesResult,
  LocalTmcExercise,
  MoocCourseProgress,
  TmcExerciseSlide,
} from "../../shared/langsSchema"
import {
  checkExerciseUpdates,
  checkMoocExerciseUpdates,
  closedExercisesPythonCourse,
  listLocalCourseExercisesPythonCourse,
  moocCourseInstance,
  moocCourseProgress,
  moocEnrolledCourseInstances,
  moocExerciseSlides,
} from "../fixtures/tmc"

const NOT_MOCKED_ERROR = Err(new Error("Method was not mocked."))

export interface DownloadExercisesMockResult {
  tmc: DownloadOrUpdateTmcCourseExercisesResult
  mooc: DownloadOrUpdateMoocCourseExercisesResult
  tmcError?: Error
  moocError?: Error
}

export interface TMCMockValues {
  clean: Result<void, Error>
  downloadExercises: DownloadExercisesMockResult
  listLocalCourseExercisesPythonCourse: Result<LocalTmcExercise[], Error>
  getSettingClosedExercises: Result<string[], Error>
  getSettingProjectsDir: Result<string, Error>
  migrateExercise: Result<void, Error>
  moveProjectsDirectory: Result<void, Error>
  setSettingClosedExercises: Result<void, Error>
  checkExerciseUpdates: Result<{ id: number }[], Error>
  checkMoocExerciseUpdates: Result<string[], Error>
  isMoocAuthenticated: Result<boolean, Error>
  getMoocCourseInstanceData: Result<[CourseInstance, TmcExerciseSlide[]], Error>
  getMoocCourseProgress: Result<MoocCourseProgress, Error>
  getEnrolledMoocCourseInstances: Result<CourseInstance[], Error>
}

const emptyDownloadExercisesResult: DownloadExercisesMockResult = {
  tmc: { downloaded: [], skipped: [], failed: [] },
  mooc: { downloaded: [], skipped: [], failed: [], not_attempted: [], stopped_for_auth: false },
}

export function createTMCMock(): [Langs, TMCMockValues] {
  const values: TMCMockValues = {
    clean: Ok.EMPTY,
    downloadExercises: emptyDownloadExercisesResult,
    listLocalCourseExercisesPythonCourse: Ok(listLocalCourseExercisesPythonCourse),
    getSettingClosedExercises: Ok(closedExercisesPythonCourse),
    getSettingProjectsDir: Ok("/langs/path/to/exercises"),
    migrateExercise: Ok.EMPTY,
    moveProjectsDirectory: Ok.EMPTY,
    setSettingClosedExercises: Ok.EMPTY,
    checkExerciseUpdates: Ok(checkExerciseUpdates),
    checkMoocExerciseUpdates: Ok(checkMoocExerciseUpdates),
    isMoocAuthenticated: Ok(true),
    getMoocCourseInstanceData: Ok([moocCourseInstance, moocExerciseSlides]),
    getMoocCourseProgress: Ok(moocCourseProgress),
    getEnrolledMoocCourseInstances: Ok(moocEnrolledCourseInstances),
  }

  return [setupMockValues(values), values]
}

export function createFailingTMCMock(): [Langs, TMCMockValues] {
  const error = Err(new Error())
  const values: TMCMockValues = {
    clean: error,
    downloadExercises: {
      ...emptyDownloadExercisesResult,
      tmcError: new Error(),
      moocError: new Error(),
    },
    listLocalCourseExercisesPythonCourse: error,
    getSettingClosedExercises: error,
    getSettingProjectsDir: error,
    migrateExercise: error,
    moveProjectsDirectory: error,
    setSettingClosedExercises: error,
    checkExerciseUpdates: error,
    checkMoocExerciseUpdates: error,
    isMoocAuthenticated: error,
    getMoocCourseInstanceData: error,
    getMoocCourseProgress: error,
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
      key === "closed-exercises-for:tmc:test-python-course"
        ? values.getSettingClosedExercises
        : NOT_MOCKED_ERROR,
    ),
    setSetting: vi.fn(async (key: string, _value: unknown) =>
      key === "closed-exercises-for:tmc:test-python-course"
        ? values.setSettingClosedExercises
        : NOT_MOCKED_ERROR,
    ),
    migrateExercise: vi.fn(async () => values.migrateExercise),
    moveProjectsDirectory: vi.fn(async () => values.moveProjectsDirectory),
    checkTmcExerciseUpdates: vi.fn(async () => values.checkExerciseUpdates),
    checkMoocExerciseUpdates: vi.fn(async () => values.checkMoocExerciseUpdates),
    isMoocAuthenticated: vi.fn(async () => values.isMoocAuthenticated),
    getMoocCourseInstanceData: vi.fn(async () => values.getMoocCourseInstanceData),
    getMoocCourseProgress: vi.fn(async () => values.getMoocCourseProgress),
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

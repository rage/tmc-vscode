import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type Langs from "../../api/langs"
import type {
  DownloadOrUpdateMoocCourseExercisesResult,
  DownloadOrUpdateTmcCourseExercisesResult,
  LocalExercise,
  LocalTmcExercise,
  MoocCourse,
  MoocCourseProgress,
  TmcExerciseSlide,
} from "../../shared/langsSchema"
import type { ExerciseIdentifier } from "../../shared/shared"
import {
  closedExercisesPythonCourse,
  listLocalCourseExercisesPythonCourse,
  localExercises,
  moocCourse,
  moocCourseProgress,
  moocEnrolledCourses,
  moocExerciseSlides,
  moocExerciseUpdates,
  tmcExerciseUpdates,
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
  listLocalExercises: Result<LocalExercise[], Error>
  getSettingClosedExercises: Result<string[], Error>
  getSettingProjectsDir: Result<string, Error>
  listSettings: Result<Record<string, unknown>, Error>
  migrateExercise: Result<void, Error>
  moveProjectsDirectory: Result<void, Error>
  setSettingClosedExercises: Result<void, Error>
  tmcExerciseUpdates: Result<ExerciseIdentifier[], Error>
  moocExerciseUpdates: Result<ExerciseIdentifier[], Error>
  isMoocAuthenticated: Result<boolean, Error>
  getMoocCourseData: Result<[MoocCourse, TmcExerciseSlide[]], Error>
  getMoocCourseProgress: Result<MoocCourseProgress, Error>
  getEnrolledMoocCourses: Result<MoocCourse[], Error>
}

const emptyDownloadExercisesResult: DownloadExercisesMockResult = {
  tmc: { downloaded: [], skipped: [], failed: [] },
  mooc: { downloaded: [], skipped: [], failed: [] },
}

export function createTMCMock(): [Langs, TMCMockValues] {
  const values: TMCMockValues = {
    clean: Ok.EMPTY,
    downloadExercises: emptyDownloadExercisesResult,
    listLocalCourseExercisesPythonCourse: Ok(listLocalCourseExercisesPythonCourse),
    listLocalExercises: Ok(localExercises),
    getSettingClosedExercises: Ok(closedExercisesPythonCourse),
    getSettingProjectsDir: Ok("/langs/path/to/exercises"),
    listSettings: Ok({
      projects_dir: "/langs/path/to/exercises",
      "closed-exercises-for:tmc:test-python-course": closedExercisesPythonCourse,
    }),
    migrateExercise: Ok.EMPTY,
    moveProjectsDirectory: Ok.EMPTY,
    setSettingClosedExercises: Ok.EMPTY,
    tmcExerciseUpdates: Ok(tmcExerciseUpdates),
    moocExerciseUpdates: Ok(moocExerciseUpdates),
    isMoocAuthenticated: Ok(true),
    getMoocCourseData: Ok([moocCourse, moocExerciseSlides]),
    getMoocCourseProgress: Ok(moocCourseProgress),
    getEnrolledMoocCourses: Ok(moocEnrolledCourses),
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
    listLocalExercises: error,
    getSettingClosedExercises: error,
    getSettingProjectsDir: error,
    listSettings: error,
    migrateExercise: error,
    moveProjectsDirectory: error,
    setSettingClosedExercises: error,
    tmcExerciseUpdates: error,
    moocExerciseUpdates: error,
    isMoocAuthenticated: error,
    getMoocCourseData: error,
    getMoocCourseProgress: error,
    getEnrolledMoocCourses: error,
  }

  return [setupMockValues(values), values]
}

function setupMockValues(values: TMCMockValues): Langs {
  const mock = {
    clean: vi.fn(async () => values.clean),
    listLocalExercises: vi.fn(async () => values.listLocalExercises),
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
    listSettings: vi.fn(async () => values.listSettings),
    setSetting: vi.fn(async (key: string, _value: unknown) =>
      key === "closed-exercises-for:tmc:test-python-course"
        ? values.setSettingClosedExercises
        : NOT_MOCKED_ERROR,
    ),
    migrateExercise: vi.fn(async () => values.migrateExercise),
    moveProjectsDirectory: vi.fn(async () => values.moveProjectsDirectory),
    checkExerciseUpdates: vi.fn(async (backend: "tmc" | "mooc") =>
      backend === "tmc" ? values.tmcExerciseUpdates : values.moocExerciseUpdates,
    ),
    isMoocAuthenticated: vi.fn(async () => values.isMoocAuthenticated),
    getMoocCourseData: vi.fn(async () => values.getMoocCourseData),
    getMoocCourseProgress: vi.fn(async () => values.getMoocCourseProgress),
    getEnrolledMoocCourses: vi.fn(async () => values.getEnrolledMoocCourses),
    downloadExercises: vi.fn(
      async (
        _identifiers: unknown,
        _downloadTemplate: unknown,
        cb?: (progress: { id: number; fraction: number }) => void,
      ) => {
        void cb
        return values.downloadExercises
      },
    ),
  }

  return mock as unknown as Langs
}

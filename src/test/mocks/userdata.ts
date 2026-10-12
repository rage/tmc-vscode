import { vi } from "vitest"

import type { UserData } from "../../config/userdata"
import type { BackendKind, LocalCourseData } from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { MoocLocalCourseExercise, TmcLocalCourseExercise } from "../../storage/data"
import { v2_1_0 as userData } from "../fixtures/userData"

export interface UserDataMockValues {
  getCourses: LocalCourseData[]
  /** What `getExerciseByName` finds for a tmc exercise. */
  tmcExercise: TmcLocalCourseExercise | undefined
  /** What `getExerciseByName` finds for a mooc exercise. */
  moocExercise: MoocLocalCourseExercise | undefined
}

export function createUserDataMock(): [UserData, UserDataMockValues] {
  const values: UserDataMockValues = {
    getCourses: userData.courses.map(makeTmcKind),
    tmcExercise: undefined,
    moocExercise: undefined,
  }

  const mock = {
    getCourses: vi.fn(() => values.getCourses),
    getExerciseByName: vi.fn((backend: BackendKind) =>
      backend === "tmc"
        ? values.tmcExercise && makeTmcKind(values.tmcExercise)
        : values.moocExercise && makeMoocKind(values.moocExercise),
    ),
  }

  return [mock as unknown as UserData, values]
}

import { vi } from "vitest"

import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { makeTmcKind } from "../../shared/shared"
import type { TmcLocalCourseExercise } from "../../storage/data"
import { v2_1_0 as userData } from "../fixtures/userData"

export interface UserDataMockValues {
  getCourses: LocalCourseData[]
  getExerciseByName: Readonly<TmcLocalCourseExercise> | undefined
}

export function createUserDataMock(): [UserData, UserDataMockValues] {
  const values: UserDataMockValues = {
    getCourses: userData.courses.map(makeTmcKind),
    getExerciseByName: undefined,
  }

  const mock = {
    getCourses: vi.fn(() => values.getCourses),
    getTmcExerciseByName: vi.fn(() => values.getExerciseByName),
  }

  return [mock as unknown as UserData, values]
}

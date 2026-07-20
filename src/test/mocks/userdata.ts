import type { IMock } from "typemoq"
import { It, Mock } from "typemoq"

import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { makeTmcKind } from "../../shared/shared"
import type { TmcLocalCourseExercise } from "../../storage/data"
import { v2_1_0 as userData } from "../fixtures/userData"

export interface UserDataMockValues {
  getCourses: LocalCourseData[]
  getExerciseByName: Readonly<TmcLocalCourseExercise> | undefined
}

export function createUserDataMock(): [IMock<UserData>, UserDataMockValues] {
  const values: UserDataMockValues = {
    getCourses: userData.courses.map(makeTmcKind),
    getExerciseByName: undefined,
  }
  const mock = setupMockValues(values)

  return [mock, values]
}

function setupMockValues(values: UserDataMockValues): IMock<UserData> {
  const mock = Mock.ofType<UserData>()

  mock.setup((x) => x.getCourses()).returns(() => values.getCourses)

  mock
    .setup((x) => x.getTmcExerciseByName(It.isAny(), It.isAny()))
    .returns(() => values.getExerciseByName)

  return mock
}

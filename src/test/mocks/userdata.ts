import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { StoredExercise, UserData } from "../../config/userdata"
import {
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  makeMoocKind,
  makeTmcKind,
} from "../../shared/shared"
import type { MoocLocalCourseExercise, TmcLocalCourseExercise } from "../../storage/data"
import { v2_1_0 as userData } from "../fixtures/userData"

export interface UserDataMockValues {
  getCourses: LocalCourseData[]
  /** What `getExercise` finds for a tmc id, whatever the id. */
  tmcExercise: TmcLocalCourseExercise | undefined
  /** What `getExercise` finds for a mooc id, whatever the id. */
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
    getExercise: vi.fn((id: ExerciseIdentifier) => {
      const exercise =
        id.kind === "tmc"
          ? values.tmcExercise && makeTmcKind(values.tmcExercise)
          : values.moocExercise && makeMoocKind(values.moocExercise)
      return exercise ? Ok({ course: undefined, exercise }) : Err(new Error("not stored"))
    }),
  }

  return [mock as unknown as UserData, values]
}

/** `UserData.getExercise` over `courses`, for a hand-rolled `UserData` stub. */
export function exerciseLookupOver(
  courses: LocalCourseData[],
): (id: ExerciseIdentifier) => Result<StoredExercise, Error> {
  return (id) => {
    for (const course of courses) {
      const exercise = LocalCourseData.getExercises(course).find(
        (x) => ExerciseIdentifier.key(LocalCourseExercise.getId(x)) === ExerciseIdentifier.key(id),
      )
      if (exercise) {
        return Ok({ course, exercise })
      }
    }
    return Err(new Error(`No stored exercise ${ExerciseIdentifier.key(id)}`))
  }
}

import { Err, Ok } from "ts-results"

import { checkForExerciseUpdates } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier, makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import type { UserDataMockValues } from "../mocks/userdata"
import { createUserDataMock } from "../mocks/userdata"

// The default userData mock exposes a single tmc course (id 0) whose exercises
// are `1: hello_world` and `2: other_world`.
const tmcOutdated = {
  courseId: CourseIdentifier.from(0),
  exerciseId: ExerciseIdentifier.from(2),
  exerciseName: "other_world",
}

const moocCourse: MoocLocalCourseData = {
  id: "instance-uuid-1",
  name: "mooc-python-course",
  title: "Mooc Python",
  description: null,
  organization: "mooc",
  exercises: [
    {
      id: "mooc-ex-1",
      name: "mooc_hello",
      availablePoints: 1,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    },
  ],
  availablePoints: 1,
  awardedPoints: 0,
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: false,
  materialUrl: null,
}

const moocOutdated = {
  courseId: CourseIdentifier.from("instance-uuid-1"),
  exerciseId: ExerciseIdentifier.from("mooc-ex-1"),
  exerciseName: "mooc_hello",
}

suite("checkForExerciseUpdates action", function () {
  const stubContext = createMockActionContext()

  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userDataMock: UserData
  let userDataMockValues: UserDataMockValues

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(tmcMock),
    userData: new Ok(userDataMock),
  })

  beforeEach(function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[userDataMock, userDataMockValues] = createUserDataMock()
  })

  test("should return exercise updates", async function () {
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).toEqual([tmcOutdated])
  })

  test("should respect forceRefresh option", async function () {
    for (const forceRefresh of [true, false]) {
      await checkForExerciseUpdates(actionContext(), { forceRefresh })
      expect(tmcMock.checkTmcExerciseUpdates).toHaveBeenCalledWith(
        expect.objectContaining({ forceRefresh }),
      )
      expect(tmcMock.checkMoocExerciseUpdates).toHaveBeenCalledWith(
        expect.objectContaining({ forceRefresh }),
      )
    }
  })

  test("should return empty array when there are no updates", async function () {
    tmcMockValues.checkExerciseUpdates = Ok([])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).toEqual([])
  })

  test("should filter out unknown exercise ids", async function () {
    tmcMockValues.checkExerciseUpdates = Ok([{ id: 2 }, { id: 404 }])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).toEqual([tmcOutdated])
  })

  test("should combine tmc and mooc updates across courses", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    tmcMockValues.checkMoocExerciseUpdates = Ok(["mooc-ex-1"])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).toEqual([tmcOutdated, moocOutdated])
  })

  test("should NOT discard mooc results when the tmc check fails", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    tmcMockValues.checkExerciseUpdates = Err(new Error())
    tmcMockValues.checkMoocExerciseUpdates = Ok(["mooc-ex-1"])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.ok).toBe(true)
    expect(result.val).toEqual([moocOutdated])
  })

  test("should NOT discard tmc results when the mooc check fails", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    tmcMockValues.checkMoocExerciseUpdates = Err(new Error())
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.ok).toBe(true)
    expect(result.val).toEqual([tmcOutdated])
  })

  test("should skip the mooc check entirely when not authenticated", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    tmcMockValues.isMoocAuthenticated = Ok(false)
    tmcMockValues.checkMoocExerciseUpdates = Ok(["mooc-ex-1"])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).toEqual([tmcOutdated])
    expect(tmcMock.checkMoocExerciseUpdates).not.toHaveBeenCalled()
  })

  test("should not error when the mooc auth check itself fails", async function () {
    tmcMockValues.isMoocAuthenticated = Err(new Error())
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.ok).toBe(true)
    expect(result.val).toEqual([tmcOutdated])
    expect(tmcMock.checkMoocExerciseUpdates).not.toHaveBeenCalled()
  })
})

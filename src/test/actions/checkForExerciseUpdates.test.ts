import { Err, Ok } from "ts-results"

import type { LocalCourseData } from "../../../shared/lib"
import { makeMoocKind } from "../../../shared/lib"
import { checkForExerciseUpdates } from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type { UserData } from "../../config/userdata"
import type { MoocLocalCourseData } from "../../storage/data"
import { moocCourseData, moocCourseExercise } from "../fixtures/courses"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import type { UserDataMockValues } from "../mocks/userdata"
import { createUserDataMock } from "../mocks/userdata"

// The default userData mock exposes a single tmc course (id 0) whose exercises
// are `1: hello_world` and `2: other_world`.
const tmcOutdated = {
  courseId: idOfTmcCourse(0),
  exerciseId: idOfTmcExercise(2),
  exerciseName: "other_world",
}

const moocCourse: MoocLocalCourseData = moocCourseData({
  id: "instance-uuid-1",
  name: "mooc-python-course",
  title: "Mooc Python",
  availablePoints: 1,
  exercises: [moocCourseExercise({ id: "mooc-ex-1", name: "mooc_hello" })],
})

const moocOutdated = {
  courseId: idOfMoocCourse("instance-uuid-1"),
  exerciseId: idOfMoocExercise("mooc-ex-1"),
  exerciseName: "mooc_hello",
}

suite("checkForExerciseUpdates action", function () {
  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userDataMock: UserData
  let userDataMockValues: UserDataMockValues

  const actionContext = (): ReadyActionContext =>
    createMockActionContext({ startup: { langs: tmcMock, userData: userDataMock } })

  beforeEach(function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[userDataMock, userDataMockValues] = createUserDataMock()
  })

  test("should return exercise updates", async function () {
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([tmcOutdated])
  })

  test("should respect forceRefresh option", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    for (const forceRefresh of [true, false]) {
      await checkForExerciseUpdates(actionContext(), { forceRefresh })
      expect(tmcMock.checkExerciseUpdates).toHaveBeenCalledWith(
        "tmc",
        expect.objectContaining({ forceRefresh }),
      )
      expect(tmcMock.checkExerciseUpdates).toHaveBeenCalledWith(
        "mooc",
        expect.objectContaining({ forceRefresh }),
      )
    }
  })

  test("should return empty array when there are no updates", async function () {
    tmcMockValues.tmcExerciseUpdates = Ok([])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([])
  })

  test("should filter out unknown exercise ids", async function () {
    tmcMockValues.tmcExerciseUpdates = Ok([idOfTmcExercise(2), idOfTmcExercise(404)])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([tmcOutdated])
  })

  test("should combine tmc and mooc updates across courses", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    tmcMockValues.moocExerciseUpdates = Ok([idOfMoocExercise("mooc-ex-1")])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([tmcOutdated, moocOutdated])
  })

  test("should NOT discard mooc results when the tmc check fails", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    const error = new Error("tmc down")
    tmcMockValues.tmcExerciseUpdates = Err(error)
    tmcMockValues.moocExerciseUpdates = Ok([idOfMoocExercise("mooc-ex-1")])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([moocOutdated])
    expect(result.failures).toEqual([{ backend: "tmc", error }])
  })

  test("should NOT discard tmc results when the mooc check fails", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    const error = new Error("mooc down")
    tmcMockValues.moocExerciseUpdates = Err(error)
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([tmcOutdated])
    expect(result.failures).toEqual([{ backend: "mooc", error }])
  })

  test("does not name a failed backend the user has no courses on", async function () {
    tmcMockValues.moocExerciseUpdates = Err(new Error("mooc down"))
    const result = await checkForExerciseUpdates(actionContext())
    expect(result).toEqual({ outdated: [tmcOutdated], failures: [] })
  })

  test("asks only the backends that hold some of the user's courses", async function () {
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.outdated).toEqual([tmcOutdated])
    expect(tmcMock.checkExerciseUpdates).not.toHaveBeenCalledWith("mooc", expect.anything())
  })

  test("checks the backends at once", async function () {
    userDataMockValues.getCourses = [
      ...userDataMockValues.getCourses,
      makeMoocKind(moocCourse) as LocalCourseData,
    ]
    const started: string[] = []
    vi.mocked(tmcMock.checkExerciseUpdates).mockImplementation(async (backend) => {
      started.push(backend)
      await Promise.resolve()
      started.push(`${backend} done`)
      return Ok([])
    })
    await checkForExerciseUpdates(actionContext())
    expect(started.slice(0, 2)).toEqual(["tmc", "mooc"])
  })
})

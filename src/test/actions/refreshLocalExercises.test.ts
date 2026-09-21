import { Err, Ok } from "ts-results"

import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import type { UserDataMockValues } from "../mocks/userdata"
import { createUserDataMock } from "../mocks/userdata"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"

suite("refreshLocalExercises action", function () {
  const stubContext = createMockActionContext()

  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userDataMock: UserData
  let userDataMockValues: UserDataMockValues
  let workspaceManagerMock: WorkspaceManager
  let workspaceManagerMockValues: WorkspaceManagerMockValues

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(tmcMock),
    userData: new Ok(userDataMock),
    workspaceManager: new Ok(workspaceManagerMock),
  })

  beforeEach(function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[userDataMock, userDataMockValues] = createUserDataMock()
    ;[workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock()
  })

  test("should set exercises to WorkspaceManager", async function () {
    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledTimes(1)
  })

  test("should work without any courses", async function () {
    userDataMockValues.getCourses = []
    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
  })

  test("should default to open when the settings are unreadable", async function () {
    tmcMockValues.listSettings = Err(new Error())
    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: ExerciseStatus.Open })]),
    )
  })

  test("should default to open when a closed-exercise setting is malformed", async function () {
    tmcMockValues.listSettings = Ok({
      "closed-exercises-for:tmc:test-python-course": { notAnArray: true },
    })
    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: ExerciseStatus.Open })]),
    )
  })

  test("should close the exercises the settings list as closed", async function () {
    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ exerciseSlug: "other_world", status: ExerciseStatus.Closed }),
      ]),
    )
  })

  test("should not replace the known exercises when the listing fails", async function () {
    // A failed listing says nothing about what is on disk; setting an empty list
    // would drop every exercise out of the workspace.
    tmcMockValues.listLocalExercises = Err(new Error())
    const result = await refreshLocalExercises(actionContext())
    expect(result.err).toBe(true)
    expect(workspaceManagerMock.setExercises).not.toHaveBeenCalled()
  })

  test("should return error if WorkspaceManager operation fails", async function () {
    workspaceManagerMockValues.setExercises = Err(new Error())
    const result = await refreshLocalExercises(actionContext())
    expect(result.val).toBeInstanceOf(Error)
  })

  test("should set mooc course exercises with the mooc backend", async function () {
    const moocCourse: MoocLocalCourseData = {
      id: "course-uuid-1",
      name: "mooc-python-course",
      title: "Mooc Python",
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
    }
    userDataMockValues.getCourses = [makeMoocKind(moocCourse) as LocalCourseData]
    // A mooc entry is matched to its course by course id, since its on-disk slug
    // is derived locally and need not equal the course name the workspace uses.
    tmcMockValues.listLocalExercises = Ok([
      {
        backend: "mooc",
        "course-slug": "mooc-python-course-2",
        "course-id": "course-uuid-1",
        "exercise-slug": "mooc_hello",
        "exercise-id": "exercise-uuid-1",
        "exercise-path": "/mooc/hello",
      },
    ])

    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledWith([
      expect.objectContaining({
        backend: "mooc",
        courseSlug: "mooc-python-course",
        exerciseSlug: "mooc_hello",
        status: ExerciseStatus.Open,
      }),
    ])
  })

  test("should list every course's exercises in one call", async function () {
    await refreshLocalExercises(actionContext())
    expect(tmcMock.listLocalExercises).toHaveBeenCalledTimes(1)
  })

  test("should read every course's closed exercises in one call", async function () {
    await refreshLocalExercises(actionContext())
    expect(tmcMock.listSettings).toHaveBeenCalledTimes(1)
    expect(tmcMock.getSetting).not.toHaveBeenCalled()
  })
})

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

  test("should tolerate Langs errors", async function () {
    tmcMockValues.getSettingClosedExercises = Err(new Error())
    tmcMockValues.listLocalCourseExercisesPythonCourse = Err(new Error())
    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
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
    // The mooc local listing is looked up by course id (UUID), since mooc configs
    // store no slug. The display slug stays the course name.
    tmcMock.listLocalCourseExercises = vi.fn(async (backend: string, courseId: string) =>
      backend === "mooc" && courseId === "course-uuid-1"
        ? Ok([
            {
              "exercise-slug": "mooc_hello",
              "exercise-id": "exercise-uuid-1",
              "exercise-path": "/mooc/hello",
            },
          ])
        : Err(new Error("not mocked")),
    ) as Langs["listLocalCourseExercises"]

    const result = await refreshLocalExercises(actionContext())
    expect(result).toBe(Ok.EMPTY)
    expect(tmcMock.listLocalCourseExercises).toHaveBeenCalledWith("mooc", "course-uuid-1")
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledWith([
      expect.objectContaining({
        backend: "mooc",
        courseSlug: "mooc-python-course",
        exerciseSlug: "mooc_hello",
        status: ExerciseStatus.Open,
      }),
    ])
  })
})

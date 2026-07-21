import { Err, Ok } from "ts-results"

import type { ActionContext } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { UserData } from "../../config/userdata"
import { ConnectionError, ForbiddenError } from "../../errors"
import { TmcPanel } from "../../panels/TmcPanel"
import { CourseIdentifier } from "../../shared/shared"
import Storage from "../../storage"
import type { MoocLocalCourseData } from "../../storage/data"
import { MOOC_EXERCISE_UUID } from "../fixtures/tmc"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createMockContext } from "../mocks/vscode"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"
import { autoMock } from "../support/mock"

const moocCourse: MoocLocalCourseData = {
  id: "instance-uuid-1",
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

suite("updateCourse action (mooc)", function () {
  const stubContext = createMockActionContext()
  const courseId = CourseIdentifier.from("instance-uuid-1")

  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userData: UserData
  let workspaceManagerMock: WorkspaceManager

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(tmcMock),
    userData: new Ok(userData),
    workspaceManager: new Ok(workspaceManagerMock),
    exerciseDecorationProvider: new Ok(autoMock()),
  })

  beforeEach(async function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[workspaceManagerMock] = createWorkspaceMangerMock()
    const storage = new Storage(createMockContext())
    await storage.updateUserData({ courses: [], mooc_courses: [{ ...moocCourse }] })
    userData = new UserData(storage)
    vi.spyOn(TmcPanel, "postMessage").mockImplementation(async () => {})
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("maps course slides into local mooc exercises keyed by exercise id", async function () {
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(true)
    const stored = userData.getMoocCourses()[0]
    // Keyed by the slide's exercise id (matches what the bulk download subcommand
    // resolves `--exercise-id` against), not the task id.
    expect(stored?.exercises.map((e) => e.id)).toEqual([MOOC_EXERCISE_UUID])
    expect(stored?.exercises[0]?.name).toBe("mooc_hello")
  })

  test("populates exercise and course points from the user's course progress", async function () {
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(true)
    const stored = userData.getMoocCourses()[0]
    // Fixture: passed, 1/1 points.
    expect(stored?.exercises[0]?.passed).toBe(true)
    expect(stored?.exercises[0]?.awardedPoints).toBe(1)
    expect(stored?.exercises[0]?.availablePoints).toBe(1)
    expect(stored?.awardedPoints).toBe(1)
    expect(stored?.availablePoints).toBe(1)
  })

  test("a failed progress fetch preserves previously known progress", async function () {
    await updateCourse(actionContext(), courseId)
    expect(userData.getMoocCourses()[0]?.exercises[0]?.passed).toBe(true)

    tmcMockValues.getMoocCourseProgress = Err(new Error("transient"))
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(true)
    const stored = userData.getMoocCourses()[0]
    expect(stored?.exercises[0]?.passed).toBe(true)
    expect(stored?.exercises[0]?.awardedPoints).toBe(1)
    expect(stored?.awardedPoints).toBe(1)
  })

  test("marks the course disabled on a ForbiddenError and reports offline", async function () {
    tmcMockValues.getMoocCourseInstanceData = Err(new ForbiddenError("nope"))
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(false)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(true)
  })

  test("returns offline (not disabled) on a ConnectionError", async function () {
    tmcMockValues.getMoocCourseInstanceData = Err(new ConnectionError("down"))
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(false)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
  })
})

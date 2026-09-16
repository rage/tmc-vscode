import { Err, Ok } from "ts-results"

import type { ActionContext } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { UserData } from "../../config/userdata"
import { ConnectionError, InsufficientScopeError } from "../../errors"
import { TmcPanel } from "../../panels/TmcPanel"
import { CourseIdentifier } from "../../shared/shared"
import Storage from "../../storage"
import type { MoocLocalCourseData } from "../../storage/data"
import { Logger } from "../../utilities"
import { MOOC_EXERCISE_UUID, moocCourseInstance, moocExerciseSlides } from "../fixtures/tmc"
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

  // A context whose dialog is nobody else's, so its call count is this call's alone.
  function contextWithOwnDialog(): { context: ActionContext; dialog: Dialog } {
    const dialog = autoMock<Dialog>()
    return { context: { ...actionContext(), dialog }, dialog }
  }

  // Replaces the stored course, for a test that needs it in some other starting state.
  async function storeCourse(course: MoocLocalCourseData): Promise<void> {
    const storage = new Storage(createMockContext())
    await storage.updateUserData({ courses: [], mooc_courses: [{ ...course }] })
    userData = new UserData(storage)
  }

  beforeEach(async function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[workspaceManagerMock] = createWorkspaceMangerMock()
    await storeCourse(moocCourse)
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

  test("refreshes the course metadata that the backend can change", async function () {
    // The mooc arm used to discard the fetched course entirely and write back only
    // points, so a renamed or re-described course stayed stale forever. The stored
    // fixture deliberately disagrees with the fetched one on every field here.
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(true)
    const stored = userData.getMoocCourses()[0]
    expect(stored?.description).toBe("A mooc course")
    expect(stored?.title).toBe("Mooc Python")
    expect(stored?.organization).toBe("University of Helsinki")
    // The slug keys the workspace folder and the closed-exercise settings, so it
    // must NOT be adopted from the fetched course without an accompanying move.
    expect(stored?.name).toBe("mooc-python-course")
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

  test("leaves the course alone when the session lacks the exercise scope", async function () {
    // The mooc backend 403s an underscoped token, which says nothing about the course --
    // and the mooc arm never clears `disabled`, so persisting it here would be permanent.
    tmcMockValues.getMoocCourseInstanceData = Err(new InsufficientScopeError("no scope"))

    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(false)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
  })

  test("offers a login once per lapse, and again once the session is renewed", async function () {
    // A success first, so the report latch starts in a known state.
    await updateCourse(actionContext(), courseId)
    tmcMockValues.getMoocCourseInstanceData = Err(new InsufficientScopeError("no scope"))

    const first = contextWithOwnDialog()
    await updateCourse(first.context, courseId)
    expect(first.dialog.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("no scope"),
      expect.any(InsufficientScopeError),
      ["Log in", expect.any(Function)],
    )

    // updateCourse runs once per course and from a background poll, so a second
    // failure must stay quiet.
    const repeat = contextWithOwnDialog()
    await updateCourse(repeat.context, courseId)
    expect(repeat.dialog.errorNotification).not.toHaveBeenCalled()

    tmcMockValues.getMoocCourseInstanceData = Ok([moocCourseInstance, moocExerciseSlides])
    await updateCourse(actionContext(), courseId)
    tmcMockValues.getMoocCourseInstanceData = Err(new InsufficientScopeError("no scope"))

    const afterRenewal = contextWithOwnDialog()
    await updateCourse(afterRenewal.context, courseId)
    expect(afterRenewal.dialog.errorNotification).toHaveBeenCalledTimes(1)
  })

  test("clears a disabled flag an earlier failure persisted", async function () {
    // `disabled` has no mooc equivalent, so nothing else would ever lift it.
    await storeCourse({ ...moocCourse, disabled: true })

    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(true)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
  })

  test("returns offline (not disabled) on a ConnectionError", async function () {
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {})
    tmcMockValues.getMoocCourseInstanceData = Err(new ConnectionError("down"))
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(false)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("courses.mooc.fi"))
  })
})

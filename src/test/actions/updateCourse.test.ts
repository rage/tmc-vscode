import { Err, Ok } from "ts-results"

import type { ActionContext } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { UserData } from "../../config/userdata"
import { ConnectionError, ForbiddenError, InsufficientScopeError } from "../../errors"
import { TmcPanel } from "../../panels/TmcPanel"
import type {
  CombinedCourseData,
  CourseData,
  CourseExercise,
  Exercise,
} from "../../shared/langsSchema"
import { CourseIdentifier } from "../../shared/shared"
import Storage from "../../storage"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../../storage/data"
import { Logger } from "../../utilities"
import { MOOC_EXERCISE_UUID, moocCourse, moocExerciseSlides } from "../fixtures/tmc"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createMockContext } from "../mocks/vscode"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"
import { autoMock } from "../support/mock"

const storedMoocCourse: MoocLocalCourseData = {
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

suite("updateCourse action (mooc)", function () {
  const stubContext = createMockActionContext()
  const courseId = CourseIdentifier.from("course-uuid-1")

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
    await storeCourse(storedMoocCourse)
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
    tmcMockValues.getMoocCourseData = Err(new InsufficientScopeError("no scope"))

    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(false)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
  })

  test("offers a login once per lapse, and again once the session is renewed", async function () {
    // A success first, so the report latch starts in a known state.
    await updateCourse(actionContext(), courseId)
    tmcMockValues.getMoocCourseData = Err(new InsufficientScopeError("no scope"))

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

    tmcMockValues.getMoocCourseData = Ok([moocCourse, moocExerciseSlides])
    await updateCourse(actionContext(), courseId)
    tmcMockValues.getMoocCourseData = Err(new InsufficientScopeError("no scope"))

    const afterRenewal = contextWithOwnDialog()
    await updateCourse(afterRenewal.context, courseId)
    expect(afterRenewal.dialog.errorNotification).toHaveBeenCalledTimes(1)
  })

  test("clears a disabled flag an earlier failure persisted", async function () {
    // `disabled` has no mooc equivalent, so nothing else would ever lift it.
    await storeCourse({ ...storedMoocCourse, disabled: true })

    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(true)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
  })

  test("returns offline (not disabled) on a ConnectionError", async function () {
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {})
    tmcMockValues.getMoocCourseData = Err(new ConnectionError("down"))
    const result = await updateCourse(actionContext(), courseId)
    expect(result.val).toBe(false)
    expect(userData.getMoocCourses()[0]?.disabled).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("courses.mooc.fi"))
  })
})

const tmcCourse: TmcLocalCourseData = {
  id: 1,
  name: "test-python-course",
  title: "Stale title",
  description: "Stale description",
  organization: "test",
  exercises: [],
  availablePoints: 0,
  awardedPoints: 0,
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: true,
  materialUrl: null,
}

const tmcExerciseDefaults: Omit<Exercise, "id" | "name" | "completed"> = {
  all_review_points_given: false,
  attempted: true,
  checksum: "checksum",
  code_review_requests_enabled: false,
  deadline: null,
  deadline_description: null,
  latest_submission_id: null,
  latest_submission_url: null,
  locked: false,
  memory_limit: null,
  requires_review: false,
  return_url: "",
  returnable: true,
  reviewed: false,
  run_tests_locally_action_enabled: true,
  runtime_params: [],
  soft_deadline: null,
  soft_deadline_description: null,
  solution_zip_url: null,
  valgrind_strategy: null,
  zip_url: "",
}

const tmcCourseSettings: CourseData = {
  cache_version: null,
  certificate_downloadable: null,
  certificate_unlock_spec: null,
  course_template_id: null,
  description: null,
  disabled_status: "enabled",
  external_scoreboard_url: null,
  formal_name: null,
  hidden: false,
  hidden_if_registered_after: null,
  hide_after: null,
  hide_submission_results: false,
  locked_exercise_points_visible: true,
  material_url: "https://materials.example/test-python-course",
  name: "test-python-course",
  organization_id: null,
  organization_slug: "test",
  paste_visibility: null,
  refreshed_at: null,
  spreadsheet_key: null,
  title: "Test Python Course",
}

/** A points-endpoint entry: `awarded` of the exercise's `available` points are scored. */
function tmcCourseExercise(id: number, available: number, awarded: number): CourseExercise {
  const pointNames = Array.from({ length: available }, (_, i) => `${id}.${i + 1}`)
  return {
    available_points: pointNames.map((name, i) => ({
      exercise_id: id,
      id: id * 100 + i,
      name,
      requires_review: false,
    })),
    awarded_points: pointNames.slice(0, awarded),
    deadline: null,
    disabled: false,
    id,
    name: `exercise_${id}`,
    publish_time: null,
    soft_deadline: null,
    solution_visible_after: null,
    unlocked: true,
  }
}

/**
 * The tmc course as the two endpoints report it: exercise 1 is listed by both, while
 * exercises 2 and 3 are listed only by the details endpoint, so they fall back to
 * placeholder points — unpassed and passed respectively.
 */
const tmcCourseData: CombinedCourseData = {
  details: {
    comet_url: "",
    description: "A tmc course",
    details_url: "",
    exercises: [
      { ...tmcExerciseDefaults, id: 1, name: "exercise_1", completed: true },
      { ...tmcExerciseDefaults, id: 2, name: "exercise_2", completed: false },
      { ...tmcExerciseDefaults, id: 3, name: "exercise_3", completed: true },
    ],
    id: 1,
    name: "test-python-course",
    reviews_url: "",
    spyware_urls: [],
    title: "Test Python Course",
    unlock_url: "",
    unlockables: [],
  },
  exercises: [tmcCourseExercise(1, 2, 2)],
  settings: tmcCourseSettings,
}

suite("updateCourse action (tmc)", function () {
  const stubContext = createMockActionContext()
  const courseId = CourseIdentifier.from(1)

  let langsMock: Langs
  let getTmcCourseData: ReturnType<typeof vi.fn>
  let userData: UserData
  let workspaceManagerMock: WorkspaceManager

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(langsMock),
    userData: new Ok(userData),
    workspaceManager: new Ok(workspaceManagerMock),
    exerciseDecorationProvider: new Ok(autoMock()),
  })

  beforeEach(async function () {
    ;[langsMock] = createTMCMock()
    getTmcCourseData = vi.fn(async () => Ok(tmcCourseData))
    ;(langsMock as unknown as { getTmcCourseData: unknown }).getTmcCourseData = getTmcCourseData
    ;[workspaceManagerMock] = createWorkspaceMangerMock()
    const storage = new Storage(createMockContext())
    await storage.updateUserData({ courses: [{ ...tmcCourse }], mooc_courses: [] })
    userData = new UserData(storage)
    vi.spyOn(TmcPanel, "postMessage").mockImplementation(async () => {})
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("refreshes the course metadata the tmc server owns", async function () {
    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(true)
    const stored = userData.getTmcCourses()[0]
    expect(stored?.description).toBe("A tmc course")
    expect(stored?.materialUrl).toBe("https://materials.example/test-python-course")
    expect(stored?.perhapsExamMode).toBe(false)
    // `disabled_status` is the authority, so an enabled course lifts a stale flag.
    expect(stored?.disabled).toBe(false)
  })

  test("takes the course totals from the points endpoint, not the combined exercises", async function () {
    // Exercise 2 is missing from the points endpoint and so carries placeholder
    // points; folding those into the totals would overstate what the course is worth.
    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(true)
    const stored = userData.getTmcCourses()[0]
    expect(stored?.availablePoints).toBe(2)
    expect(stored?.awardedPoints).toBe(2)
  })

  test("falls back to placeholder points for an exercise the points endpoint omits", async function () {
    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(true)
    const stored = userData.getTmcCourses()[0]
    const [first, second, third] = stored?.exercises ?? []
    expect(first).toMatchObject({ id: 1, availablePoints: 2, awardedPoints: 2, passed: true })
    // Unlisted: one placeholder point, awarded only if the exercise is completed.
    expect(second).toMatchObject({ id: 2, availablePoints: 1, awardedPoints: 0, passed: false })
    expect(third).toMatchObject({ id: 3, availablePoints: 1, awardedPoints: 1, passed: true })
  })

  test("marks the course disabled when the server refuses it", async function () {
    await storeEnabledTmcCourse()
    getTmcCourseData.mockResolvedValue(Err(new ForbiddenError("forbidden")))

    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(false)
    expect(userData.getTmcCourses()[0]?.disabled).toBe(true)
  })

  test("returns offline (not disabled) on a ConnectionError", async function () {
    await storeEnabledTmcCourse()
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {})
    getTmcCourseData.mockResolvedValue(Err(new ConnectionError("down")))

    const result = await updateCourse(actionContext(), courseId)

    expect(result.val).toBe(false)
    expect(userData.getTmcCourses()[0]?.disabled).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TMC Server"))
  })

  // The failure arms must start from an enabled course, or "still disabled" and
  // "just disabled" are indistinguishable.
  async function storeEnabledTmcCourse(): Promise<void> {
    const storage = new Storage(createMockContext())
    await storage.updateUserData({ courses: [{ ...tmcCourse, disabled: false }], mooc_courses: [] })
    userData = new UserData(storage)
  }
})

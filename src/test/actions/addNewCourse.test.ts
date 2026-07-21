import { Err, Ok } from "ts-results"

import { addNewCourse } from "../../actions/addNewCourse"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { UserData } from "../../config/userdata"
import { CourseIdentifier } from "../../shared/shared"
import Storage from "../../storage"
import type UI from "../../ui/ui"
import { MOOC_EXERCISE_UUID, MOOC_INSTANCE_UUID, moocCourseInstance } from "../fixtures/tmc"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createMockContext } from "../mocks/vscode"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"

suite("addNewCourse action (mooc)", function () {
  const stubContext = createMockActionContext()

  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userData: UserData
  let workspaceManagerMock: WorkspaceManager
  let uiMock: UI
  let addChildWithId: ReturnType<typeof vi.fn>
  let createWorkspaceFile: ReturnType<typeof vi.fn>

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(tmcMock),
    userData: new Ok(userData),
    workspaceManager: new Ok(workspaceManagerMock),
    ui: uiMock,
  })

  beforeEach(async function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[workspaceManagerMock] = createWorkspaceMangerMock()
    createWorkspaceFile = vi.fn()
    workspaceManagerMock.createWorkspaceFile = createWorkspaceFile as never
    addChildWithId = vi.fn()
    uiMock = { treeDP: { addChildWithId } } as unknown as UI
    const storage = new Storage(createMockContext())
    await storage.updateUserData({ courses: [], mooc_courses: [] })
    userData = new UserData(storage)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("constructs MoocLocalCourseData from the fetched course instance", async function () {
    const result = await addNewCourse(
      actionContext(),
      "unused-org-slug",
      CourseIdentifier.from(MOOC_INSTANCE_UUID),
    )
    expect(result.ok).toBe(true)
    const stored = userData.getMoocCourses()[0]
    // The course id is the sole client-side course key.
    expect(stored?.id).toBe(moocCourseInstance.id)
    expect(stored?.name).toBe(moocCourseInstance.slug)
    expect(stored?.title).toBe(moocCourseInstance.name)
    // Organization comes from organization_name, not the passed slug.
    expect(stored?.organization).toBe(moocCourseInstance.organization_name)
    expect(createWorkspaceFile).toHaveBeenCalledWith(moocCourseInstance.slug, "mooc")
    expect(addChildWithId).toHaveBeenCalledTimes(1)
    // The fetched exercise slides are recorded, keyed by their exercise id (the
    // identity the bulk download subcommand resolves `--exercise-id` against),
    // so the course-details view can render them for download.
    expect(stored?.exercises.map((e) => e.id)).toEqual([MOOC_EXERCISE_UUID])
    expect(stored?.exercises[0]?.name).toBe("mooc_hello")
    // Points and passed state come from `mooc course-progress` (fixture: passed, 1/1).
    expect(stored?.exercises[0]?.passed).toBe(true)
    expect(stored?.awardedPoints).toBe(1)
    expect(stored?.availablePoints).toBe(1)
  })

  test("a failed progress fetch still adds the course, with zeroed progress", async function () {
    tmcMockValues.getMoocCourseProgress = Err(new Error("transient"))
    const result = await addNewCourse(
      actionContext(),
      "unused-org-slug",
      CourseIdentifier.from(MOOC_INSTANCE_UUID),
    )
    expect(result.ok).toBe(true)
    const stored = userData.getMoocCourses()[0]
    expect(stored?.exercises[0]?.passed).toBe(false)
    expect(stored?.awardedPoints).toBe(0)
    expect(stored?.availablePoints).toBe(0)
  })

  test("propagates a Langs error and adds no course", async function () {
    tmcMockValues.getMoocCourseInstanceData = Err(new Error("boom"))
    const result = await addNewCourse(
      actionContext(),
      "unused-org-slug",
      CourseIdentifier.from(MOOC_INSTANCE_UUID),
    )
    expect(result.err).toBe(true)
    expect(userData.getMoocCourses()).toEqual([])
  })

  test("re-adding an already-added course fails gracefully instead of throwing", async function () {
    // Add the course once.
    const first = await addNewCourse(
      actionContext(),
      "unused-org-slug",
      CourseIdentifier.from(MOOC_INSTANCE_UUID),
    )
    expect(first.ok).toBe(true)
    expect(userData.getMoocCourses()).toHaveLength(1)

    // Adding the same course id again must return an Err, not throw (the
    // underlying addCourse throws on a duplicate id).
    let second: Awaited<ReturnType<typeof addNewCourse>> | undefined
    await expect(
      (async () => {
        second = await addNewCourse(
          actionContext(),
          "unused-org-slug",
          CourseIdentifier.from(MOOC_INSTANCE_UUID),
        )
      })(),
    ).resolves.not.toThrow()
    expect(second?.err).toBe(true)
    // still only one course stored
    expect(userData.getMoocCourses()).toHaveLength(1)
  })
})

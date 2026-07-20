import { Err, Ok } from "ts-results"

import { addNewCourse } from "../../actions/addNewCourse"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { UserData } from "../../config/userdata"
import { CourseIdentifier } from "../../shared/shared"
import Storage from "../../storage"
import type UI from "../../ui/ui"
import { MOOC_INSTANCE_UUID, moocCourseInstance } from "../fixtures/tmc"
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
    // The course id is mapped into both id and courseId.
    expect(stored?.id).toBe(moocCourseInstance.id)
    expect(stored?.courseId).toBe(moocCourseInstance.id)
    expect(stored?.name).toBe(moocCourseInstance.slug)
    expect(stored?.title).toBe(moocCourseInstance.name)
    // Organization comes from organization_name, not the passed slug.
    expect(stored?.organization).toBe(moocCourseInstance.organization_name)
    expect(createWorkspaceFile).toHaveBeenCalledWith(moocCourseInstance.slug)
    expect(addChildWithId).toHaveBeenCalledTimes(1)
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
})

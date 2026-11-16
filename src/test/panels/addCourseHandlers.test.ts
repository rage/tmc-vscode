import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { MoocCourse, Organization } from "../../../shared/langsSchema"
import type { AddCoursePanel, CourseIdentifier, Panel } from "../../../shared/lib"
import { CourseIdentifier as CourseIdentifiers } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { MOOC_BACKEND_URL } from "../../config/constants"
import type { UserData } from "../../config/userdata"
import { AuthorizationError, ConnectionError } from "../../errors"
import { addCourseHandlers } from "../../panels/handlers/addCourse"
import type { PanelHost } from "../../panels/router"
import { openWebLink } from "../../utilities"
import { idOfMoocCourse, idOfTmcCourse } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions", () => ({
  MOOC_LOGIN: "mooc-login",
  listEnrolledMoocCourses: vi.fn(),
  listTmcOrganizations: vi.fn(),
  listOrganizationCourses: vi.fn(),
  addNewCourse: vi.fn(async () => Ok.EMPTY),
}))
vi.mock("../../utilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utilities")>()),
  openWebLink: vi.fn(async () => true),
}))

const MOOC_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const MOOC_COURSE: MoocCourse = {
  id: MOOC_UUID,
  name: "Introduction to everything",
  slug: "introduction-to-everything",
  organization_name: "University of Helsinki",
  description: "  Everything, briefly.  ",
  ai_policy: "not_set",
}

function organization(slug: string, name: string, pinned = false): Organization {
  return { slug, name, information: "", logo_path: "", pinned }
}

let nextId = 100

function addCoursePanel(): AddCoursePanel {
  nextId += 1
  return { id: nextId, type: "AddCourse" }
}

function host(route: Panel | undefined): PanelHost {
  return {
    name: "Main webview",
    route,
    isVisible: true,
    post: vi.fn(),
    closeSidePanel: vi.fn(),
    showBeside: vi.fn(),
  }
}

/** A context whose user has added `added`. */
function context(added: CourseIdentifier[] = []): ReadyActionContext {
  const keys = new Set(added.map((id) => CourseIdentifiers.key(id)))
  return createMockActionContext({
    startup: {
      userData: {
        getCourse: (id: CourseIdentifier) =>
          keys.has(CourseIdentifiers.key(id)) ? Ok({}) : Err(new Error("No such course.")),
      } as unknown as UserData,
    },
  })
}

function request<K extends "requestMoocCatalog" | "requestTmcOrganizations">(
  type: K,
  panel: AddCoursePanel,
): { type: K; requestId: number; sourcePanel: { id: number; type: "AddCourse" } } {
  return { type, requestId: 1, sourcePanel: { id: panel.id, type: panel.type } }
}

async function listMooc(actionContext: ReadyActionContext, panel: AddCoursePanel) {
  return addCourseHandlers.requestMoocCatalog.handle(request("requestMoocCatalog", panel), {
    host: host(panel),
    actionContext,
  })
}

async function listOrganizations(actionContext: ReadyActionContext, panel: AddCoursePanel) {
  return addCourseHandlers.requestTmcOrganizations.handle(
    request("requestTmcOrganizations", panel),
    { host: host(panel), actionContext },
  )
}

async function listTmcCourses(
  actionContext: ReadyActionContext,
  panel: AddCoursePanel,
  organizationSlug: string,
) {
  return addCourseHandlers.requestTmcCourses.handle(
    {
      type: "requestTmcCourses",
      requestId: 1,
      sourcePanel: { id: panel.id, type: panel.type },
      organizationSlug,
    },
    { host: host(panel), actionContext },
  )
}

async function add(
  actionContext: ReadyActionContext,
  panel: AddCoursePanel,
  key: string,
  shown: Panel | undefined = panel,
) {
  return addCourseHandlers.addCourse.handle(
    { type: "addCourse", requestId: 1, sourcePanel: { id: panel.id, type: panel.type }, key },
    { host: host(shown), actionContext },
  )
}

suite("the add-course screen's handlers", function () {
  beforeEach(function () {
    vi.clearAllMocks()
    vi.mocked(actions.listEnrolledMoocCourses).mockResolvedValue(Ok([MOOC_COURSE]))
    vi.mocked(actions.listTmcOrganizations).mockResolvedValue(
      Ok([organization("hy", "University of Helsinki"), organization("mooc", "MOOC", true)]),
    )
    vi.mocked(actions.listOrganizationCourses).mockResolvedValue(
      Ok([
        {
          id: 7,
          name: "hy-python-2026",
          title: "Python Programming 2026",
          description: null,
          details_url: "",
          unlock_url: "",
          reviews_url: "",
          comet_url: "",
          spyware_urls: [],
        },
      ]),
    )
  })

  test("lists the enrolled courses.mooc.fi courses, marking the added ones", async function () {
    const panel = addCoursePanel()

    const listed = await listMooc(context([idOfMoocCourse(MOOC_UUID)]), panel)

    expect(listed.unwrap()).toEqual({
      kind: "listed",
      items: [
        {
          key: CourseIdentifiers.key(idOfMoocCourse(MOOC_UUID)),
          name: "Introduction to everything",
          organization: "University of Helsinki",
          description: "Everything, briefly.",
          isAdded: true,
        },
      ],
    })
  })

  test("says courses.mooc.fi needs a login, and passes on its failures", async function () {
    const panel = addCoursePanel()
    vi.mocked(actions.listEnrolledMoocCourses).mockResolvedValueOnce(actions.MOOC_LOGIN)
    expect((await listMooc(context(), panel)).unwrap()).toEqual({ kind: "loggedOut" })

    const error = new ConnectionError("dns error")
    vi.mocked(actions.listEnrolledMoocCourses).mockResolvedValueOnce(Err(error))
    expect((await listMooc(context(), panel)).val).toBe(error)
  })

  test("lists the TMC organizations, pinned first, or that they need a login", async function () {
    const panel = addCoursePanel()

    const listed = await listOrganizations(context(), panel)
    expect(listed.unwrap()).toEqual({
      kind: "listed",
      items: [
        { slug: "mooc", name: "MOOC" },
        { slug: "hy", name: "University of Helsinki" },
      ],
    })

    vi.mocked(actions.listTmcOrganizations).mockResolvedValueOnce(
      Err(new AuthorizationError("no session")),
    )
    expect((await listOrganizations(context(), panel)).unwrap()).toEqual({ kind: "loggedOut" })
  })

  test("lists the courses of an organization it listed, and of no other", async function () {
    const panel = addCoursePanel()
    const actionContext = context()

    expect((await listTmcCourses(actionContext, panel, "hy")).err).toBe(true)
    expect(actions.listOrganizationCourses).not.toHaveBeenCalled()

    await listOrganizations(actionContext, panel)
    const listed = await listTmcCourses(actionContext, panel, "hy")
    expect(listed.unwrap()).toEqual([
      {
        key: CourseIdentifiers.key(idOfTmcCourse(7)),
        name: "Python Programming 2026",
        organization: "University of Helsinki",
        isAdded: false,
      },
    ])
    expect(actions.listOrganizationCourses).toHaveBeenCalledWith(actionContext, "hy")
  })

  test("adds a listed course under its organization, then opens its course home", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const panel = addCoursePanel()
    const actionContext = context()
    await listOrganizations(actionContext, panel)
    await listTmcCourses(actionContext, panel, "hy")

    const added = await add(actionContext, panel, CourseIdentifiers.key(idOfTmcCourse(7)))

    expect(added.ok).toBe(true)
    expect(actions.addNewCourse).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      "hy",
      idOfTmcCourse(7),
    )
    expect(executeCommand).toHaveBeenLastCalledWith("tmc.courseDetails", idOfTmcCourse(7))
  })

  test("an added course is opened, not added again", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const panel = addCoursePanel()
    const actionContext = context([idOfMoocCourse(MOOC_UUID)])
    await listMooc(actionContext, panel)

    await add(actionContext, panel, CourseIdentifiers.key(idOfMoocCourse(MOOC_UUID)))

    expect(actions.addNewCourse).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      "tmc.courseDetails",
      idOfMoocCourse(MOOC_UUID),
    )
  })

  test("a failed add answers the screen and opens nothing", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const panel = addCoursePanel()
    const actionContext = context()
    await listMooc(actionContext, panel)
    const error = new ConnectionError("dns error")
    vi.mocked(actions.addNewCourse).mockResolvedValueOnce(Err(error))

    const added = await add(actionContext, panel, CourseIdentifiers.key(idOfMoocCourse(MOOC_UUID)))

    expect(added.val).toBe(error)
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalledWith("tmc.courseDetails", expect.anything())
  })

  test("adds only what the panel showing now listed", async function () {
    const panel = addCoursePanel()
    const actionContext = context()
    await listMooc(actionContext, panel)
    const key = CourseIdentifiers.key(idOfMoocCourse(MOOC_UUID))

    expect((await add(actionContext, panel, CourseIdentifiers.key(idOfTmcCourse(1)))).err).toBe(
      true,
    )
    expect((await add(actionContext, addCoursePanel(), key)).err).toBe(true)
    const help: Panel = { id: 1, type: "ErrorHelp", topic: { kind: "startup", failures: [] } }
    expect((await add(actionContext, panel, key, help)).err).toBe(true)
    expect(actions.addNewCourse).not.toHaveBeenCalled()
  })

  test("Log In goes on to adding a course, and Find a Course opens courses.mooc.fi", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const panel = addCoursePanel()
    const sourcePanel = { id: panel.id, type: panel.type }

    await addCourseHandlers.addCourseAction.handle({
      type: "addCourseAction",
      sourcePanel,
      action: "logIn",
    })
    await addCourseHandlers.addCourseAction.handle({
      type: "addCourseAction",
      sourcePanel,
      action: "findCourse",
    })

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith("tmc.showMoocLogin", {
      isAddingCourse: true,
    })
    expect(openWebLink).toHaveBeenCalledExactlyOnceWith(MOOC_BACKEND_URL)
  })
})

import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import {
  checkForCourseUpdates,
  logout,
  openWorkspace,
  refreshEverything,
  removeCourse,
} from "../../actions"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ActionContext } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import type { DialogMockValues } from "../mocks/dialog"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn(async () => Ok(true)),
}))

// The course-update pass ends by rescanning the exercises on disk, which would otherwise
// drive real CLI calls.
vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))

suite("logout action", function () {
  let dialogMock: Dialog
  let deauthenticate: ReturnType<typeof vi.fn>
  let deauthenticateMooc: ReturnType<typeof vi.fn>

  function actionContext(): ActionContext {
    const langs = {
      deauthenticate,
      deauthenticateMooc,
    } as unknown as Langs
    return {
      dialog: dialogMock,
      langs: new Ok(langs),
    } as unknown as ActionContext
  }

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    deauthenticate = vi.fn(async () => Ok.EMPTY)
    deauthenticateMooc = vi.fn(async () => Ok.EMPTY)
  })

  test("logs out of both backends when both succeed", async function () {
    const result = await logout(actionContext())
    expect(result.ok).toBe(true)
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
  })

  test("still attempts the mooc logout when the tmc logout fails", async function () {
    const error = new Error("tmc logout failed")
    deauthenticate = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.reportError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      error,
      "tmc",
    )
  })

  test("still attempts the tmc logout when the mooc logout fails, and reports it", async function () {
    const error = new Error("mooc logout failed")
    deauthenticateMooc = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.reportError).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      error,
      "mooc",
    )
  })

  test("still attempts the mooc logout when the tmc logout throws instead of returning an Err", async function () {
    // Regression test: an earlier `logout` relied on deauthenticate calls
    // never rejecting; this guards against that assumption breaking.
    const error = new Error("tmc logout exploded")
    deauthenticate = vi.fn(async () => {
      throw error
    })
    const result = await logout(actionContext())
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.reportError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      error,
      "tmc",
    )
  })

  test("still attempts the tmc logout when the mooc logout throws instead of returning an Err", async function () {
    const error = new Error("mooc logout exploded")
    deauthenticateMooc = vi.fn(async () => {
      throw error
    })
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.reportError).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      error,
      "mooc",
    )
  })

  test("attempts both regardless of outcome and surfaces both failures individually", async function () {
    const tmcError = new Error("tmc logout failed")
    const moocError = new Error("mooc logout failed")
    deauthenticate = vi.fn(async () => Err(tmcError))
    deauthenticateMooc = vi.fn(async () => Err(moocError))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(deauthenticateMooc).toHaveBeenCalledOnce()
    expect(dialogMock.reportError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      tmcError,
      "tmc",
    )
    expect(dialogMock.reportError).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      moocError,
      "mooc",
    )
    expect(result.err).toBe(true)
    expect(result.val).toBe(tmcError)
  })
})

function contextWith(
  userData: Partial<UserData>,
): [ActionContext, Dialog, ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const refresh = vi.fn()
  return [
    {
      ...createMockActionContext(),
      dialog,
      langs: Ok({
        unsetSetting: vi.fn(async () => Ok.EMPTY),
      }) as unknown as ActionContext["langs"],
      userData: Ok(userData) as unknown as ActionContext["userData"],
      ui: { treeDP: { refresh } } as unknown as ActionContext["ui"],
      workspaceManager: Ok({
        activeCourse: undefined,
        activeCourseBackend: undefined,
        deleteWorkspaceFile: vi.fn(async () => Ok.EMPTY),
      }) as unknown as ActionContext["workspaceManager"],
    },
    dialog,
    refresh,
  ]
}

suite("removeCourse action", function () {
  const course = makeTmcKind({
    id: 1,
    name: "test-python-course",
    title: "The Python Course",
    description: "",
    organization: "test",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })

  test("tells the user when the course cannot be looked up", async function () {
    const deleteCourse = vi.fn(async () => Ok.EMPTY)
    const [actionContext, dialog] = contextWith({
      getCourse: () => Err(new Error("no such course")),
      deleteCourse,
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.reportError).toHaveBeenCalled()
    expect(deleteCourse).not.toHaveBeenCalled()
  })

  test("tells the user when the removal could not be persisted", async function () {
    const error = new Error("globalState is full")
    const [actionContext, dialog, refresh] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Err(error)),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.reportError).toHaveBeenCalledWith(expect.any(String), error, "tmc")
    expect(refresh).not.toHaveBeenCalled()
  })

  test("drops the course from the tree once the removal is persisted", async function () {
    const [actionContext, dialog, refresh] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Ok.EMPTY),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.reportError).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  // Left behind, it is reused verbatim when the course is added back.
  test("removes the course's workspace file", async function () {
    const [actionContext] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Ok.EMPTY),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(
      (actionContext.workspaceManager as Ok<WorkspaceManager>).val.deleteWorkspaceFile,
    ).toHaveBeenCalledExactlyOnceWith("test-python-course", "tmc")
  })
})

// The mock exposes the open workspace as a prototype getter; an own data
// property shadows it.
function openWorkspaceFile(uri: vscode.Uri | undefined): void {
  Object.defineProperty(vscode.workspace, "workspaceFile", {
    value: uri,
    configurable: true,
    writable: true,
  })
}

suite("openWorkspace action", function () {
  const courseWorkspaceFile = "/tmc/workspaces/python-course.code-workspace"

  let dialogMock: Dialog
  let dialogMockValues: DialogMockValues
  let createWorkspaceFile: ReturnType<typeof vi.fn>
  let executeCommand: ReturnType<typeof vi.spyOn>

  function actionContext(): ActionContext {
    return {
      ...createMockActionContext(),
      dialog: dialogMock,
      resources: new Ok({
        getWorkspaceFilePath: () => courseWorkspaceFile,
      } as unknown as Resources),
      workspaceManager: new Ok({ createWorkspaceFile } as unknown as WorkspaceManager),
    }
  }

  beforeEach(function () {
    ;[dialogMock, dialogMockValues] = createDialogMock()
    createWorkspaceFile = vi.fn()
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    executeCommand.mockClear()
  })

  afterEach(function () {
    vi.restoreAllMocks()
    openWorkspaceFile(undefined)
  })

  test("focuses the explorer instead of reloading when the workspace is already open", async function () {
    openWorkspaceFile(vscode.Uri.file(courseWorkspaceFile))

    await openWorkspace(actionContext(), "python-course", "tmc")

    expect(dialogMock.confirmation).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openFolder", expect.anything())
    expect(executeCommand).toHaveBeenCalledWith("workbench.files.action.focusFilesExplorer")
  })

  test("opens the course workspace without asking when no workspace is open", async function () {
    openWorkspaceFile(undefined)

    await openWorkspace(actionContext(), "python-course", "tmc")

    expect(dialogMock.confirmation).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledWith(
      "vscode.openFolder",
      expect.objectContaining({ fsPath: courseWorkspaceFile }),
    )
  })

  test("asks before closing a different workspace, and opens nothing when declined", async function () {
    openWorkspaceFile(vscode.Uri.file("/somewhere/else.code-workspace"))
    dialogMockValues.confirmation = false

    await openWorkspace(actionContext(), "python-course", "tmc")

    expect(dialogMock.confirmation).toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openFolder", expect.anything())
    expect(dialogMock.warningNotification).toHaveBeenCalled()
  })
})

const tmcCourse = (id: number, notifyAfter: number, newExercises: number[]): LocalCourseData =>
  makeTmcKind({
    id,
    name: `course-${id}`,
    title: `Course ${id}`,
    description: "",
    organization: "test",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises,
    notifyAfter,
    disabled: false,
    materialUrl: null,
  })

function contextWithCourses(courses: LocalCourseData[]): [ActionContext, Dialog] {
  const [dialog] = createDialogMock()
  const byId = new Map(courses.map((c) => [String(c.data.id), c]))
  return [
    {
      ...createMockActionContext(),
      dialog,
      userData: Ok({
        getCourses: () => courses,
        getCourse: (id: CourseIdentifier) => Ok(byId.get(CourseIdentifier.toString(id))),
      }) as unknown as ActionContext["userData"],
    },
    dialog,
  ]
}

suite("checkForCourseUpdates action", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok(true))
  })

  test("refreshes a course whose new-exercise reminder is postponed", async function () {
    const [actionContext] = contextWithCourses([tmcCourse(1, Date.now() + 60_000, [10])])

    await checkForCourseUpdates(actionContext)

    expect(updateCourse).toHaveBeenCalledTimes(1)
    expect(updateCourse).toHaveBeenCalledWith(actionContext, CourseIdentifier.from(1))
  })

  test("rescans the exercises on disk once, however many courses were refreshed", async function () {
    // `updateCourse` does not rescan, so without this pass an exercise the backend
    // dropped keeps showing as open until something else happens to rescan.
    vi.mocked(refreshLocalExercises).mockClear()
    const [actionContext] = contextWithCourses([
      tmcCourse(1, Date.now() + 60_000, [10]),
      tmcCourse(2, Date.now() + 60_000, [20]),
    ])

    await checkForCourseUpdates(actionContext)

    expect(refreshLocalExercises).toHaveBeenCalledExactlyOnceWith(actionContext)
  })

  test("does not notify about a course whose reminder is postponed", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, Date.now() + 60_000, [10])])

    await checkForCourseUpdates(actionContext)

    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("refreshes the other courses after one fails, and names the failure", async function () {
    vi.mocked(updateCourse).mockImplementation(async (_actionContext, id) =>
      CourseIdentifier.toString(id) === "1" ? Err(new Error("boom")) : Ok(true),
    )
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, []), tmcCourse(2, 0, [])])

    const result = await checkForCourseUpdates(actionContext)

    expect(updateCourse).toHaveBeenCalledTimes(2)
    expect(result.err && result.val.message).toContain("course-1")
    // The caller decides whether a background failure is worth a toast.
    expect(dialog.reportError).not.toHaveBeenCalled()
  })

  test("reports progress as each course finishes", async function () {
    const reported: [number, number][] = []
    const [actionContext] = contextWithCourses([tmcCourse(1, 0, []), tmcCourse(2, 0, [])])

    await checkForCourseUpdates(actionContext, {
      onProgress: (done, total) => {
        reported.push([done, total])
      },
    })

    expect(reported).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  test("refreshes and notifies for a course whose reminder is due", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])

    await checkForCourseUpdates(actionContext)

    expect(updateCourse).toHaveBeenCalledTimes(1)
    expect(dialog.notification).toHaveBeenCalledWith(
      expect.stringContaining("1 new exercises"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })
})

suite("refreshEverything action", function () {
  let executeCommand: ReturnType<typeof vi.spyOn>

  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok(true))
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("refreshes course data before checking for exercise updates", async function () {
    const order: string[] = []
    vi.mocked(updateCourse).mockImplementation(async () => {
      order.push("updateCourse")
      return Ok(true)
    })
    executeCommand.mockImplementation(async (command: string) => {
      order.push(command)
      return undefined
    })
    const [actionContext] = contextWithCourses([tmcCourse(1, 0, [])])

    const result = await refreshEverything(actionContext, { silent: true })

    expect(result.ok).toBe(true)
    expect(order).toEqual(["updateCourse", "tmc.updateExercises"])
  })

  test("rejects a second refresh started while one is still running", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementation(async () => {
      await blocked
      return Ok(true)
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    const first = refreshEverything(actionContext, { silent: false })
    const second = await refreshEverything(actionContext, { silent: false })

    expect(second.err).toBe(true)
    expect(dialog.notification).toHaveBeenCalledWith(expect.stringContaining("already in progress"))
    release()
    expect((await first).ok).toBe(true)
    expect(updateCourse).toHaveBeenCalledTimes(1)
  })

  test("says nothing when a silent refresh is the one rejected", async function () {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(updateCourse).mockImplementation(async () => {
      await blocked
      return Ok(true)
    })
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [])])

    const first = refreshEverything(actionContext, { silent: true })
    const second = await refreshEverything(actionContext, { silent: true })

    expect(second.err).toBe(true)
    expect(dialog.notification).not.toHaveBeenCalled()
    release()
    await first
  })
})

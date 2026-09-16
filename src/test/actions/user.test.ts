import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { logout, openWorkspace, removeCourse } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type { UserData } from "../../config/userdata"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import type { DialogMockValues } from "../mocks/dialog"
import { createDialogMock } from "../mocks/dialog"

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
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      error,
    )
  })

  test("still attempts the tmc logout when the mooc logout fails, and reports it", async function () {
    const error = new Error("mooc logout failed")
    deauthenticateMooc = vi.fn(async () => Err(error))
    const result = await logout(actionContext())
    expect(deauthenticate).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
    expect(result.val).toBe(error)
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      error,
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
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      error,
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
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      error,
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
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log out"),
      tmcError,
    )
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("courses.mooc.fi"),
      moocError,
    )
    expect(result.err).toBe(true)
    expect(result.val).toBe(tmcError)
  })
})

function contextWith(
  userData: Partial<UserData>,
): [ActionContext, Dialog, ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const removeChildWithId = vi.fn()
  return [
    {
      ...createMockActionContext(),
      dialog,
      langs: Ok({
        unsetSetting: vi.fn(async () => Ok.EMPTY),
      }) as unknown as ActionContext["langs"],
      userData: Ok(userData) as unknown as ActionContext["userData"],
      ui: { treeDP: { removeChildWithId } } as unknown as ActionContext["ui"],
      workspaceManager: Ok({
        activeCourse: undefined,
        activeCourseBackend: undefined,
      }) as unknown as ActionContext["workspaceManager"],
    },
    dialog,
    removeChildWithId,
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

    expect(dialog.errorNotification).toHaveBeenCalled()
    expect(deleteCourse).not.toHaveBeenCalled()
  })

  test("tells the user when the removal could not be persisted", async function () {
    const error = new Error("globalState is full")
    const [actionContext, dialog, removeChildWithId] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Err(error)),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.errorNotification).toHaveBeenCalledWith(expect.any(String), error)
    expect(removeChildWithId).not.toHaveBeenCalled()
  })

  test("drops the course from the tree once the removal is persisted", async function () {
    const [actionContext, dialog, removeChildWithId] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Ok.EMPTY),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.errorNotification).not.toHaveBeenCalled()
    expect(removeChildWithId).toHaveBeenCalledWith("myCourses", expect.any(String))
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

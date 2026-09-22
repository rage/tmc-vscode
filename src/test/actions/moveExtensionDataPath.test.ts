import * as path from "path"

import { Err } from "ts-results"
import * as vscode from "vscode"

import { moveExtensionDataPath } from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type { UserData } from "../../config/userdata"
import { TmcPanel } from "../../panels/TmcPanel"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createUserDataMock } from "../mocks/userdata"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"
import { makeTmpDirs } from "../utils"

const emptyFolder = (root: string): vscode.Uri => vscode.Uri.file(root + "/new/path/empty")
const OLD_PATH = "/tmp/tmcdata/projects"

const nonEmptyFolder = (root: string): vscode.Uri => vscode.Uri.file(root + "/new/path/nonempty")

suite("moveExtensionDataPath action", function () {
  const virtualFileSystem = {
    "/new/path/": {
      empty: {},
      nonempty: {
        "file.txt": "",
      },
    },
  }

  const courseName = "test-python-course"
  let root: string

  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userDataMock: UserData
  let workspaceManagerMock: WorkspaceManager
  let workspaceManagerMockValues: WorkspaceManagerMockValues
  let resources: Resources

  const actionContext = (): ReadyActionContext =>
    createMockActionContext({
      startup: {
        resources,
        langs: tmcMock,
        userData: userDataMock,
        workspaceManager: workspaceManagerMock,
      },
    })

  beforeEach(function () {
    root = makeTmpDirs(virtualFileSystem)
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[userDataMock] = createUserDataMock()
    ;[workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock()
    workspaceManagerMockValues.activeCourse = courseName
    resources = { projectsDirectory: OLD_PATH } as Resources
    vi.spyOn(TmcPanel, "postMessage").mockResolvedValue(undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("should change extension data path", async function () {
    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(result.val).toBe(emptyFolder(root).fsPath)
    expect(tmcMock.moveProjectsDirectory).toHaveBeenCalledExactlyOnceWith(
      emptyFolder(root).fsPath,
      undefined,
    )
  })

  test("should append tmcdata to path if target is not empty", async function () {
    const result = await moveExtensionDataPath(actionContext(), nonEmptyFolder(root))
    const expected = path.join(nonEmptyFolder(root).fsPath, "tmcdata")
    expect(result.val).toBe(expected)
    expect(tmcMock.moveProjectsDirectory).toHaveBeenCalledExactlyOnceWith(expected, undefined)
  })

  test("should report an unreadable target folder instead of throwing", async function () {
    const missing = vscode.Uri.file(root + "/new/path/does-not-exist")
    const result = await moveExtensionDataPath(actionContext(), missing)
    expect(result.err).toBe(true)
    expect(String(result.val)).toContain(missing.fsPath)
    expect(tmcMock.moveProjectsDirectory).not.toHaveBeenCalled()
  })

  test("should set exercises again after moving", async function () {
    await moveExtensionDataPath(actionContext(), emptyFolder(root))
    // path.sep differs across platforms, so args aren't compared exactly.
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledTimes(1)
  })

  test("should not close exercises before moving", async function () {
    await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(workspaceManagerMock.closeCourseExercises).not.toHaveBeenCalled()
  })

  test("should result in error if TMC operation fails", async function () {
    tmcMockValues.moveProjectsDirectory = Err(new Error())
    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(result.val).toBeInstanceOf(Error)
  })

  test("tells a My Courses panel the new path after a move", async function () {
    await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(TmcPanel.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "setTmcDataPath",
      tmcDataPath: emptyFolder(root).fsPath,
      target: { type: "MyCourses" },
    })
  })

  test("tells a My Courses panel the unchanged path after a failed move", async function () {
    tmcMockValues.moveProjectsDirectory = Err(new Error())
    await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(TmcPanel.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "setTmcDataPath",
      tmcDataPath: OLD_PATH,
      target: { type: "MyCourses" },
    })
  })
})

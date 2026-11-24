import * as path from "path"

import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { moveExtensionDataPath } from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { langsError } from "../../api/langsErrors"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type { UserData } from "../../config/userdata"
import { presentationFor, ProjectsDirMoveError, ProjectsDirMoveRefusedError } from "../../errors"
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
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("should change extension data path", async function () {
    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(result.unwrap()).toEqual({
      projectsDirectory: emptyFolder(root).fsPath,
      rescanError: undefined,
    })
    expect(tmcMock.moveProjectsDirectory).toHaveBeenCalledExactlyOnceWith(
      emptyFolder(root).fsPath,
      undefined,
    )
  })

  test("should append tmcdata to path if target is not empty", async function () {
    const result = await moveExtensionDataPath(actionContext(), nonEmptyFolder(root))
    const expected = path.join(nonEmptyFolder(root).fsPath, "tmcdata")
    expect(result.unwrap().projectsDirectory).toBe(expected)
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

  test("refuses to move the exercises folder into itself", async function () {
    resources.projectsDirectory = nonEmptyFolder(root).fsPath

    const result = await moveExtensionDataPath(actionContext(), nonEmptyFolder(root))

    expect(result.val).toBeInstanceOf(ProjectsDirMoveRefusedError)
    expect(presentationFor(result.val as Error).message).toContain("into a folder inside it")
    expect(tmcMock.moveProjectsDirectory).not.toHaveBeenCalled()
  })

  test("passes on tmc-langs' refusal of a folder only links put inside it, as nothing moved", async function () {
    const refusal = langsError(
      { kind: "projects-dir-move-into-itself" },
      "into itself",
      "",
      undefined,
    )
    tmcMockValues.moveProjectsDirectory = Err(refusal)

    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))

    expect(result.val).toBe(refusal)
  })

  test("refuses to move the exercises folder into a folder inside it", async function () {
    resources.projectsDirectory = path.dirname(emptyFolder(root).fsPath)

    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))

    expect(result.err).toBe(true)
    expect(tmcMock.moveProjectsDirectory).not.toHaveBeenCalled()
  })

  test("reports a completed move whose rescan failed as moved", async function () {
    tmcMockValues.listLocalExercises = Err(new Error("tmc-langs crashed"))

    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))

    expect(result.unwrap()).toMatchObject({
      projectsDirectory: emptyFolder(root).fsPath,
      rescanError: expect.objectContaining({ message: "tmc-langs crashed" }),
    })
  })

  test("a failed move wraps its cause with where the exercises are now", async function () {
    const cause = new Error("held")
    tmcMockValues.moveProjectsDirectory = Err(cause)
    tmcMockValues.listSettings = Ok({ projects_dir: OLD_PATH })

    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))

    expect(result.val).toBeInstanceOf(ProjectsDirMoveError)
    expect((result.val as ProjectsDirMoveError).cause).toBe(cause)
    expect((result.val as Error).message).toBe(`Your exercises are now in ${OLD_PATH}.`)
  })
})

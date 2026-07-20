import * as path from "path"

import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { moveExtensionDataPath } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createUserDataMock } from "../mocks/userdata"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"
import { makeTmpDirs } from "../utils"

const emptyFolder = (root: string): vscode.Uri => vscode.Uri.file(root + "/new/path/empty")
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
  const stubContext = createMockActionContext()
  let root: string

  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userDataMock: UserData
  let workspaceManagerMock: WorkspaceManager
  let workspaceManagerMockValues: WorkspaceManagerMockValues

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(tmcMock),
    userData: new Ok(userDataMock),
    workspaceManager: new Ok(workspaceManagerMock),
  })

  beforeEach(function () {
    root = makeTmpDirs(virtualFileSystem)
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[userDataMock] = createUserDataMock()
    ;[workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock()
    workspaceManagerMockValues.activeCourse = courseName
  })

  test("should change extension data path", async function () {
    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(result).toBe(Ok.EMPTY)
    expect(tmcMock.moveProjectsDirectory).toHaveBeenCalledExactlyOnceWith(
      emptyFolder(root).fsPath,
      undefined,
    )
  })

  test("should append tmcdata to path if target is not empty", async function () {
    const result = await moveExtensionDataPath(actionContext(), nonEmptyFolder(root))
    expect(result).toBe(Ok.EMPTY)
    const expected = path.join(nonEmptyFolder(root).fsPath, "tmcdata")
    expect(tmcMock.moveProjectsDirectory).toHaveBeenCalledExactlyOnceWith(expected, undefined)
  })

  test("should set exercises again after moving", async function () {
    await moveExtensionDataPath(actionContext(), emptyFolder(root))
    // path.sep differs across platforms, so args aren't compared exactly.
    expect(workspaceManagerMock.setExercises).toHaveBeenCalledTimes(1)
  })

  // Closing the active course's exercises before the move was removed
  // deliberately (commit d39605f) as unnecessary on current VS Code, so the
  // move must not close anything even when a course workspace is active.
  test("should not close exercises before moving", async function () {
    await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(workspaceManagerMock.closeCourseExercises).not.toHaveBeenCalled()
  })

  test("should result in error if TMC operation fails", async function () {
    tmcMockValues.moveProjectsDirectory = Err(new Error())
    const result = await moveExtensionDataPath(actionContext(), emptyFolder(root))
    expect(result.val).toBeInstanceOf(Error)
  })
})

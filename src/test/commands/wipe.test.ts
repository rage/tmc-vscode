import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { wipe } from "../../commands/wipe"
import type Resources from "../../config/resources"
import type { UserData } from "../../config/userdata"
import { Logger } from "../../utilities"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("fs-extra", () => ({
  remove: vi.fn(),
  readdir: vi.fn(),
  pathExists: vi.fn(async () => false),
  rmdir: vi.fn(),
}))

const PROJECTS_DIRECTORY = "/tmp/tmcdata/projects"

// `subscriptions` is all wipe reads off the extension context.
const extensionContext = { subscriptions: [] } as unknown as vscode.ExtensionContext

/** Names of the wipe steps that ran, in the order they ran. */
const stepsRun: string[] = []

function step<T>(name: string, outcome: () => T): () => Promise<T> {
  return async () => {
    stepsRun.push(name)
    return outcome()
  }
}

function wipeContext(
  options: {
    /** The answer to the typed confirmation. */
    isConfirmed?: boolean
    noProjectsDirectory?: boolean
    resetSettings?: Result<void, Error>
    wipeDataFromStorage?: Result<void, Error>
    deleteAllWorkspaceFiles?: Result<void, Error>
  } = {},
): ReadyActionContext {
  const [dialog] = createDialogMock()
  dialog.explicitConfirmation = vi.fn(async () => options.isConfirmed ?? true)
  return {
    ...createMockActionContext({
      startup: {
        resources: {
          projectsDirectory: options.noProjectsDirectory ? undefined : PROJECTS_DIRECTORY,
        } as Resources,
        langs: {
          resetSettings: vi.fn(step("resetSettings", () => options.resetSettings ?? Ok.EMPTY)),
          deauthenticate: vi.fn(step("deauthenticate", () => Ok.EMPTY)),
        } as unknown as Langs,
        userData: {
          wipeDataFromStorage: vi.fn(
            step("wipeDataFromStorage", () => options.wipeDataFromStorage ?? Ok.EMPTY),
          ),
        } as unknown as UserData,
        workspaceManager: {
          activeCourse: undefined,
          deleteAllWorkspaceFiles: vi.fn(
            step("deleteAllWorkspaceFiles", () => options.deleteAllWorkspaceFiles ?? Ok.EMPTY),
          ),
        } as unknown as WorkspaceManager,
      },
    }),
    dialog,
  }
}

suite("Wipe command", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  beforeEach(function () {
    stepsRun.length = 0
    vi.mocked(fs.remove).mockReset()
    vi.mocked(fs.remove).mockImplementation(() => {
      stepsRun.push("remove")
    })
    vi.mocked(fs.readdir).mockReset()
    vi.mocked(fs.readdir as (dir: string) => Promise<string[]>)
      .mockResolvedValueOnce(["mooc"])
      .mockResolvedValue([])
  })

  test("removes the exercises from the projects directory tmc-langs reported", async function () {
    const context = wipeContext()

    await wipe(context, extensionContext)

    expect(fs.remove).toHaveBeenCalledWith(path.join(PROJECTS_DIRECTORY, "mooc"))
    expect(fs.rmdir).toHaveBeenCalledWith(PROJECTS_DIRECTORY)
  })

  test("deletes the exercises only after every recoverable step has succeeded", async function () {
    const context = wipeContext()

    await wipe(context, extensionContext)

    expect(stepsRun).toEqual([
      "resetSettings",
      "deauthenticate",
      "wipeDataFromStorage",
      "deleteAllWorkspaceFiles",
      "remove",
    ])
  })

  test("leaves the exercises on disk when an earlier step fails", async function () {
    const context = wipeContext({ resetSettings: Err(new Error("settings are read-only")) })

    await wipe(context, extensionContext)

    expect(fs.remove).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledOnce()
  })

  test("leaves the exercises on disk when the workspace files cannot be removed", async function () {
    const context = wipeContext({
      deleteAllWorkspaceFiles: Err(new Error("workspace folder is read-only")),
    })

    await wipe(context, extensionContext)

    expect(fs.remove).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledOnce()
  })

  test("wipes nothing and says why when tmc-langs reported no exercise directory", async function () {
    const context = wipeContext({ noProjectsDirectory: true })

    await wipe(context, extensionContext)

    expect(stepsRun).toEqual([])
    expect(context.dialog.confirm).not.toHaveBeenCalled()
    expect(context.dialog.errorNotification).toHaveBeenCalledWith(
      "Wiping the extension data is unavailable: the TestMyCode tools did not report where the exercises folder is.",
      expect.any(Error),
    )
  })

  test("asks once, by typing, and deletes nothing unless the user types the confirmation", async function () {
    const context = wipeContext({ isConfirmed: false })

    await wipe(context, extensionContext)

    expect(context.dialog.confirm).not.toHaveBeenCalled()
    expect(context.dialog.explicitConfirmation).toHaveBeenCalledWith(expect.any(String), "DELETE")
    expect(fs.remove).not.toHaveBeenCalled()
  })

  test("names the folder whose exercises it deletes", async function () {
    const context = wipeContext({ isConfirmed: false })

    await wipe(context, extensionContext)

    expect(context.dialog.explicitConfirmation).toHaveBeenCalledWith(
      expect.stringContaining(`downloaded to ${PROJECTS_DIRECTORY},`),
      "DELETE",
    )
  })

  test("logs no wipe the user did not confirm", async function () {
    const info = vi.spyOn(Logger, "info")
    const context = wipeContext({ isConfirmed: false })

    await wipe(context, extensionContext)

    expect(info.mock.calls.flat().join(" ")).not.toMatch(/wip/i)
  })
})

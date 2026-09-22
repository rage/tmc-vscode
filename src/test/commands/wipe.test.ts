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
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("fs-extra", () => ({ removeSync: vi.fn() }))

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
    /** Answers to the two explicit confirmations, in order. */
    confirmations?: boolean[]
    resetSettings?: Result<void, Error>
    deleteAllWorkspaceFiles?: Result<void, Error>
  } = {},
): ReadyActionContext {
  const confirmations = options.confirmations ?? [true, true]
  const [dialog] = createDialogMock()
  let asked = 0
  dialog.explicitConfirmation = vi.fn(async () => confirmations[asked++] ?? false)
  return {
    ...createMockActionContext({
      startup: {
        resources: { projectsDirectory: PROJECTS_DIRECTORY } as Resources,
        langs: {
          resetSettings: vi.fn(step("resetSettings", () => options.resetSettings ?? Ok.EMPTY)),
          deauthenticate: vi.fn(step("deauthenticate", () => Ok.EMPTY)),
          deauthenticateMooc: vi.fn(step("deauthenticateMooc", () => Ok.EMPTY)),
        } as unknown as Langs,
        userData: {
          wipeDataFromStorage: vi.fn(step("wipeDataFromStorage", () => {})),
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
  beforeEach(function () {
    stepsRun.length = 0
    vi.mocked(fs.removeSync).mockReset()
    vi.mocked(fs.removeSync).mockImplementation(() => {
      stepsRun.push("removeSync")
    })
  })

  test("removes the projects directory tmc-langs reported", async function () {
    const context = wipeContext()

    await wipe(context, extensionContext)

    expect(fs.removeSync).toHaveBeenCalledWith(PROJECTS_DIRECTORY)
  })

  test("deletes the exercises only after every recoverable step has succeeded", async function () {
    const context = wipeContext()

    await wipe(context, extensionContext)

    expect(stepsRun).toEqual([
      "resetSettings",
      "deauthenticate",
      "deauthenticateMooc",
      "wipeDataFromStorage",
      "deleteAllWorkspaceFiles",
      "removeSync",
    ])
  })

  test("leaves the exercises on disk when an earlier step fails", async function () {
    const context = wipeContext({ resetSettings: Err(new Error("settings are read-only")) })

    await wipe(context, extensionContext)

    expect(fs.removeSync).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledOnce()
  })

  test("leaves the exercises on disk when the workspace files cannot be removed", async function () {
    const context = wipeContext({
      deleteAllWorkspaceFiles: Err(new Error("workspace folder is read-only")),
    })

    await wipe(context, extensionContext)

    expect(fs.removeSync).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledOnce()
  })

  test("deletes nothing when the user declines the second confirmation", async function () {
    const context = wipeContext({ confirmations: [true, false] })

    await wipe(context, extensionContext)

    expect(fs.removeSync).not.toHaveBeenCalled()
  })
})

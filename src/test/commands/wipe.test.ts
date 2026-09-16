import * as fs from "fs-extra"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { wipe } from "../../commands/wipe"
import type Resources from "../../config/resources"
import type { UserData } from "../../config/userdata"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("fs-extra", () => ({ removeSync: vi.fn() }))
vi.mock("../../extension", () => ({ deactivate: vi.fn() }))

const PROJECTS_DIRECTORY = "/tmp/tmcdata/projects"

// `subscriptions` is all wipe reads off the extension context.
const extensionContext = { subscriptions: [] } as unknown as vscode.ExtensionContext

/** @param confirmations answers to the two explicit confirmations, in order. */
function initializedContext(confirmations: boolean[] = [true, true]): ActionContext {
  const [dialog] = createDialogMock()
  let asked = 0
  dialog.explicitConfirmation = vi.fn(async () => confirmations[asked++] ?? false)
  return {
    ...createMockActionContext(),
    dialog,
    resources: Ok({ projectsDirectory: PROJECTS_DIRECTORY } as Resources),
    langs: Ok({
      resetSettings: vi.fn(async () => Ok.EMPTY),
      deauthenticate: vi.fn(async () => Ok.EMPTY),
      deauthenticateMooc: vi.fn(async () => Ok.EMPTY),
    } as unknown as Langs),
    userData: Ok({ wipeDataFromStorage: vi.fn(async () => {}) } as unknown as UserData),
    workspaceManager: Ok({ activeCourse: undefined } as unknown as WorkspaceManager),
  }
}

suite("Wipe command", function () {
  beforeEach(function () {
    vi.mocked(fs.removeSync).mockClear()
  })

  test("removes the projects directory the initialization check passed", async function () {
    const context = initializedContext()

    await wipe(context, extensionContext)

    expect(fs.removeSync).toHaveBeenCalledWith(PROJECTS_DIRECTORY)
  })

  test("deletes nothing when initialization failed", async function () {
    const context = { ...initializedContext(), resources: Err(new Error("no resources")) }

    await wipe(context, extensionContext)

    expect(fs.removeSync).not.toHaveBeenCalled()
  })

  test("deletes nothing when the user declines the second confirmation", async function () {
    const context = initializedContext([true, false])

    await wipe(context, extensionContext)

    expect(fs.removeSync).not.toHaveBeenCalled()
  })
})

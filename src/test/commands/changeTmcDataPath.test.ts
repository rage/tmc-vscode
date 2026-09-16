import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ActionContext } from "../../actions/types"
import { changeTmcDataPath } from "../../commands/changeTmcDataPath"
import type Resources from "../../config/resources"
import { TmcPanel } from "../../panels/TmcPanel"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/moveExtensionDataPath", () => ({
  moveExtensionDataPath: vi.fn(),
}))

const OLD_PATH = "/tmp/tmcdata/projects"
const CHOSEN_PATH = "/tmp/elsewhere"

interface Harness {
  context: ActionContext
  notifications: string[]
  errors: string[]
}

function harness(): Harness {
  const [dialog] = createDialogMock()
  const notifications: string[] = []
  const errors: string[] = []
  dialog.notification = vi.fn(async (message: string) => {
    notifications.push(message)
  })
  dialog.errorNotification = vi.fn(async (message: string) => {
    errors.push(message)
  })
  return {
    context: {
      ...createMockActionContext(),
      dialog,
      resources: Ok({ projectsDirectory: OLD_PATH } as Resources),
    },
    notifications,
    errors,
  }
}

suite("Change TMC data path command", function () {
  beforeEach(function () {
    vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([vscode.Uri.file(CHOSEN_PATH)])
    vi.spyOn(TmcPanel, "postMessage").mockResolvedValue(undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("names the folder the user chose when that folder was used", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Ok(vscode.Uri.file(CHOSEN_PATH).fsPath),
    )
    const { context, notifications } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toEqual([
      `TMC Data was successfully moved to ${vscode.Uri.file(CHOSEN_PATH).fsPath}`,
    ])
  })

  test("names the tmcdata subfolder, and why it was used, when the choice was not empty", async function () {
    const used = vscode.Uri.file(CHOSEN_PATH + "/tmcdata").fsPath
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(Ok(used))
    const { context, notifications } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain(used)
    expect(notifications[0]).toContain("not empty")
  })

  test("reports a failed move", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Err(new Error("Failed to read the folder")),
    )
    const { context, notifications, errors } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toEqual([])
    expect(errors).toEqual(["Failed to read the folder"])
  })
})

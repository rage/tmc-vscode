import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
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
  context: ReadyActionContext
  notifications: string[]
  errors: string[]
}

/** `"none"` stands for an activation tmc-langs gave no exercise directory. */
function harness(projectsDirectory: string | "none" = OLD_PATH): Harness {
  const [dialog] = createDialogMock()
  const notifications: string[] = []
  const errors: string[] = []
  dialog.notification = vi.fn(async (message: string) => {
    notifications.push(message)
  })
  dialog.reportError = vi.fn(async (message: string) => {
    errors.push(message)
  })
  return {
    context: {
      ...createMockActionContext({
        startup: {
          resources: {
            projectsDirectory: projectsDirectory === "none" ? undefined : projectsDirectory,
          } as Resources,
        },
      }),
      dialog,
    },
    notifications,
    errors,
  }
}

suite("Change TMC data path command", function () {
  beforeEach(function () {
    // `restoreAllMocks` puts jest-mock-vscode's own persistent spy back, call
    // history and all, so a count assertion needs the history reset instead.
    vi.mocked(vscode.window.showOpenDialog).mockReset()
    vi.mocked(actions.moveExtensionDataPath).mockReset()
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

  test("asks for nothing when tmc-langs reported no exercise directory", async function () {
    const { context, notifications, errors } = harness("none")

    await changeTmcDataPath(context)

    expect(vscode.window.showOpenDialog).not.toHaveBeenCalled()
    expect(actions.moveExtensionDataPath).not.toHaveBeenCalled()
    expect(notifications).toEqual([])
    expect(errors).toEqual([])
  })

  test("reports a failed move", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Err(new Error("Failed to read the folder")),
    )
    const { context, notifications, errors } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toEqual([])
    expect(errors).toEqual(["Failed to move the projects directory."])
  })
})

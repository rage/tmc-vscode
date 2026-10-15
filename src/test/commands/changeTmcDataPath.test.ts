import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { BackendKind } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import { changeTmcDataPath } from "../../commands/changeTmcDataPath"
import Resources from "../../config/resources"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/moveExtensionDataPath", () => ({
  moveExtensionDataPath: vi.fn(),
}))

// jest-mock-vscode ships no `env` namespace, and `Resources` reads `env.appName`.
vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  env: { appName: "Visual Studio Code" },
}))

const OLD_PATH = "/tmp/tmcdata/projects"
const CHOSEN_PATH = "/tmp/elsewhere"

interface Harness {
  context: ReadyActionContext
  notifications: string[]
  errors: string[]
}

/** @param openCourse The course whose workspace the window has open. */
function harness(openCourse?: { slug: string; backend: BackendKind }): Harness {
  const [dialog] = createDialogMock()
  const resources = new Resources(OLD_PATH)
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
          resources,
          workspaceManager: {
            activeCourse: openCourse?.slug,
            activeCourseBackend: openCourse?.backend,
          } as WorkspaceManager,
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
    vi.mocked(actions.moveExtensionDataPath).mockReset()
    vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([vscode.Uri.file(CHOSEN_PATH)])
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("names the folder the user chose when that folder was used", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Ok({ projectsDirectory: vscode.Uri.file(CHOSEN_PATH).fsPath, rescanError: undefined }),
    )
    const { context, notifications } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toEqual([
      `Moved the exercises folder to ${vscode.Uri.file(CHOSEN_PATH).fsPath}.`,
    ])
  })

  test("names the tmcdata subfolder, and why it was used, when the choice was not empty", async function () {
    const used = vscode.Uri.file(CHOSEN_PATH + "/tmcdata").fsPath
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Ok({ projectsDirectory: used, rescanError: undefined }),
    )
    const { context, notifications } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain(used)
    expect(notifications[0]).toContain("not empty")
  })

  test("reports a move whose rescan failed as done, with a warning", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Ok({
        projectsDirectory: vscode.Uri.file(CHOSEN_PATH).fsPath,
        rescanError: new Error("tmc-langs crashed"),
      }),
    )
    const { context, notifications, errors } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toEqual([
      `Moved the exercises folder to ${vscode.Uri.file(CHOSEN_PATH).fsPath}.`,
    ])
    expect(errors).toEqual([])
    expect(context.dialog.warningNotification).toHaveBeenCalledExactlyOnceWith(
      "The exercises could not be listed in their new folder.",
      ["Refresh Courses", expect.any(Function)],
    )
  })

  test("reports a failed move", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Err(new Error("Failed to read the folder")),
    )
    const { context, notifications, errors } = harness()

    await changeTmcDataPath(context)

    expect(notifications).toEqual([])
    expect(errors).toEqual(["Failed to move the exercises folder."])
  })

  test("reopens the open course workspace from the folder it moved to", async function () {
    const { context } = harness({ slug: "python-course", backend: "mooc" })
    vi.mocked(actions.moveExtensionDataPath).mockImplementation(async (actionContext) => {
      actionContext.startup.resources.projectsDirectory = CHOSEN_PATH
      return Ok({ projectsDirectory: CHOSEN_PATH, rescanError: undefined })
    })
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    await changeTmcDataPath(context)

    expect(executeCommand).toHaveBeenCalledWith(
      "vscode.openFolder",
      vscode.Uri.file(`${CHOSEN_PATH}/workspaces/python-course (mooc).code-workspace`),
    )
  })

  test("reopens nothing when no course workspace is open", async function () {
    vi.mocked(actions.moveExtensionDataPath).mockResolvedValue(
      Ok({ projectsDirectory: CHOSEN_PATH, rescanError: undefined }),
    )
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    await changeTmcDataPath(harness().context)

    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openFolder", expect.anything())
  })
})

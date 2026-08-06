import * as fs from "fs"
import * as path from "path"

import { vi } from "vitest"
import * as vscode from "vscode"

import { registerCommands } from "../../init/commands"
import { TmcPanel } from "../../panels/TmcPanel"
import { createMockActionContext } from "../mocks/actionContext"

// Every command the extension registers. Declared here rather than derived, so a
// command silently disappearing (or a new one arriving unreviewed) fails.
const expectedCommands = [
  "tmcView.activateEntry",
  "tmcTreeView.refreshCourses",
  "tmc.addNewCourse",
  "tmc.changeTmcDataPath",
  "tmc.cleanExercise",
  "tmc.closeExercise",
  "tmc.courseDetails",
  "tmc.downloadNewExercises",
  "tmc.downloadOldSubmission",
  "tmc.logout",
  "tmc.myCourses",
  "tmc.settings",
  "tmc.openTMCExercisesFolder",
  "tmc.pasteExercise",
  "tmc.resetExercise",
  "tmc.selectAction",
  "tmc.showWelcome",
  "tmc.showMoocLogin",
  "tmc.submitExercise",
  "tmc.switchWorkspace",
  "tmc.testExercise",
  "tmc.updateExercises",
  "tmc.logs",
  "tmc.debug",
  "tmc.wipe",
  "tmc.viewInitializationErrorHelp",
]

function registerAndCollect(): { ids: string[]; handlers: Map<string, () => Promise<void>> } {
  const ids: string[] = []
  const handlers = new Map<string, () => Promise<void>>()
  const registerCommand = vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((
    id: string,
    handler: () => Promise<void>,
  ) => {
    ids.push(id)
    handlers.set(id, handler)
    return { dispose: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)
  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file("/tmp/extension"),
  } as unknown as vscode.ExtensionContext

  registerCommands(context, createMockActionContext())
  registerCommand.mockRestore()
  return { ids, handlers }
}

function packageJson(): {
  contributes: {
    commands: { command: string }[]
    menus: { commandPalette: { command: string; when?: string }[] }
  }
} {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
  ) as ReturnType<typeof packageJson>
}

function declaredCommands(): string[] {
  return packageJson().contributes.commands.map((x) => x.command)
}

afterEach(function () {
  vi.restoreAllMocks()
})

suite("registerCommands", function () {
  test("registers exactly the expected command set", function () {
    const { ids } = registerAndCollect()
    expect(ids.toSorted()).toEqual(expectedCommands.toSorted())
  })

  test("registers no command twice", function () {
    const { ids } = registerAndCollect()
    expect(ids).toHaveLength(new Set(ids).size)
  })

  // A command declared in package.json but never registered fails only when the
  // user runs it; one registered but not declared never shows up in the palette.
  test("the registered set and package.json's declarations agree", function () {
    const { ids } = registerAndCollect()
    expect(declaredCommands().toSorted()).toEqual(ids.toSorted())
  })

  // The device flow is the only login left; nothing may register a TMC
  // username/password login again.
  test("registers no tmc login command", function () {
    const { ids } = registerAndCollect()
    expect(ids).not.toContain("tmc.login")
    expect(ids).not.toContain("tmc.showLogin")
    expect(ids).toContain("tmc.showMoocLogin")
  })

  test("the login command opens the courses.mooc.fi device flow", async function () {
    const renderSide = vi.spyOn(TmcPanel, "renderSide").mockResolvedValue(undefined)
    const { handlers } = registerAndCollect()

    await handlers.get("tmc.showMoocLogin")?.()

    expect(renderSide).toHaveBeenCalledOnce()
    expect(renderSide.mock.calls[0]?.[3]).toMatchObject({ type: "MoocLogin" })
  })

  // Without a reachable palette entry a user with no credentials has no way in
  // besides the tree view; `"when": "false"` (its previous value) hides it.
  test("the login command is reachable from the palette while logged out", function () {
    const entry = packageJson().contributes.menus.commandPalette.find(
      (x) => x.command === "tmc.showMoocLogin",
    )
    expect(entry?.when).toBe("test-my-code:LoggedIn == false")
  })
})

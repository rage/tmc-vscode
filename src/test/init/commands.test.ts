import * as fs from "fs"
import * as path from "path"

import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import { EXTENSION_ID, EXTENSION_VERSION } from "../../config/constants"
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

function registerAndCollect(): {
  ids: string[]
  handlers: Map<string, () => Promise<void>>
  actionContext: ActionContext
} {
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

  const actionContext = createMockActionContext()
  registerCommands(context, actionContext)
  registerCommand.mockRestore()
  return { ids, handlers, actionContext }
}

interface MenuEntry {
  command: string
  when?: string
}

function packageJson(): {
  name: string
  publisher: string
  version: string
  contributes: {
    commands: { command: string }[]
    keybindings?: { command: string; key: string; when?: string }[]
    menus: Record<string, MenuEntry[]>
    viewsWelcome?: { contents: string }[]
  }
} {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
  ) as ReturnType<typeof packageJson>
}

function declaredCommands(): string[] {
  return packageJson().contributes.commands.map((x) => x.command)
}

function commandPalette(): MenuEntry[] {
  return packageJson().contributes.menus.commandPalette ?? []
}

// Menus attached to a file, whose `when` therefore carries the gates the same
// command needs when it is reached from the palette instead.
const resourceMenus = ["explorer/context", "editor/title"]

// A `when` is a conjunction; comparing term sets rather than strings lets the
// palette and the menus spell the same gate in a different order.
function whenTerms(when: string | undefined): string[] {
  return (when ?? "")
    .split("&&")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
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

  // VS Code discards a rejected handler promise, so a command that throws would
  // otherwise leave the user staring at an unchanged screen.
  test("a failing command reports instead of rejecting", async function () {
    vi.spyOn(TmcPanel, "renderSide").mockRejectedValue(new Error("the panel could not open"))
    const { handlers, actionContext } = registerAndCollect()

    await expect(handlers.get("tmc.showMoocLogin")?.()).resolves.toBeUndefined()

    expect(vi.mocked(actionContext.dialog.errorNotification)).toHaveBeenCalledWith(
      "Failed to run tmc.showMoocLogin.",
      expect.objectContaining({ message: "the panel could not open" }),
    )
  })

  // Without a reachable palette entry a user with no credentials has no way in
  // besides the tree view; `"when": "false"` (its previous value) hides it.
  test("the login command is reachable from the palette while logged out", function () {
    const entry = commandPalette().find((x) => x.command === "tmc.showMoocLogin")
    expect(entry?.when).toBe("test-my-code:LoggedIn == false")
  })

  // A menu, keybinding or welcome-view link naming an undeclared command gives
  // the user an entry that resolves to "command not found" when they pick it.
  test("every command a contribution points at is declared", function () {
    const { menus, keybindings = [], viewsWelcome = [] } = packageJson().contributes
    const referenced = [
      ...Object.values(menus).flatMap((entries) => entries.map((x) => x.command)),
      ...keybindings.map((x) => x.command),
      ...viewsWelcome.flatMap((x) =>
        [...x.contents.matchAll(/command:([\w.-]+)/g)].flatMap((m) => m[1] ?? []),
      ),
    ]
    const declared = new Set(declaredCommands())
    expect([...new Set(referenced)].filter((x) => !declared.has(x))).toEqual([])
  })

  // A `when` naming a key nothing ever sets is never true, so the entry it
  // gates silently disappears from the UI instead of failing anywhere.
  test("every context key the manifest gates on is one the extension sets", function () {
    const sourceRoot = path.join(__dirname, "..", "..")
    const settable = new Set(
      fs
        .readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts") && !file.startsWith("test"))
        .flatMap((file) => [
          ...fs.readFileSync(path.join(sourceRoot, file), "utf8").matchAll(/"(test-my-code:\w+)"/g),
        ])
        .flatMap((match) => match[1] ?? []),
    )
    const { menus, keybindings = [] } = packageJson().contributes
    const gated = [...Object.values(menus).flat(), ...keybindings]
    const referenced = new Set(
      gated.flatMap((x) => [...(x.when ?? "").matchAll(/test-my-code:\w+/g)].map((m) => m[0])),
    )
    expect([...referenced].filter((key) => !settable.has(key)).toSorted()).toEqual([])
  })

  // The palette is the one entry point with no file behind it, so a gate the
  // file menus enforce has to be spelled out there or the command runs without it.
  test("a palette entry carries every gate its resource menus carry", function () {
    const { menus } = packageJson().contributes
    const missing: string[] = []
    for (const entry of commandPalette()) {
      const palette = whenTerms(entry.when)
      for (const menu of resourceMenus) {
        const menuEntry = (menus[menu] ?? []).find((x) => x.command === entry.command)
        if (!menuEntry) {
          continue
        }
        for (const term of whenTerms(menuEntry.when)) {
          if (!term.startsWith("resourceScheme") && !palette.includes(term)) {
            missing.push(`${entry.command}: ${menu} requires ${term}`)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })
})

// VS Code's own Windows/Linux defaults, transcribed. An extension binding of
// equal specificity outranks a default, so any key claimed from here is
// shadowed wherever the binding's `when` holds.
const vsCodeDefaultKeys: Record<string, string> = {
  "ctrl+shift+b": "workbench.action.tasks.build",
  "ctrl+shift+c": "workbench.action.terminal.openNativeConsole",
  "ctrl+shift+d": "workbench.view.debug",
  "ctrl+shift+e": "workbench.view.explorer",
  "ctrl+shift+f": "workbench.view.search",
  "ctrl+shift+g": "workbench.view.scm",
  "ctrl+shift+h": "editor.action.startFindReplaceAction",
  "ctrl+shift+i": "editor.action.formatDocument",
  "ctrl+shift+k": "editor.action.deleteLines",
  "ctrl+shift+l": "editor.action.selectHighlights",
  "ctrl+shift+m": "workbench.actions.view.problems",
  "ctrl+shift+n": "workbench.action.newWindow",
  "ctrl+shift+o": "workbench.action.gotoSymbol",
  "ctrl+shift+p": "workbench.action.showCommands",
  "ctrl+shift+s": "workbench.action.files.saveAs",
  "ctrl+shift+t": "workbench.action.reopenClosedEditor",
  "ctrl+shift+u": "workbench.action.output.toggleOutput",
  "ctrl+shift+v": "markdown.showPreview",
  "ctrl+shift+w": "workbench.action.closeWindow",
  "ctrl+shift+x": "workbench.view.extensions",
  "ctrl+shift+y": "workbench.debug.action.toggleRepl",
  "ctrl+shift+z": "redo",
}

// Shadowing kept deliberately: both keys shipped years ago and students have
// learned them, which outweighs losing the defaults inside a course workspace.
const acceptedShadowedKeys = ["ctrl+shift+c", "ctrl+shift+t"]

// Neither constant is read from the manifest at runtime: the id is what VS Code
// resolves the extension by, and the version is what both backends receive as
// `--client-version`, so a manifest edit that leaves them behind is silent.
suite("extension identity", function () {
  test("EXTENSION_ID is the manifest's publisher and name", function () {
    const { publisher, name } = packageJson()
    expect(EXTENSION_ID).toBe(`${publisher}.${name}`)
  })

  test("EXTENSION_VERSION is the manifest's version", function () {
    expect(EXTENSION_VERSION).toBe(packageJson().version)
  })
})

suite("keybindings", function () {
  // Adding a binding means editing this list, which is what puts the shadowing
  // check below in front of whoever adds it.
  test("claims exactly the reviewed keys", function () {
    expect(packageJson().contributes.keybindings).toEqual([
      { command: "tmc.closeExercise", key: "ctrl+shift+c", when: "test-my-code:WorkspaceActive" },
      { command: "tmc.selectAction", key: "ctrl+shift+a", when: "test-my-code:WorkspaceActive" },
      { command: "tmc.testExercise", key: "ctrl+shift+t", when: "test-my-code:WorkspaceActive" },
    ])
  })

  test("shadows no VS Code default beyond the two accepted ones", function () {
    const shadowed = (packageJson().contributes.keybindings ?? [])
      .map((x) => x.key)
      .filter((key) => key in vsCodeDefaultKeys && !acceptedShadowedKeys.includes(key))
    expect(shadowed).toEqual([])
  })

  // A binding with no `when` applies in every window, course workspace or not.
  test("gates every key on an open course workspace", function () {
    for (const binding of packageJson().contributes.keybindings ?? []) {
      expect(binding.when).toBe("test-my-code:WorkspaceActive")
    }
  })
})

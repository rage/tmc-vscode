import * as fs from "fs"
import * as path from "path"

import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import { isReady } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import * as commands from "../../commands"
import { EXTENSION_ID, EXTENSION_VERSION } from "../../config/constants"
import type Resources from "../../config/resources"
import { registerCommands, registerServiceFreeCommands } from "../../init/commands"
import { registerTesting } from "../../init/testing"
import { TmcPanel } from "../../panels/TmcPanel"
import { CourseIdentifier } from "../../shared/shared"
import { CourseTreeItem } from "../../ui/treeview/treeview"
import { Logger } from "../../utilities"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"

// Every command the extension registers, across `registerServiceFreeCommands`,
// `registerCommands` and `registerTesting`. Declared here rather than derived, so a command silently
// disappearing (or a new one arriving unreviewed) fails.
const expectedCommands = [
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
  "tmc.openCourseWorkspace",
  "tmc.removeCourse",
  "tmc.settings",
  "tmc.openTMCExercisesFolder",
  "tmc.pasteExercise",
  "tmc.resetExercise",
  "tmc.showWelcome",
  "tmc.showMoocLogin",
  "tmc.submitExercise",
  "tmc.switchWorkspace",
  "tmc.testExercise",
  "tmc.testing.pasteExercise",
  "tmc.testing.submitExercise",
  "tmc.updateExercises",
  "tmc.logs",
  "tmc.debug",
  "tmc.wipe",
  "tmc.viewInitializationErrorHelp",
]

// Of those, the ones that reach no service, so a failed activation can still offer them:
// `registerServiceFreeCommands`'s three, plus `tmc.viewInitializationErrorHelp`, which
// needs an `ActionContext` but no service and so stays in `registerCommands`.
const expectedDegradedCommands = [
  "tmc.settings",
  "tmc.logs",
  "tmc.debug",
  "tmc.viewInitializationErrorHelp",
]

// What `registerServiceFreeCommands` registers on its own, regardless of startup state.
const expectedServiceFreeCommands = ["tmc.settings", "tmc.logs", "tmc.debug"]

function registerAndCollect(actionContext: ActionContext = createMockActionContext()): {
  ids: string[]
  serviceFreeIds: string[]
  handlers: Map<string, (...args: unknown[]) => Promise<unknown>>
  context: vscode.ExtensionContext
  actionContext: ActionContext
} {
  const ids: string[] = []
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const registerCommand = vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((
    id: string,
    handler: (...args: unknown[]) => Promise<unknown>,
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

  registerServiceFreeCommands(context, actionContext.dialog)
  const serviceFreeIds = [...ids]
  registerCommands(context, actionContext)
  if (isReady(actionContext)) {
    registerTesting(context, {
      ...actionContext,
      startup: {
        ...actionContext.startup,
        workspaceManager: {
          activeCourse: undefined,
          onDidChangeExercises: () => ({ dispose: vi.fn() }),
        } as unknown as WorkspaceManager,
      },
    })
  }
  registerCommand.mockRestore()
  return { ids, serviceFreeIds, handlers, context, actionContext }
}

/** A menu item: a command, or a submenu (`tmc.exercise`) whose own items are a menu too. */
interface MenuEntry {
  command?: string
  submenu?: string
  when?: string
}

interface Walkthrough {
  id: string
  steps: {
    id: string
    description: string
    media: { markdown?: string; svg?: string; image?: string }
    completionEvents?: string[]
  }[]
}

function packageJson(): {
  name: string
  publisher: string
  version: string
  contributes: {
    commands: { command: string; icon?: unknown }[]
    submenus?: { id: string }[]
    keybindings?: { command: string; key: string; when?: string }[]
    menus: Record<string, MenuEntry[]>
    viewsWelcome?: { contents: string; when?: string }[]
    walkthroughs?: Walkthrough[]
  }
} {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
  ) as ReturnType<typeof packageJson>
}

/** The commands a markdown string's `command:` links run. */
function linkedCommands(markdown: string): string[] {
  return [...markdown.matchAll(/command:([\w.-]+)/g)].flatMap((m) => m[1] ?? [])
}

function declaredCommands(): string[] {
  return packageJson().contributes.commands.map((x) => x.command)
}

function declaredCommandIcons(): unknown[] {
  return packageJson().contributes.commands.flatMap((x) => (x.icon === undefined ? [] : [x.icon]))
}

function commandPalette(): MenuEntry[] {
  return packageJson().contributes.menus.commandPalette ?? []
}

// Menus attached to a file, whose `when` therefore carries the gates the same
// command needs when it is reached from the palette instead.
const resourceMenus = ["explorer/context", "editor/title", "tmc.exercise"]

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

  // Pins the split itself: `registerServiceFreeCommands` must register exactly these
  // three and nothing `registerCommands` also registers, or the two other set
  // assertions in this suite would only prove the union is right, not the partition.
  test("registerServiceFreeCommands registers exactly the ids that need no service", function () {
    const { serviceFreeIds } = registerAndCollect()
    expect(serviceFreeIds.toSorted()).toEqual(expectedServiceFreeCommands.toSorted())
  })

  test("a failed activation registers only the commands it can still run", function () {
    const { ids } = registerAndCollect(createDegradedContext())
    expect(ids.toSorted()).toEqual(expectedDegradedCommands.toSorted())
  })

  test("registers no command twice", function () {
    for (const context of [createMockActionContext(), createDegradedContext()]) {
      const { ids } = registerAndCollect(context)
      expect(ids).toHaveLength(new Set(ids).size)
    }
  })

  // A command declared in package.json but never registered fails only when the
  // user runs it; one registered but not declared never shows up in the palette.
  test("the registered set and package.json's declarations agree", function () {
    const { ids } = registerAndCollect()
    expect(declaredCommands().toSorted()).toEqual(ids.toSorted())
  })

  // Unregistering a command does not take its menu entries away: without a gate the
  // user picks one and gets "command not found" instead of nothing at all.
  test("every menu entry a failed activation cannot run is gated on the state", function () {
    const stillRegistered = new Set(expectedDegradedCommands)
    const { menus } = packageJson().contributes
    const ungated = Object.entries(menus).flatMap(([menu, entries]) =>
      entries
        .filter((entry) => entry.command === undefined || !stillRegistered.has(entry.command))
        .filter(
          (entry) =>
            entry.when !== "false" && !whenTerms(entry.when).includes("test-my-code:Initialized"),
        )
        .map((entry) => `${menu}: ${entry.command ?? entry.submenu}`),
    )
    expect(ungated).toEqual([])
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
    const renderSide = vi.spyOn(TmcPanel, "renderSide").mockReturnValue(undefined)
    const { handlers } = registerAndCollect()

    await handlers.get("tmc.showMoocLogin")?.()

    expect(renderSide).toHaveBeenCalledOnce()
    expect(renderSide.mock.calls[0]?.[3]).toMatchObject({ type: "MoocLogin" })
  })

  // VS Code discards a rejected handler promise, so a command that throws would
  // otherwise leave the user staring at an unchanged screen.
  test("a failing command reports under its title instead of rejecting", async function () {
    // The mock module has no `extensions` namespace at all.
    const vscodeModule: object = vscode
    Object.defineProperty(vscodeModule, "extensions", {
      value: { getExtension: () => ({ packageJSON: packageJson() }) },
      configurable: true,
    })
    vi.spyOn(TmcPanel, "renderSide").mockImplementation(() => {
      throw new Error("the panel could not open")
    })
    const { handlers, actionContext } = registerAndCollect()

    await expect(handlers.get("tmc.showMoocLogin")?.()).resolves.toBeUndefined()

    expect(vi.mocked(actionContext.dialog.reportError)).toHaveBeenCalledWith(
      "Failed to run Log In.",
      expect.objectContaining({ message: "the panel could not open" }),
    )
  })

  // Without a reachable palette entry a user with no credentials has no way in
  // besides the tree view.
  test("the login command is reachable from the palette while logged out", function () {
    const entry = commandPalette().find((x) => x.command === "tmc.showMoocLogin")
    expect(whenTerms(entry?.when)).toContain("test-my-code:LoggedIn == false")
  })

  // A menu, keybinding or welcome-view link naming an undeclared command gives
  // the user an entry that resolves to "command not found" when they pick it.
  test("every command a contribution points at is declared", function () {
    const {
      menus,
      keybindings = [],
      viewsWelcome = [],
      walkthroughs = [],
    } = packageJson().contributes
    const steps = walkthroughs.flatMap((x) => x.steps)
    const referenced = [
      ...Object.values(menus).flatMap((entries) => entries.flatMap((x) => x.command ?? [])),
      ...keybindings.map((x) => x.command),
      ...viewsWelcome.flatMap((x) => linkedCommands(x.contents)),
      ...steps.flatMap((x) => linkedCommands(x.description)),
      ...steps.flatMap((x) =>
        (x.completionEvents ?? []).flatMap((event) => /^onCommand:(.+)$/.exec(event)?.[1] ?? []),
      ),
    ].filter((command) => !command.startsWith("workbench."))
    const declared = new Set(declaredCommands())
    expect([...new Set(referenced)].filter((x) => !declared.has(x))).toEqual([])
  })

  test("every submenu a menu points at is declared", function () {
    const { menus, submenus = [] } = packageJson().contributes
    const declared = new Set(submenus.map((x) => x.id))
    const referenced = Object.values(menus).flatMap((entries) =>
      entries.flatMap((x) => x.submenu ?? []),
    )
    expect(referenced.filter((x) => !declared.has(x))).toEqual([])
  })

  // Welcome content shows only while the view is empty, so each state needs its own entry,
  // and two entries true at once stack their buttons.
  test("the Courses view has exactly one welcome for each startup and login state", function () {
    const { viewsWelcome = [] } = packageJson().contributes
    const states = [
      { Initialized: false, Degraded: false, LoggedIn: false },
      { Initialized: false, Degraded: true, LoggedIn: false },
      { Initialized: true, Degraded: false, LoggedIn: false },
      { Initialized: true, Degraded: false, LoggedIn: true },
    ]
    for (const state of states) {
      const shown = viewsWelcome.filter((entry) =>
        whenTerms(entry.when).every((term) => {
          const negated = term.startsWith("!")
          const key = term.replace(/^!?test-my-code:/, "") as keyof typeof state
          return state[key] !== negated
        }),
      )
      expect(shown, JSON.stringify(state)).toHaveLength(1)
    }
  })

  // An action that shows on every file answers most clicks with "not part of a course
  // exercise".
  test("editor title actions show only on an exercise's files", function () {
    const entries = packageJson().contributes.menus["editor/title"] ?? []
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(whenTerms(entry.when)).toContain("test-my-code:ActiveEditorIsExercise")
    }
  })

  // A file icon ignores the theme and high contrast; a codicon follows both.
  test("every command icon is a codicon", function () {
    const icons = declaredCommandIcons()
    expect(
      icons.filter((icon) => typeof icon !== "string" || !/^\$\([\w-]+\)$/.test(icon)),
    ).toEqual([])
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
    const {
      menus,
      keybindings = [],
      viewsWelcome = [],
      walkthroughs = [],
    } = packageJson().contributes
    const gated = [...Object.values(menus).flat(), ...keybindings, ...viewsWelcome]
    const referenced = new Set([
      ...gated.flatMap((x) => [...(x.when ?? "").matchAll(/test-my-code:\w+/g)].map((m) => m[0])),
      ...walkthroughs
        .flatMap((x) => x.steps)
        .flatMap((x) => x.completionEvents ?? [])
        .flatMap((event) => /^onContext:(test-my-code:\w+)$/.exec(event)?.[1] ?? []),
    ])
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

suite("walkthrough", function () {
  test("is the single walkthrough, and every step has media that exists", function () {
    const walkthroughs = packageJson().contributes.walkthroughs ?? []
    expect(walkthroughs).toHaveLength(1)
    const root = path.join(__dirname, "..", "..", "..")
    const missing = (walkthroughs[0]?.steps ?? [])
      .map((step) => step.media.markdown ?? step.media.svg ?? step.media.image ?? step.id)
      .filter((media) => !fs.existsSync(path.join(root, media)))
    expect(missing).toEqual([])
  })

  // A step without a way to act on it is a paragraph, not a step.
  test("every step offers a button", function () {
    const steps = packageJson().contributes.walkthroughs?.[0]?.steps ?? []
    const withoutButton = steps.filter((step) => !/^\[[^\]]+\]\([^)]+\)$/m.test(step.description))
    expect(withoutButton.map((x) => x.id)).toEqual([])
  })

  // The walkthrough is the onboarding a new user sees, so the privacy notice has to be in it.
  test("a step carries the data-collection notice", function () {
    const root = path.join(__dirname, "..", "..", "..")
    const media = (packageJson().contributes.walkthroughs?.[0]?.steps ?? []).flatMap(
      (step) => step.media.markdown ?? [],
    )
    const texts = media.map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    expect(texts.some((text) => text.includes("Data collected by the extension"))).toBe(true)
  })
})

suite("registered command handlers", function () {
  test("tmc.settings opens the extension's settings page", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const { handlers } = registerAndCollect()

    await handlers.get("tmc.settings")?.()

    expect(executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "@ext:moocfi.test-my-code",
    )
  })

  test("tmc.logs shows the output channel", async function () {
    const show = vi.spyOn(Logger, "show").mockImplementation(() => {})
    const { handlers } = registerAndCollect()

    await handlers.get("tmc.logs")?.()

    expect(show).toHaveBeenCalledOnce()
  })

  test("tmc.debug clears the output, shows it, then opens the active log file", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const show = vi.spyOn(Logger, "show").mockImplementation(() => {})
    const { handlers } = registerAndCollect()

    await handlers.get("tmc.debug")?.()

    expect(executeCommand).toHaveBeenNthCalledWith(1, "workbench.output.action.clearOutput")
    expect(show).toHaveBeenCalledOnce()
    expect(executeCommand).toHaveBeenNthCalledWith(2, "workbench.action.openActiveLogOutputFile")
  })

  test("tmc.viewInitializationErrorHelp opens the recovery panel even when degraded", async function () {
    const renderMain = vi.spyOn(TmcPanel, "renderMain").mockReturnValue(undefined)
    const { handlers, context, actionContext } = registerAndCollect(createDegradedContext())

    await handlers.get("tmc.viewInitializationErrorHelp")?.()

    expect(renderMain).toHaveBeenCalledWith(
      context.extensionUri,
      context,
      actionContext,
      expect.objectContaining({ type: "InitializationErrorHelp" }),
    )
  })

  // `tmcTreeView.refreshCourses`'s wiring (progress notification, onProgress ->
  // fraction) is tested against `refreshCourses` directly, in
  // `test/commands/refreshEverything.test.ts`; the command-set test above already
  // pins that this id stays registered.

  test.each([
    ["tmc.addNewCourse", "addNewCourse"],
    ["tmc.changeTmcDataPath", "changeTmcDataPath"],
    ["tmc.logout", "logout"],
    ["tmc.switchWorkspace", "switchWorkspace"],
  ] as const)(
    "%s delegates to commands.%s with the ready context",
    async function (commandId, delegateName) {
      const delegate = vi.spyOn(commands, delegateName).mockResolvedValue(undefined)
      const { handlers, actionContext } = registerAndCollect()

      await handlers.get(commandId)?.()

      expect(delegate).toHaveBeenCalledWith(actionContext)
    },
  )

  // The Courses view hands its commands the item they ran on; code hands them a course id.
  test.each([
    ["tmc.downloadNewExercises", "downloadNewExercises"],
    ["tmc.openCourseWorkspace", "openCourseWorkspace"],
    ["tmc.removeCourse", "removeCourse"],
  ] as const)(
    "%s passes commands.%s the course, from an id, a Courses view item or neither",
    async function (commandId, delegateName) {
      const delegate = vi.spyOn(commands, delegateName).mockResolvedValue(undefined)
      const { handlers, actionContext } = registerAndCollect()
      const courseId = CourseIdentifier.from("course-uuid")
      const item = Object.assign(Object.create(CourseTreeItem.prototype) as CourseTreeItem, {
        courseId,
      })

      await handlers.get(commandId)?.(courseId)
      await handlers.get(commandId)?.(item)
      await handlers.get(commandId)?.()

      expect(delegate.mock.calls).toEqual([
        [actionContext, courseId],
        [actionContext, courseId],
        [actionContext, undefined],
      ])
    },
  )

  test.each([
    ["tmc.cleanExercise", "cleanExercise"],
    ["tmc.closeExercise", "closeExercise"],
    ["tmc.downloadOldSubmission", "downloadOldSubmission"],
    ["tmc.pasteExercise", "pasteExercise"],
    ["tmc.resetExercise", "resetExercise"],
  ] as const)(
    "%s delegates to commands.%s with the ready context and the clicked resource",
    async function (commandId, delegateName) {
      const delegate = vi.spyOn(commands, delegateName).mockResolvedValue(undefined)
      const { handlers, actionContext } = registerAndCollect()
      const resource = vscode.Uri.file("/course/exercise")

      await handlers.get(commandId)?.(resource)

      expect(delegate).toHaveBeenCalledWith(actionContext, resource)
    },
  )

  test("tmc.submitExercise delegates to commands.submitExercise with the extension context", async function () {
    const submitExercise = vi.spyOn(commands, "submitExercise").mockResolvedValue(Ok.EMPTY)
    const { handlers, context, actionContext } = registerAndCollect()
    const resource = vscode.Uri.file("/course/exercise")

    await handlers.get("tmc.submitExercise")?.(resource)

    expect(submitExercise).toHaveBeenCalledWith(context, actionContext, resource)
  })

  test("tmc.testExercise delegates to commands.testExercise with the extension context", async function () {
    const testExercise = vi.spyOn(commands, "testExercise").mockResolvedValue(undefined)
    const { handlers, context, actionContext } = registerAndCollect()
    const resource = vscode.Uri.file("/course/exercise")

    await handlers.get("tmc.testExercise")?.(resource)

    expect(testExercise).toHaveBeenCalledWith(context, actionContext, resource)
  })

  test.each([[undefined], ["silent" as const]])(
    "tmc.updateExercises passes the mode %s through to commands.updateExercises",
    async function (mode) {
      const updateExercises = vi.spyOn(commands, "updateExercises").mockResolvedValue(undefined)
      const { handlers, actionContext } = registerAndCollect()

      await handlers.get("tmc.updateExercises")?.(mode)

      expect(updateExercises).toHaveBeenCalledWith(actionContext, mode)
    },
  )

  test("tmc.wipe delegates to commands.wipe with the ready context and the extension context", async function () {
    const wipe = vi.spyOn(commands, "wipe").mockResolvedValue(undefined)
    const { handlers, context, actionContext } = registerAndCollect()

    await handlers.get("tmc.wipe")?.()

    expect(wipe).toHaveBeenCalledWith(actionContext, context)
  })

  test("tmc.myCourses opens the courses panel", async function () {
    const renderMain = vi.spyOn(TmcPanel, "renderMain").mockReturnValue(undefined)
    const { handlers, context, actionContext } = registerAndCollect()

    await handlers.get("tmc.myCourses")?.()

    expect(renderMain).toHaveBeenCalledWith(
      context.extensionUri,
      context,
      actionContext,
      expect.objectContaining({ type: "MyCourses" }),
    )
  })

  test("tmc.showWelcome opens the walkthrough package.json contributes", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const renderMain = vi.spyOn(TmcPanel, "renderMain").mockReturnValue(undefined)
    const { handlers } = registerAndCollect()
    const [walkthrough] = packageJson().contributes.walkthroughs ?? []

    await handlers.get("tmc.showWelcome")?.()

    expect(executeCommand).toHaveBeenCalledWith(
      "workbench.action.openWalkthrough",
      `${EXTENSION_ID}#${walkthrough?.id}`,
      false,
    )
    expect(renderMain).not.toHaveBeenCalled()
  })

  test("tmc.courseDetails opens the given course without asking to pick one", async function () {
    const pickCourse = vi.spyOn(commands, "pickCourse").mockResolvedValue(undefined)
    const renderMain = vi.spyOn(TmcPanel, "renderMain").mockReturnValue(undefined)
    const { handlers, context, actionContext } = registerAndCollect()
    const courseId = CourseIdentifier.from(7)

    await handlers.get("tmc.courseDetails")?.(courseId)

    expect(pickCourse).not.toHaveBeenCalled()
    expect(renderMain).toHaveBeenCalledWith(
      context.extensionUri,
      context,
      actionContext,
      expect.objectContaining({ type: "CourseDetails", courseId }),
    )
  })

  test("tmc.courseDetails asks the user to pick a course when none is given", async function () {
    const courseId = CourseIdentifier.from("course-uuid")
    vi.spyOn(commands, "pickCourse").mockResolvedValue(courseId)
    const renderMain = vi.spyOn(TmcPanel, "renderMain").mockReturnValue(undefined)
    const { handlers, context, actionContext } = registerAndCollect()

    await handlers.get("tmc.courseDetails")?.(undefined)

    expect(renderMain).toHaveBeenCalledWith(
      context.extensionUri,
      context,
      actionContext,
      expect.objectContaining({ type: "CourseDetails", courseId }),
    )
  })

  test("tmc.courseDetails opens nothing when the pick is dismissed", async function () {
    vi.spyOn(commands, "pickCourse").mockResolvedValue(undefined)
    const renderMain = vi.spyOn(TmcPanel, "renderMain").mockReturnValue(undefined)
    const { handlers } = registerAndCollect()

    await handlers.get("tmc.courseDetails")?.(undefined)

    expect(renderMain).not.toHaveBeenCalled()
  })

  test("tmc.openTMCExercisesFolder reveals the projects directory", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const { handlers } = registerAndCollect(
      createMockActionContext({
        startup: { resources: { projectsDirectory: "/tmp/tmcdata/projects" } as Resources },
      }),
    )

    await handlers.get("tmc.openTMCExercisesFolder")?.()

    expect(executeCommand).toHaveBeenCalledWith(
      "revealFileInOS",
      vscode.Uri.file("/tmp/tmcdata/projects"),
    )
  })

  test("tmc.openTMCExercisesFolder says why it opens nothing without a known projects directory", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const actionContext = createMockActionContext({
      startup: { resources: { projectsDirectory: undefined } as Resources },
    })
    const { handlers } = registerAndCollect(actionContext)

    await handlers.get("tmc.openTMCExercisesFolder")?.()

    expect(executeCommand).not.toHaveBeenCalled()
    expect(actionContext.dialog.errorNotification).toHaveBeenCalledWith(
      "Opening the exercises folder is unavailable: the TestMyCode tools did not report where the exercises folder is.",
      expect.any(Error),
    )
  })
})

// VS Code's own Windows/Linux defaults, transcribed. An extension binding of
// equal specificity outranks a default, so any key claimed from here is
// shadowed wherever the binding's `when` holds.
const vsCodeDefaultKeys: Record<string, string> = {
  "ctrl+shift+a": "editor.action.blockComment",
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
  // A binding outranks whatever VS Code, the desktop or an input method has on the same
  // chord. Adding one means editing this list, which puts the check below in front of
  // whoever adds it.
  test("claims exactly the reviewed keys", function () {
    expect(packageJson().contributes.keybindings ?? []).toEqual([])
  })

  test("shadows no VS Code default", function () {
    const shadowed = (packageJson().contributes.keybindings ?? [])
      .map((x) => x.key)
      .filter((key) => key in vsCodeDefaultKeys)
    expect(shadowed).toEqual([])
  })
})

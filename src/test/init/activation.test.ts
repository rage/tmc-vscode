import * as path from "path"

import * as fs from "fs-extra"
import * as tmp from "tmp"
import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { EXERCISE_CHECK_INTERVAL } from "../../config/constants"
import { CorruptStoredDataError } from "../../errors"
import { activate } from "../../extension"
import { Logger, LogLevel } from "../../utilities"
import { createMockMemento } from "../mocks/vscode"

const recorded = vi.hoisted(() => ({
  treeEntryIds: [] as string[],
  treeLoggedIn: [] as boolean[],
  panelTypes: [] as string[],
  uiDisposals: 0,
}))

/** The stubbed CLI's answers, and what activation asked of it. */
const langsStub = vi.hoisted(() => ({
  tmcAuthenticated: false,
  moocAuthenticated: false,
  authChecks: 0,
  killAllProcessesCalls: 0,
  settingsWritten: [] as [string, unknown][],
  /** What activation subscribed to, so a test can fire an event at it. */
  handlers: new Map<string, (payload: never) => void>(),
}))

/** The writer activation hands `WorkspaceManager`, so a test can drive it. */
const workspaceManagerStub = vi.hoisted(() => ({
  persistClosedExercises: undefined as
    | ((
        backend: "tmc" | "mooc",
        courseSlug: string,
        closedExerciseSlugs: string[],
      ) => Promise<unknown>)
    | undefined,
}))

// Swapped per test so a suite can decide what global state holds.
const storedUserData = vi.hoisted(() => ({ read: (): unknown => undefined }))

const cliSettings = vi.hoisted(() => ({ projectsDirectory: "" }))

const storedMigration = vi.hoisted(() => ({ outcome: { kind: "done" } as unknown }))

const registration = vi.hoisted(() => ({ dispose: (): void => {} }))

// jest-mock-vscode ships neither the `env` nor the `extensions` namespace, and activation
// reads the editor name and the extension version from them. Its registration functions
// also return nothing where the real API returns a `Disposable`, and activation puts what
// they return into `context.subscriptions`.
vi.mock("vscode", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    env: { appName: "Visual Studio Code" },
    extensions: { getExtension: () => ({ packageJSON: { version: "3.0.0" } }) },
    commands: {
      ...(original["commands"] as Record<string, unknown>),
      registerCommand: () => registration,
    },
    window: {
      ...(original["window"] as Record<string, unknown>),
      registerFileDecorationProvider: () => registration,
    },
    workspace: {
      ...(original["workspace"] as Record<string, unknown>),
      onDidChangeConfiguration: () => registration,
      onDidChangeWorkspaceFolders: () => registration,
      onDidOpenTextDocument: () => registration,
    },
  }
})

vi.mock("../../ui/ui", () => ({
  default: class {
    public treeDP = {
      registerAction: ({ id }: { id: string }): void => {
        recorded.treeEntryIds.push(id)
      },
      setLoggedIn: (loggedIn: boolean): void => {
        recorded.treeLoggedIn.push(loggedIn)
      },
    }
    public createUiActionHandler = (): unknown => (): void => {}
    public dispose = (): void => {
      recorded.uiDisposals += 1
    }
  },
}))

vi.mock("../../panels/TmcPanel", () => ({
  randomPanelId: () => 1,
  registerWebviewHandlers: () => {},
  TmcPanel: {
    renderMain: (
      _uri: unknown,
      _context: unknown,
      _actionContext: unknown,
      panel: { type: string },
    ) => {
      recorded.panelTypes.push(panel.type)
    },
    renderSide: () => {},
    postMessage: () => {},
  },
}))

// Wraps the real manager to capture the writer activation constructs it with; nothing
// else can reach that closure.
vi.mock("../../api/workspaceManager", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../api/workspaceManager")>()
  return {
    ...original,
    default: class extends original.default {
      public constructor(...args: ConstructorParameters<typeof original.default>) {
        super(...args)
        workspaceManagerStub.persistClosedExercises = args[1]
      }
    },
  }
})

vi.mock("../../api/langs", () => ({
  default: class {
    public isAuthenticated = async (): Promise<unknown> => {
      langsStub.authChecks += 1
      return Ok(langsStub.tmcAuthenticated)
    }
    public isMoocAuthenticated = async (): Promise<unknown> => {
      langsStub.authChecks += 1
      return Ok(langsStub.moocAuthenticated)
    }
    public getSetting = async (): Promise<unknown> => Ok(cliSettings.projectsDirectory)
    public setSetting = async (key: string, value: unknown): Promise<unknown> => {
      langsStub.settingsWritten.push([key, value])
      return Ok.EMPTY
    }
    public on = (event: string, callback: (payload: never) => void): void => {
      langsStub.handlers.set(event, callback)
    }
    public killAllProcesses = (): void => {
      langsStub.killAllProcessesCalls += 1
    }
  },
}))

vi.mock("../../storage", () => ({
  default: class {
    public getUserData = (): unknown => storedUserData.read()
    public getSessionState = (): undefined => undefined
    public updateSessionState = async (): Promise<void> => {}
    public migrateToLatest = async (): Promise<unknown> => storedMigration.outcome
  },
}))

vi.mock("../../init/ensureLangsUpdated", () => ({
  ensureLangsUpdated: async (): Promise<unknown> => Ok("/nonexistent/tmc-langs-cli"),
}))

vi.mock("../../init/verifyCliSchema", () => ({
  verifyCliSchema: async (): Promise<void> => {},
}))

// `registerCommands` reads the handlers it hands the panel layer eagerly, so every one
// of them has to exist here even though no test drives a webview message.
vi.mock("../../actions", () => ({
  refreshEverything: async (): Promise<unknown> => Ok.EMPTY,
  refreshLocalExercises: async (): Promise<unknown> => Ok.EMPTY,
  testInterrupts: new Map(),
  closeExercises: async (): Promise<unknown> => Ok.EMPTY,
  downloadAndOpenExercises: async (): Promise<unknown> => Ok.EMPTY,
  downloadExercisesForUi: async (): Promise<void> => {},
  openWorkspace: async (): Promise<void> => {},
  pasteMoocExercise: async (): Promise<unknown> => Ok.EMPTY,
  pasteTmcExercise: async (): Promise<unknown> => Ok.EMPTY,
  removeCourse: async (): Promise<void> => {},
  updateCourse: async (): Promise<unknown> => Ok.EMPTY,
}))

/** Contexts handed to `activate`, so a test can shut each one down the way VS Code does. */
const activatedContexts: vscode.ExtensionContext[] = []

function disposeActivatedContexts(): void {
  for (const context of activatedContexts.splice(0)) {
    for (const subscription of context.subscriptions) {
      subscription.dispose()
    }
  }
}

function createContext(): vscode.ExtensionContext {
  const globalStorage = tmp.dirSync().name
  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file(globalStorage),
    extensionPath: globalStorage,
    globalStorageUri: vscode.Uri.file(globalStorage),
    globalStoragePath: globalStorage,
    globalState: createMockMemento(),
    asAbsolutePath: (relative: string) => path.join(globalStorage, relative),
  } as unknown as vscode.ExtensionContext
  activatedContexts.push(context)
  return context
}

/**
 * An extension context whose global storage path is unwritable: the folder the
 * workspace files go in is occupied by a regular file.
 */
function createContextWithBlockedStorage(): vscode.ExtensionContext {
  const context = createContext()
  fs.writeFileSync(path.join(context.globalStorageUri.fsPath, "workspaces"), "not a folder")
  return context
}

function resetActivationRecording(): void {
  Logger.configure(LogLevel.None)
  recorded.treeEntryIds.length = 0
  recorded.treeLoggedIn.length = 0
  recorded.panelTypes.length = 0
  recorded.uiDisposals = 0
  storedUserData.read = (): unknown => undefined
  storedMigration.outcome = { kind: "done" }
  langsStub.tmcAuthenticated = false
  langsStub.moocAuthenticated = false
  langsStub.authChecks = 0
  langsStub.killAllProcessesCalls = 0
  langsStub.settingsWritten.length = 0
  langsStub.handlers.clear()
  workspaceManagerStub.persistClosedExercises = undefined
  cliSettings.projectsDirectory = tmp.dirSync().name
  vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)
}

suite("activation with unusable storage", function () {
  beforeEach(resetActivationRecording)

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  // Every branch written for a failed initialization -- the recovery entries, the help
  // panel, the commands -- runs after resource initialization, so a throw there reaches
  // none of them and the user is left with an error message and an empty sidebar.
  test("offers the recovery entries instead of aborting", async function () {
    await activate(createContextWithBlockedStorage())

    expect(recorded.treeEntryIds).toContain("tmc.viewInitializationErrorHelp")
    expect(recorded.treeEntryIds).toContain("workbench.action.restartExtensionHost")
  })

  test("opens the initialization error help panel", async function () {
    await activate(createContextWithBlockedStorage())

    expect(recorded.panelTypes).toContain("InitializationErrorHelp")
  })

  test("reports the failure as an initialization error, not a fatal one", async function () {
    await activate(createContextWithBlockedStorage())

    const messages = vi.mocked(vscode.window.showErrorMessage).mock.calls.map((call) => call[0])
    expect(messages.join("\n")).not.toContain("Fatal error")
    expect(messages.join("\n")).toContain("resource initialization")
  })
})

suite("activation with unreadable stored data", function () {
  beforeEach(function () {
    resetActivationRecording()
    storedUserData.read = (): never => {
      throw new CorruptStoredDataError("Stored extension data could not be read.")
    }
  })

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  // Stored data this version cannot parse is recoverable -- the wipe command, a
  // downgrade -- but only if the user is given somewhere to start.
  test("offers the recovery entries instead of aborting", async function () {
    await activate(createContext())

    expect(recorded.treeEntryIds).toContain("tmc.viewInitializationErrorHelp")
    expect(recorded.panelTypes).toContain("InitializationErrorHelp")
  })
})

suite("activation with usable storage", function () {
  beforeEach(resetActivationRecording)

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  test("offers no recovery entries", async function () {
    await activate(createContext())

    expect(recorded.treeEntryIds).not.toContain("tmc.viewInitializationErrorHelp")
    expect(recorded.panelTypes).toEqual([])
  })
})

suite("the record of a course's closed exercises", function () {
  beforeEach(resetActivationRecording)

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  // `refreshLocalExercises` reads this setting back by the same key, and the manager
  // skips a write it believes it already made, so a key that disagrees strands closed
  // exercises with nothing to correct it.
  test("writes it to the backend-tagged settings key", async function () {
    await activate(createContext())

    expect(workspaceManagerStub.persistClosedExercises).toBeDefined()
    await workspaceManagerStub.persistClosedExercises?.("mooc", "mooc-python-course", [
      "mooc_hello",
    ])

    expect(langsStub.settingsWritten).toEqual([
      ["closed-exercises-for:mooc:mooc-python-course", ["mooc_hello"]],
    ])
  })
})

suite("the maintenance poll", function () {
  beforeEach(function () {
    resetActivationRecording()
    vi.useFakeTimers()
  })

  afterEach(function () {
    disposeActivatedContexts()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Each round is two cold CLI process starts, and it can only observe a session that a
  // logged-out user does not have.
  test("asks the CLI nothing while logged out", async function () {
    await activate(createContext())
    const checksDuringActivation = langsStub.authChecks

    await vi.advanceTimersByTimeAsync(EXERCISE_CHECK_INTERVAL * 3)

    expect(langsStub.authChecks).toBe(checksDuringActivation)
  })

  test("rechecks both backends while logged in", async function () {
    langsStub.moocAuthenticated = true
    await activate(createContext())
    const checksDuringActivation = langsStub.authChecks

    await vi.advanceTimersByTimeAsync(EXERCISE_CHECK_INTERVAL)

    expect(langsStub.authChecks).toBe(checksDuringActivation + 2)
  })

  test("stops once the context is disposed", async function () {
    langsStub.moocAuthenticated = true
    await activate(createContext())
    disposeActivatedContexts()
    const checksBeforeAdvancing = langsStub.authChecks

    await vi.advanceTimersByTimeAsync(EXERCISE_CHECK_INTERVAL * 3)

    expect(langsStub.authChecks).toBe(checksBeforeAdvancing)
  })
})

suite("shutdown", function () {
  beforeEach(resetActivationRecording)

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  // `wipe` disposes the context by hand and VS Code does it on deactivation, so
  // everything activation starts has to hang off `context.subscriptions`.
  test("disposing the context kills the CLI processes and the tree view", async function () {
    await activate(createContext())

    disposeActivatedContexts()

    expect(langsStub.killAllProcessesCalls).toBe(1)
    expect(recorded.uiDisposals).toBe(1)
  })
})

suite("notifications from the CLI", function () {
  beforeEach(function () {
    resetActivationRecording()
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
  })

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  // The CLI is the only thing that knows a student's toolchain is too old to run
  // their tests, and it says so through this event.
  test("shows a CLI warning to the user", async function () {
    await activate(createContext())

    const onNotification = langsStub.handlers.get("notification")
    expect(onNotification).toBeDefined()
    onNotification?.({
      message: "Your Python is out of date.",
      "notification-kind": "warning",
    } as never)

    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0]?.[0]).toContain(
      "Your Python is out of date.",
    )
  })
})

suite("activation in a workspace the migration cannot use in place", function () {
  const workspaceName = "python-course.code-workspace"

  beforeEach(function () {
    resetActivationRecording()
    storedMigration.outcome = { kind: "needsReload", workspaceName }
  })

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  test("reopens the window on the workspace file it wrote", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const context = createContext()

    await activate(context)

    const workspaceFile = path.join(context.globalStorageUri.fsPath, "workspaces", workspaceName)
    expect(fs.existsSync(workspaceFile)).toBe(true)
    expect(executeCommand).toHaveBeenCalledWith(
      "vscode.openFolder",
      expect.objectContaining({ fsPath: workspaceFile }),
    )
  })

  // The window is about to be replaced, so anything registered here would be
  // registered twice over the two activations.
  test("registers nothing before the reload", async function () {
    await activate(createContext())

    expect(recorded.treeEntryIds).toEqual([])
  })
})

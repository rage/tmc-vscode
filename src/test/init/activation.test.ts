import * as path from "path"

import * as fs from "fs-extra"
import * as tmp from "tmp"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { EXERCISE_CHECK_INTERVAL } from "../../config/constants"
import { CorruptStoredDataError } from "../../errors"
import { activate } from "../../extension"
import type { BackendKind } from "../../shared/shared"
import { Logger, LogLevel } from "../../utilities"
import { createMockMemento } from "../mocks/vscode"

const recorded = vi.hoisted(() => ({
  treeEntryIds: [] as string[],
  registeredCommandIds: [] as string[],
  /** A snapshot of `registeredCommandIds`, taken when the CLI download step starts. */
  commandsRegisteredBeforeCliDownload: undefined as string[] | undefined,
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
  /** When set, both `isAuthenticated` and `getSetting` fail with this same error. */
  sharedFailure: undefined as Error | undefined,
}))

/** The writer activation hands `WorkspaceManager`, so a test can drive it. */
const workspaceManagerStub = vi.hoisted(() => ({
  persistClosedExercises: undefined as
    | ((
        backend: BackendKind,
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

/** When set, `ensureLangsUpdated` fails with it. */
const langsDownload = vi.hoisted(() => ({ failure: undefined as Error | undefined }))

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
      registerCommand: (id: string) => {
        recorded.registeredCommandIds.push(id)
        return registration
      },
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
  nextPanelId: () => 1,
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
      return langsStub.sharedFailure ? Err(langsStub.sharedFailure) : Ok(langsStub.tmcAuthenticated)
    }
    public isMoocAuthenticated = async (): Promise<unknown> => {
      langsStub.authChecks += 1
      return Ok(langsStub.moocAuthenticated)
    }
    public getSetting = async (): Promise<unknown> =>
      langsStub.sharedFailure ? Err(langsStub.sharedFailure) : Ok(cliSettings.projectsDirectory)
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
  ensureLangsUpdated: async (): Promise<unknown> => {
    recorded.commandsRegisteredBeforeCliDownload = [...recorded.registeredCommandIds]
    return langsDownload.failure ? Err(langsDownload.failure) : Ok("/nonexistent/tmc-langs-cli")
  },
}))

vi.mock("../../init/verifyCliSchema", () => ({
  verifyCliSchema: async (): Promise<void> => {},
}))

// `registerCommands` reads the handlers it hands the panel layer eagerly, so every one
// of them has to exist here even though no test drives a webview message.
vi.mock("../../actions", () => ({
  refreshLocalExercises: async (): Promise<unknown> => Ok.EMPTY,
  cancelTestRun: (): void => {},
  closeExercises: async (): Promise<unknown> => Ok.EMPTY,
  downloadAndOpenExercises: async (): Promise<unknown> => Ok.EMPTY,
  downloadExercisesForUi: async (): Promise<void> => {},
  pasteExercise: async (): Promise<unknown> => Ok.EMPTY,
  removeCourse: async (): Promise<void> => {},
  updateCourse: async (): Promise<unknown> => Ok.EMPTY,
}))

// `refreshEverything` moved here from `../../actions`; it is the only export the
// activation background refresh actually invokes. `registerCommands` reads every
// other one eagerly too, building the webview handler table and its own command
// closures, so each has to exist here even though none of them runs.
vi.mock("../../commands", () => ({
  refreshEverything: async (): Promise<unknown> => Ok.EMPTY,
  refreshCourses: async (): Promise<void> => {},
  addNewCourse: async (): Promise<void> => {},
  changeTmcDataPath: async (): Promise<void> => {},
  cleanExercise: async (): Promise<void> => {},
  closeExercise: async (): Promise<void> => {},
  downloadNewExercises: async (): Promise<void> => {},
  downloadOldSubmission: async (): Promise<void> => {},
  logout: async (): Promise<void> => {},
  openExercisesFolder: async (): Promise<void> => {},
  openWorkspace: async (): Promise<void> => {},
  pasteExercise: async (): Promise<void> => {},
  pickCourse: async (): Promise<unknown> => undefined,
  resetExercise: async (): Promise<void> => {},
  submitExercise: async (): Promise<unknown> => Ok.EMPTY,
  switchWorkspace: async (): Promise<void> => {},
  testExercise: async (): Promise<void> => {},
  updateExercises: async (): Promise<void> => {},
  wipe: async (): Promise<void> => {},
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
  recorded.registeredCommandIds.length = 0
  recorded.commandsRegisteredBeforeCliDownload = undefined
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
  langsStub.sharedFailure = undefined
  langsDownload.failure = undefined
  workspaceManagerStub.persistClosedExercises = undefined
  cliSettings.projectsDirectory = tmp.dirSync().name
  vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)
}

/**
 * The extension's own commands activation ran but never registered.
 *
 * VS Code rejects such a call, and `activateInner` awaits it, so everything after it --
 * the initialization help panel included -- is skipped.
 */
async function unregisteredCommandsRun(context: vscode.ExtensionContext): Promise<string[]> {
  const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

  await activate(context)

  const registered = new Set(recorded.registeredCommandIds)
  return executeCommand.mock.calls
    .map((call) => String(call[0]))
    .filter((id) => id.startsWith("tmc.") && !registered.has(id))
}

/** What activation had registered by the time it set the context key `key`. */
async function commandsRegisteredWhenContextSet(
  context: vscode.ExtensionContext,
  key: string,
): Promise<string[] | undefined> {
  let registered: string[] | undefined
  vi.spyOn(vscode.commands, "executeCommand").mockImplementation(
    async (command: string, ...args: unknown[]) => {
      if (command === "setContext" && args[0] === key) {
        registered = [...recorded.registeredCommandIds]
      }
      return undefined
    },
  )

  await activate(context)

  return registered
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

suite("initialization error deduplication", function () {
  beforeEach(resetActivationRecording)

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  // The authentication check and the datapath lookup are two separate steps that both
  // fail when the CLI is unreachable -- one problem for the user, so one toast.
  test("shows one notification per distinct initialization failure", async function () {
    langsStub.sharedFailure = new Error("tmc-langs-cli is unreachable")
    const logError = vi.spyOn(Logger, "error")

    await activate(createContext())

    const loggedSteps = logError.mock.calls
      .map((call) => String(call[0]))
      .filter((m) => m.includes("Initialization error"))
    // Confirms the scenario genuinely drives two failing steps sharing one cause; with
    // only one, a missing dedup would pass the toast assertion below by accident.
    expect(loggedSteps.some((m) => m.includes("authentication check"))).toBe(true)
    expect(loggedSteps.some((m) => m.includes("finding datapath"))).toBe(true)

    const toasts = vi
      .mocked(vscode.window.showErrorMessage)
      .mock.calls.map((call) => String(call[0]))
      .filter((m) => m.includes("Initialization error"))
    expect(toasts).toHaveLength(1)
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

  test("runs no command it left unregistered", async function () {
    expect(await unregisteredCommandsRun(createContext())).toEqual([])
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

  // VS Code rejects a command it cannot find, so an entry this key uncovers before its
  // command exists errors the moment the user picks it.
  test("registers the commands this key uncovers before setting it", async function () {
    const registered = await commandsRegisteredWhenContextSet(
      createContext(),
      "test-my-code:Initialized",
    )

    expect(registered).toBeDefined()
    expect(registered).toContain("tmc.addNewCourse")
    expect(registered).toContain("tmc.testExercise")
  })

  // A stalled CLI download shouldn't strand a user with no palette entries at all --
  // "Show Logs" in particular has to be reachable before the download that might be
  // the very thing worth looking at the logs for. An end-state assertion can't show
  // this: the final registered set looks the same whichever step registers it.
  test("registers the service-free commands before downloading the CLI", async function () {
    await activate(createContext())

    expect(recorded.commandsRegisteredBeforeCliDownload).toContain("tmc.logs")
  })

  test("runs no command it left unregistered", async function () {
    expect(await unregisteredCommandsRun(createContext())).toEqual([])
  })
})

// The only failure reachable here that leaves the resources and the stored data intact.
suite("activation without the CLI", function () {
  beforeEach(function () {
    resetActivationRecording()
    langsDownload.failure = new Error("tmc-langs-cli could not be downloaded")
  })

  afterEach(function () {
    disposeActivatedContexts()
    vi.restoreAllMocks()
  })

  test("offers the recovery entries instead of aborting", async function () {
    await activate(createContext())

    expect(recorded.treeEntryIds).toContain("tmc.viewInitializationErrorHelp")
    expect(recorded.panelTypes).toContain("InitializationErrorHelp")
  })

  test("runs no command it left unregistered", async function () {
    expect(await unregisteredCommandsRun(createContext())).toEqual([])
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

  // Tree entries never register here (`registerUiActions` runs after this return).
  // The five service-free commands do, since `registerServiceFreeCommands` now runs
  // ahead of the migration check -- but `vscode.openFolder` reloads the window into a
  // fresh extension host process, discarding this one's `context.subscriptions` before
  // the next activation registers anything, so nothing collides.
  test("registers no tree entry before the reload", async function () {
    await activate(createContext())

    expect(recorded.treeEntryIds).toEqual([])
    expect(recorded.registeredCommandIds).toContain("tmc.logs")
  })
})

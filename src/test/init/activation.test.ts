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
  panelTypes: [] as string[],
  uiDisposals: 0,
}))

/** The stubbed CLI's answers, and what activation asked of it. */
const langsStub = vi.hoisted(() => ({
  tmcAuthenticated: false,
  moocAuthenticated: false,
  authChecks: 0,
  killAllProcessesCalls: 0,
}))

// Swapped per test so a suite can decide what global state holds.
const storedUserData = vi.hoisted(() => ({ read: (): unknown => undefined }))

const cliSettings = vi.hoisted(() => ({ projectsDirectory: "" }))

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
      registerAction: (_label: string, id: string): void => {
        recorded.treeEntryIds.push(id)
      },
      createVisibilityGroup: (): unknown => ({ id: "_0", not: { id: "!_0" } }),
      updateVisibility: (): void => {},
    }
    public createUiActionHandler = (): unknown => (): void => {}
    public dispose = (): void => {
      recorded.uiDisposals += 1
    }
  },
}))

vi.mock("../../panels/TmcPanel", () => ({
  randomPanelId: () => 1,
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
    public on = (): void => {}
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
    public migrateToLatest = async (): Promise<unknown> => Ok.EMPTY
  },
}))

vi.mock("../../init/ensureLangsUpdated", () => ({
  ensureLangsUpdated: async (): Promise<unknown> => Ok("/nonexistent/tmc-langs-cli"),
}))

vi.mock("../../init/verifyCliSchema", () => ({
  verifyCliSchema: async (): Promise<void> => {},
}))

vi.mock("../../actions", () => ({
  refreshEverything: async (): Promise<unknown> => Ok.EMPTY,
  refreshLocalExercises: async (): Promise<unknown> => Ok.EMPTY,
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
  recorded.panelTypes.length = 0
  recorded.uiDisposals = 0
  storedUserData.read = (): unknown => undefined
  langsStub.tmcAuthenticated = false
  langsStub.moocAuthenticated = false
  langsStub.authChecks = 0
  langsStub.killAllProcessesCalls = 0
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

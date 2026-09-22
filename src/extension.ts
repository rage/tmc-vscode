import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { refreshEverything, refreshLocalExercises } from "./actions"
import type { ActionContext, Startup } from "./actions/types"
import { isReady } from "./actions/types"
import { createAuthState } from "./api/authState"
import Dialog from "./api/dialog"
import ExerciseDecorationProvider from "./api/exerciseDecorationProvider"
import Langs from "./api/langs"
import WorkspaceManager, {
  ensureCourseWorkspaceFile,
  ensureWorkspaceRootFile,
} from "./api/workspaceManager"
import {
  CLIENT_NAME,
  closedExercisesSettingKey,
  DEBUG_MODE,
  EXERCISE_CHECK_INTERVAL,
  EXTENSION_ID,
  EXTENSION_VERSION,
  TMC_LANGS_CONFIG_DIR,
  TMC_LANGS_DL_URL,
  TMC_LANGS_VERSION,
} from "./config/constants"
import Settings from "./config/settings"
import { UserData } from "./config/userdata"
import { EmptyLangsResponseError, FileSystemError, InitializationError, SpawnError } from "./errors"
import * as init from "./init"
import { nextPanelId, TmcPanel } from "./panels/TmcPanel"
import { createSessionExpiryTracker } from "./sessionExpiryTracker"
import Storage from "./storage"
import UI from "./ui/ui"
import { cliFolder, Logger, semVerCompare } from "./utilities"

/**
 * Builds the reporter an activation uses for the initialization steps that fail.
 *
 * One root cause -- an unreachable CLI, say -- fails most of the steps that follow, so the
 * reporter notifies once per distinct error and only logs the repeats. Each activation
 * needs its own, or a later one would stay silent about a failure it shares with the first.
 */
function makeInitializationErrorReporter(
  dialog: Dialog,
  langsFolder: string,
): (step: string, error: Error) => void {
  const alreadyReported = new Set<string>()
  return (step, error) => {
    const message =
      `Initialization error during ${step}. If this issue is not resolved, the extension may` +
      " not function properly."
    const signature = `${error.name}\n${error.message}`
    if (alreadyReported.has(signature)) {
      Logger.error(message, error)
      return
    }
    alreadyReported.add(signature)
    void dialog.reportError(message, error)
    if (error instanceof EmptyLangsResponseError || error instanceof SpawnError) {
      void dialog.errorNotification(
        "This error may have been caused by an interfering antivirus program. " +
          `Please try adding an exception for the following folder: ${langsFolder}`,
      )
    }
  }
}

/** The failed ones among these services, keyed by name. */
function startupFailures(services: Record<string, Result<unknown, Error>>): Record<string, Error> {
  return Object.fromEntries(
    Object.entries(services).flatMap(([service, result]) =>
      result.err ? [[service, result.val] as const] : [],
    ),
  )
}

/**
 * Puts the workspace files a pre-2.0 window needs in their current home and reopens
 * the window there, which is what lets the next activation migrate its stored data.
 */
async function reopenInMigratedWorkspace(
  workspaceFileFolder: string,
  workspaceName: string,
): Promise<Result<void, Error>> {
  const workspaceFile = path.join(workspaceFileFolder, workspaceName)
  try {
    await ensureCourseWorkspaceFile(workspaceFile)
    await ensureWorkspaceRootFile(workspaceFileFolder)
  } catch (e) {
    return new Err(new FileSystemError(e, "Failed to create the migrated workspace files"))
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(workspaceFile))
  return Ok.EMPTY
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    await activateInner(context)
  } catch (e) {
    // this should never occur, we always want to activate the extension even if only partially
    Logger.error("Fatal error during initialization:", e)
    const message = e instanceof Error ? e.message : String(e)
    vscode.window.showErrorMessage(
      `Fatal error during TestMyCode extension initialization: ${message}`,
    )
    Logger.show()
  }
}

async function activateInner(context: vscode.ExtensionContext): Promise<void> {
  const storage = new Storage(context)
  const settings = new Settings()
  context.subscriptions.push(settings)
  // Must precede the first CLI invocation below: the user's level decides what the output
  // channel keeps of a `logged-in` response, which carries a live OAuth token.
  Logger.configure(settings.getLogLevel())
  context.subscriptions.push({ dispose: () => Logger.dispose() })
  // Kept at every level: it carries no credential, and it is what makes a pasted log
  // answerable in a bug report.
  Logger.banner(`Starting ${EXTENSION_ID} in "${DEBUG_MODE ? "development" : "production"}" mode.`)
  Logger.banner(`${vscode.env.appName} version: ${vscode.version}`)
  Logger.banner(`${EXTENSION_ID} version: ${EXTENSION_VERSION}`)
  Logger.banner(`Currently open workspace: ${vscode.workspace.name}`)

  // Gates the developer-only palette entries (e.g. "Show Debug View").
  await vscode.commands.executeCommand("setContext", "test-my-code:DebugMode", DEBUG_MODE)

  const dialog = new Dialog()
  const ui = new UI()
  context.subscriptions.push(ui)
  init.registerServiceFreeCommands(context, dialog, ui)
  const cliFolderPath = cliFolder(context)
  const reportInitializationError = makeInitializationErrorReporter(dialog, cliFolderPath)
  const cliPathResult = await init.ensureLangsUpdated(
    cliFolderPath,
    dialog,
    { downloadUrl: TMC_LANGS_DL_URL, version: TMC_LANGS_VERSION },
    context.globalState,
  )

  // download langs if necessary
  let langs: Result<Langs, Error>
  if (cliPathResult.err) {
    langs = cliPathResult
    reportInitializationError("tmc-langs setup", cliPathResult.val)
  } else {
    // fire-and-forget: verify the CLI's output contract matches this build's schema
    void init.verifyCliSchema(cliPathResult.val, context.extensionPath)
    const langsInstance = new Langs(cliPathResult.val, CLIENT_NAME, EXTENSION_VERSION, {
      cliConfigDir: TMC_LANGS_CONFIG_DIR,
    })
    // A submit or paste would otherwise keep polling the backend past shutdown.
    context.subscriptions.push({ dispose: () => langsInstance.killAllProcesses() })
    langs = new Ok(langsInstance)
  }

  const authState = createAuthState(langs, ui)
  const initialAuthCheck = await authState.refresh({ timeout: 15000 })
  if (initialAuthCheck.tmc.err) {
    reportInitializationError("authentication check", initialAuthCheck.tmc.val)
  }
  if (initialAuthCheck.mooc.err) {
    Logger.warn("Could not check mooc login status", initialAuthCheck.mooc.val)
  }

  const workspaceFileFolder = path.join(context.globalStorageUri.fsPath, "workspaces")

  // migrate data between versions
  if (langs.ok) {
    const migration = await storage.migrateToLatest(
      context,
      dialog,
      langs.val,
      vscode.workspace.getConfiguration(),
    )
    if (migration.kind === "needsReload") {
      const reopened = await reopenInMigratedWorkspace(workspaceFileFolder, migration.workspaceName)
      if (reopened.ok) {
        Logger.warn("Extension expected to restart to migrate the open workspace")
        return
      }
      reportInitializationError("migration", reopened.val)
    } else if (migration.kind === "failed") {
      reportInitializationError("migration", migration.error)
    }
  } else {
    Logger.warn("Skipped data migration")
  }

  // get data path
  let tmcDataPath: string | undefined
  if (langs.ok) {
    const dataPathResult = await langs.val.getSetting(
      "projects-dir",
      (object): object is string => typeof object === "string",
    )
    if (dataPathResult.err) {
      Logger.error("Failed to define datapath:", dataPathResult.val)
      reportInitializationError("finding datapath", dataPathResult.val)
    } else if (dataPathResult.val === undefined) {
      Logger.error("Failed to define datapath: no value found.")
      reportInitializationError("finding datapath", new Error("No value for datapath."))
    } else {
      tmcDataPath = dataPathResult.val
    }
  }

  const resources = await init.resourceInitialization(
    context,
    storage,
    EXTENSION_VERSION,
    tmcDataPath,
    workspaceFileFolder,
  )
  if (resources.err) {
    reportInitializationError("resource initialization", resources.val)
  }

  // Armed only while logged in: each round is two cold CLI starts, and a session can only
  // drop silently for someone who has one.
  let maintenancePoll: NodeJS.Timeout | undefined
  function setMaintenancePollArmed(armed: boolean): void {
    if (armed === (maintenancePoll !== undefined)) {
      return
    }
    if (armed) {
      maintenancePoll = setInterval(() => void runMaintenancePoll(), EXERCISE_CHECK_INTERVAL)
    } else {
      clearInterval(maintenancePoll)
      maintenancePoll = undefined
    }
  }
  context.subscriptions.push({ dispose: () => setMaintenancePollArmed(false) })
  authState.subscribe(setMaintenancePollArmed)

  // Both backends are authenticated by the same courses.mooc.fi credential, so
  // either one expiring is fixed by the same device-flow login.
  const sessionExpiredWarning = (): void => {
    dialog.warningNotification("Your session has expired, please log in.", [
      "Log in",
      (): void => {
        vscode.commands.executeCommand("tmc.showMoocLogin")
      },
    ])
  }

  // Seeded from the startup check above; shared with the background poll further down.
  const sessionExpiry = createSessionExpiryTracker(
    { tmc: authState.tmc, mooc: authState.mooc },
    sessionExpiredWarning,
  )

  if (langs.ok) {
    langs.val.on("logout", async (expected) => {
      await authState.set("tmc", false)
      sessionExpiry.onLogout("tmc", expected)
    })
    langs.val.on("mooc-login", async () => {
      await authState.set("mooc", true)
      sessionExpiry.onLogin("mooc")
      // A CLI that authenticates the tmc backend with the mooc token resolves an
      // earlier tmc expiry too. Whether it does is a property of the pinned CLI,
      // so drop the stale tmc state rather than claiming a session: the next
      // background check is what re-arms the warning.
      sessionExpiry.reset("tmc")
    })
    langs.val.on("mooc-logout", async (expected) => {
      await authState.set("mooc", false)
      sessionExpiry.onLogout("mooc", expected)
    })
    langs.val.on("notification", (notification) => {
      void dialog.warningNotification(notification.message)
    })
  } else {
    Logger.warn("Skipped login command setup")
  }

  let showWelcome = false
  if (resources.ok) {
    const currentVersion = resources.val.extensionVersion
    try {
      const previousVersion = storage.getSessionState()?.extensionVersion
      if (currentVersion !== previousVersion) {
        storage.updateSessionState({ extensionVersion: currentVersion })
      }
      const versionDiff = semVerCompare(currentVersion, previousVersion || "", "minor")
      if (versionDiff === undefined || versionDiff > 0) {
        showWelcome = true
      }
    } catch (e) {
      // An unreadable session state costs the welcome page, nothing else.
      Logger.warn("Skipped version check", e)
    }
  } else {
    Logger.warn("Skipped version check")
  }

  let userData: Result<UserData, Error>
  let workspaceManager: Result<WorkspaceManager, Error>
  let exerciseDecorationProvider: Result<ExerciseDecorationProvider, Error>
  if (resources.ok) {
    workspaceManager = new Ok(
      new WorkspaceManager(resources.val, (backend, courseSlug, closedExerciseSlugs) =>
        langs.ok
          ? langs.val.setSetting(
              closedExercisesSettingKey(backend, courseSlug),
              closedExerciseSlugs,
            )
          : Promise.resolve(
              new Err(new InitializationError("Cannot record closed exercises without tmc-langs")),
            ),
      ),
    )
    context.subscriptions.push(workspaceManager.val)
    if (workspaceManager.val.activeCourse) {
      await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", true)
      await workspaceManager.val.verifyWorkspaceSettingsIntegrity()
    }
    // Stored data this version cannot parse must degrade the extension, not abort it.
    try {
      userData = new Ok(new UserData(storage))
    } catch (e) {
      const error =
        e instanceof Error ? e : new InitializationError(e, "Could not read stored user data")
      reportInitializationError("reading stored course data", error)
      userData = new Err(error)
    }
    exerciseDecorationProvider = userData.ok
      ? new Ok(new ExerciseDecorationProvider(userData.val, workspaceManager.val))
      : new Err(
          new InitializationError(
            userData.val,
            "Could not initialize exercise decoration provider without user data",
          ),
        )
  } else {
    Logger.warn("Skipped userdata setup")
    userData = new Err(
      new InitializationError(
        resources.val,
        "Could not read user data due to failure in resource initialization",
      ),
    )
    workspaceManager = new Err(
      new InitializationError(
        resources.val,
        "Could not initialize workspace manager due to failure in resource initialization",
      ),
    )
    exerciseDecorationProvider = new Err(
      new InitializationError(
        resources.val,
        "Could not initialize exercise decoration provider due to failure in resource initialization",
      ),
    )
  }

  const startup: Startup =
    langs.ok && resources.ok && workspaceManager.ok && userData.ok && exerciseDecorationProvider.ok
      ? {
          kind: "ready",
          langs: langs.val,
          resources: resources.val,
          workspaceManager: workspaceManager.val,
          userData: userData.val,
          exerciseDecorationProvider: exerciseDecorationProvider.val,
        }
      : {
          kind: "degraded",
          failures: startupFailures({
            langs,
            resources,
            workspaceManager,
            userData,
            exerciseDecorationProvider,
          }),
        }
  if (startup.kind === "degraded") {
    // Only the root failures are reported as they happen; what they drag down with them
    // is named nowhere else.
    Logger.warn(`Activation degraded, missing: ${Object.keys(startup.failures).join(", ")}`)
  }
  const actionContext: ActionContext = { authState, dialog, settings, startup, ui }
  const readyContext = isReady(actionContext) ? actionContext : undefined

  if (readyContext) {
    const refreshResult = await refreshLocalExercises(readyContext)
    if (refreshResult.err) {
      Logger.warn("Failed to set initial exercises.", refreshResult.val)
    }
  }

  init.registerUiActions(actionContext)
  init.registerCommands(context, actionContext)
  if (readyContext) {
    init.registerSettingsCallbacks(readyContext)
  }

  // The palette and the explorer menus uncover their entries on this key, and VS Code
  // rejects a command it cannot find: nothing may set it before the registration above.
  await vscode.commands.executeCommand(
    "setContext",
    "test-my-code:Initialized",
    startup.kind === "ready",
  )

  if (exerciseDecorationProvider.ok) {
    context.subscriptions.push(
      exerciseDecorationProvider.val,
      vscode.window.registerFileDecorationProvider(exerciseDecorationProvider.val),
    )
  }

  if (readyContext && authState.loggedIn) {
    void refreshEverything(readyContext, { silent: true }).catch((e) =>
      Logger.error("Background refresh failed", e),
    )
  }

  async function runMaintenancePoll(): Promise<void> {
    try {
      const checked = await authState.refresh()
      if (checked.tmc.err) {
        Logger.error("Failed to check if authenticated", checked.tmc.val)
      }
      if (checked.mooc.err) {
        Logger.error("Failed to check if mooc authenticated", checked.mooc.val)
      }
      // Proactively catches a session dropping between polls, not just on a failed command.
      sessionExpiry.onAuthChecked("tmc", authState.tmc)
      sessionExpiry.onAuthChecked("mooc", authState.mooc)
      if (readyContext && authState.loggedIn) {
        void refreshEverything(readyContext, { silent: true }).catch((e) =>
          Logger.error("Background refresh failed", e),
        )
      }
    } catch (e) {
      Logger.error("Maintenance check failed", e)
    }
  }

  setMaintenancePollArmed(authState.loggedIn)

  // `tmc.showWelcome` is registered only in the ready case, and VS Code rejects a command
  // it cannot find -- which would abort the rest of this function, help panel included.
  if (showWelcome && readyContext) {
    await vscode.commands.executeCommand("tmc.showWelcome")
  }

  if (!readyContext) {
    await TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })
  }
}

// Everything activation starts is registered in `context.subscriptions`, which VS Code
// disposes for us; this exists because the extension API requires the export.
export function deactivate(): void {}

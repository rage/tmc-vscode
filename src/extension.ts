import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { refreshEverything, refreshLocalExercises } from "./actions"
import type { ActionContext } from "./actions/types"
import Dialog from "./api/dialog"
import ExerciseDecorationProvider from "./api/exerciseDecorationProvider"
import Langs from "./api/langs"
import WorkspaceManager, {
  ensureCourseWorkspaceFile,
  ensureWorkspaceRootFile,
} from "./api/workspaceManager"
import {
  CLIENT_NAME,
  DEBUG_MODE,
  EXERCISE_CHECK_INTERVAL,
  EXTENSION_ID,
  TMC_LANGS_CONFIG_DIR,
  TMC_LANGS_DL_URL,
  TMC_LANGS_VERSION,
} from "./config/constants"
import Settings from "./config/settings"
import { UserData } from "./config/userdata"
import { EmptyLangsResponseError, FileSystemError, InitializationError, SpawnError } from "./errors"
import * as init from "./init"
import { randomPanelId, TmcPanel } from "./panels/TmcPanel"
import Storage from "./storage"
import UI from "./ui/ui"
import { cliFolder, Logger, semVerCompare } from "./utilities"
import { createSessionExpiryTracker } from "./utilities/sessionExpiryTracker"

function initializationError(
  dialog: Dialog,
  step: string,
  error: Error,
  langsFolder: string,
): void {
  Logger.errorWithDialog(
    dialog,
    `Initialization error during ${step}:`,
    error,
    "If this issue is not resolved, the extension may not function properly.",
  )
  if (error instanceof EmptyLangsResponseError || error instanceof SpawnError) {
    Logger.errorWithDialog(
      dialog,
      "This error may have been caused by an interfering antivirus program. " +
        "Please try adding an exception for the following folder:",
      langsFolder,
    )
  }
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
  const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version
  const storage = new Storage(context)
  const settings = new Settings(storage)
  context.subscriptions.push(settings)
  // Must precede the first CLI invocation below: the user's level decides what the output
  // channel keeps of a `logged-in` response, which carries a live OAuth token.
  Logger.configure(settings.getLogLevel())
  context.subscriptions.push({ dispose: () => Logger.dispose() })
  // Kept at every level: it carries no credential, and it is what makes a pasted log
  // answerable in a bug report.
  Logger.banner(`Starting ${EXTENSION_ID} in "${DEBUG_MODE ? "development" : "production"}" mode.`)
  Logger.banner(`${vscode.env.appName} version: ${vscode.version}`)
  Logger.banner(`${EXTENSION_ID} version: ${extensionVersion}`)
  Logger.banner(`Currently open workspace: ${vscode.workspace.name}`)

  // Gates the developer-only palette entries (e.g. "Show Debug View").
  await vscode.commands.executeCommand("setContext", "test-my-code:DebugMode", DEBUG_MODE)

  const dialog = new Dialog()
  const cliFolderPath = cliFolder(context)
  const cliPathResult = await init.ensureLangsUpdated(cliFolderPath, dialog, {
    downloadUrl: TMC_LANGS_DL_URL,
    version: TMC_LANGS_VERSION,
  })

  // download langs if necessary
  let langs: Result<Langs, Error>
  if (cliPathResult.err) {
    langs = cliPathResult
    initializationError(dialog, "tmc-langs setup", cliPathResult.val, cliFolderPath)
  } else {
    // fire-and-forget: verify the CLI's output contract matches this build's schema
    void init.verifyCliSchema(cliPathResult.val, context.extensionPath)
    const langsInstance = new Langs(cliPathResult.val, CLIENT_NAME, extensionVersion, {
      cliConfigDir: TMC_LANGS_CONFIG_DIR,
    })
    // A submit or paste would otherwise keep polling the backend past shutdown.
    context.subscriptions.push({ dispose: () => langsInstance.killAllProcesses() })
    langs = new Ok(langsInstance)
  }

  // tmc and mooc credential states are independent; the UI treats the user
  // as logged in when either backend is authenticated.
  const authStatus = { tmc: false, mooc: false }
  if (langs.ok) {
    const authenticatedResult = await langs.val.isAuthenticated({ timeout: 15000 })
    if (authenticatedResult.err) {
      initializationError(dialog, "authentication check", authenticatedResult.val, cliFolderPath)
    } else {
      authStatus.tmc = authenticatedResult.val
    }
    const moocAuthenticatedResult = await langs.val.isMoocAuthenticated({ timeout: 15000 })
    if (moocAuthenticatedResult.err) {
      Logger.warn("Could not check mooc login status", moocAuthenticatedResult.val)
    } else {
      authStatus.mooc = moocAuthenticatedResult.val
    }
  } else {
    Logger.warn("Could not check login status")
  }
  const authenticated = authStatus.tmc || authStatus.mooc
  await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", authenticated)

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
      initializationError(dialog, "migration", reopened.val, cliFolderPath)
    } else if (migration.kind === "failed") {
      initializationError(dialog, "migration", migration.error, cliFolderPath)
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
      initializationError(dialog, "finding datapath", dataPathResult.val, cliFolderPath)
    } else if (dataPathResult.val === undefined) {
      Logger.error("Failed to define datapath: no value found.")
      initializationError(
        dialog,
        "finding datapath",
        new Error("No value for datapath."),
        cliFolderPath,
      )
    } else {
      tmcDataPath = dataPathResult.val
    }
  }

  const resources = await init.resourceInitialization(
    context,
    storage,
    extensionVersion,
    tmcDataPath,
    workspaceFileFolder,
  )
  if (resources.err) {
    initializationError(dialog, "resource initialization", resources.val, cliFolderPath)
  }

  const ui = new UI()
  context.subscriptions.push(ui)
  const loggedIn = ui.treeDP.createVisibilityGroup(authenticated)
  const visibilityGroups = {
    loggedIn,
  }

  // Armed only while logged in: each round is two cold CLI starts, and a session can only
  // drop silently for someone who has one. `applyAuthContext` sees every transition.
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

  // Seeded from the startup `setContext`, so an unchanged status reissues nothing.
  let lastAppliedLoggedIn = authenticated
  const applyAuthContext = async (): Promise<void> => {
    const loggedInNow = authStatus.tmc || authStatus.mooc
    setMaintenancePollArmed(loggedInNow)
    if (loggedInNow === lastAppliedLoggedIn) {
      return
    }
    lastAppliedLoggedIn = loggedInNow
    await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", loggedInNow)
    ui.treeDP.updateVisibility([
      loggedInNow ? visibilityGroups.loggedIn : visibilityGroups.loggedIn.not,
    ])
  }
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
  const sessionExpiry = createSessionExpiryTracker(authStatus, sessionExpiredWarning)

  if (langs.ok) {
    langs.val.on("logout", async (expected) => {
      authStatus.tmc = false
      await applyAuthContext()
      sessionExpiry.onLogout("tmc", expected)
    })
    langs.val.on("mooc-login", async () => {
      authStatus.mooc = true
      sessionExpiry.onLogin("mooc")
      // A CLI that authenticates the tmc backend with the mooc token resolves an
      // earlier tmc expiry too. Whether it does is a property of the pinned CLI,
      // so drop the stale tmc state rather than claiming a session: the next
      // background check is what re-arms the warning.
      sessionExpiry.reset("tmc")
      await applyAuthContext()
    })
    langs.val.on("mooc-logout", async (expected) => {
      authStatus.mooc = false
      await applyAuthContext()
      sessionExpiry.onLogout("mooc", expected)
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
    workspaceManager = new Ok(new WorkspaceManager(resources.val))
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
      initializationError(dialog, "reading stored course data", error, cliFolderPath)
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

  const actionContext: ActionContext = {
    dialog,
    exerciseDecorationProvider,
    resources,
    settings,
    langs,
    ui,
    userData,
    workspaceManager,
    visibilityGroups,
  }

  const refreshResult = await refreshLocalExercises(actionContext)
  if (refreshResult.err) {
    Logger.warn("Failed to set initial exercises.", refreshResult.val)
  }

  init.registerUiActions(actionContext)
  init.registerCommands(context, actionContext)
  init.registerSettingsCallbacks(actionContext)

  if (exerciseDecorationProvider.ok) {
    context.subscriptions.push(
      exerciseDecorationProvider.val,
      vscode.window.registerFileDecorationProvider(exerciseDecorationProvider.val),
    )
  }

  if (authenticated) {
    void refreshEverything(actionContext, { silent: true }).catch((e) =>
      Logger.error("Background refresh failed", e),
    )
  }

  async function runMaintenancePoll(): Promise<void> {
    try {
      const authRes = langs.ok ? await langs.val.isAuthenticated() : Ok(false)
      if (authRes.err) {
        Logger.error("Failed to check if authenticated", authRes.val)
      } else {
        authStatus.tmc = authRes.val
      }
      const moocAuthRes = langs.ok ? await langs.val.isMoocAuthenticated() : Ok(false)
      if (moocAuthRes.err) {
        Logger.error("Failed to check if mooc authenticated", moocAuthRes.val)
      } else {
        authStatus.mooc = moocAuthRes.val
      }
      // Proactively catches a session dropping between polls, not just on a failed command.
      sessionExpiry.onAuthChecked("tmc", authStatus.tmc)
      sessionExpiry.onAuthChecked("mooc", authStatus.mooc)
      if (authStatus.tmc || authStatus.mooc) {
        void refreshEverything(actionContext, { silent: true }).catch((e) =>
          Logger.error("Background refresh failed", e),
        )
      }
      await applyAuthContext()
    } catch (e) {
      Logger.error("Maintenance check failed", e)
    }
  }

  setMaintenancePollArmed(authStatus.tmc || authStatus.mooc)

  if (showWelcome) {
    await vscode.commands.executeCommand("tmc.showWelcome")
  }

  if (
    !(
      langs.ok &&
      userData.ok &&
      workspaceManager.ok &&
      exerciseDecorationProvider.ok &&
      resources.ok
    )
  ) {
    TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: randomPanelId(),
      type: "InitializationErrorHelp",
    })
  }
}

// Everything activation starts is registered in `context.subscriptions`, which VS Code
// disposes for us; this exists because the extension API requires the export.
export function deactivate(): void {}

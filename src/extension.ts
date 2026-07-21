import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { checkForCourseUpdates, refreshLocalExercises } from "./actions"
import type { ActionContext } from "./actions/types"
import Dialog from "./api/dialog"
import ExerciseDecorationProvider from "./api/exerciseDecorationProvider"
import Langs from "./api/langs"
import WorkspaceManager from "./api/workspaceManager"
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
import {
  EmptyLangsResponseError,
  HaltForReloadError,
  InitializationError,
  SpawnError,
} from "./errors"
import * as init from "./init"
import { randomPanelId, TmcPanel } from "./panels/TmcPanel"
import Storage from "./storage"
import UI from "./ui/ui"
import { cliFolder, Logger, LogLevel, semVerCompare } from "./utilities"

let maintenanceInterval: NodeJS.Timeout | undefined

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
  Logger.configure(LogLevel.Verbose)
  Logger.info(`Starting ${EXTENSION_ID} in "${DEBUG_MODE ? "development" : "production"}" mode.`)
  Logger.info(`${vscode.env.appName} version: ${vscode.version}`)
  Logger.info(`${EXTENSION_ID} version: ${extensionVersion}`)
  Logger.info(`Currently open workspace: ${vscode.workspace.name}`)

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
    langs = new Ok(
      new Langs(cliPathResult.val, CLIENT_NAME, extensionVersion, {
        cliConfigDir: TMC_LANGS_CONFIG_DIR,
      }),
    )
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

  // migrate data between versions
  const storage = new Storage(context)
  if (langs.ok) {
    const migrationResult = await storage.migrateToLatest(
      context,
      dialog,
      langs.val,
      vscode.workspace.getConfiguration(),
    )
    if (migrationResult.err) {
      if (migrationResult.val instanceof HaltForReloadError) {
        Logger.warn("Extension expected to restart", migrationResult.val)
        return
      }

      initializationError(dialog, "migration", migrationResult.val, cliFolderPath)
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

  const workspaceFileFolder = path.join(context.globalStorageUri.fsPath, "workspaces")
  const resources = await init.resourceInitialization(
    context,
    storage,
    tmcDataPath,
    workspaceFileFolder,
  )
  if (resources.err) {
    initializationError(dialog, "resource initialization", resources.val, cliFolderPath)
  }

  const settings = new Settings(storage)
  context.subscriptions.push(settings)

  Logger.configure(settings.getLogLevel())

  const ui = new UI()
  const loggedIn = ui.treeDP.createVisibilityGroup(authenticated)
  const visibilityGroups = {
    loggedIn,
  }

  const applyAuthContext = async (): Promise<void> => {
    const loggedInNow = authStatus.tmc || authStatus.mooc
    await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", loggedInNow)
    ui.treeDP.updateVisibility([
      loggedInNow ? visibilityGroups.loggedIn : visibilityGroups.loggedIn.not,
    ])
  }
  const sessionExpiredWarning = (): void => {
    dialog.warningNotification("Your session has expired, please log in.", [
      "Log in",
      (): void => {
        vscode.commands.executeCommand("tmc.showLogin")
      },
    ])
  }

  if (langs.ok) {
    langs.val.on("login", async () => {
      authStatus.tmc = true
      await applyAuthContext()
    })
    langs.val.on("logout", async (expected) => {
      authStatus.tmc = false
      await applyAuthContext()
      if (!expected) {
        sessionExpiredWarning()
      }
    })
    langs.val.on("mooc-login", async () => {
      authStatus.mooc = true
      await applyAuthContext()
    })
    langs.val.on("mooc-logout", async (expected) => {
      authStatus.mooc = false
      await applyAuthContext()
      if (!expected) {
        sessionExpiredWarning()
      }
    })
  } else {
    Logger.warn("Skipped login command setup")
  }

  let showWelcome = false
  if (resources.ok) {
    const currentVersion = resources.val.extensionVersion
    const previousState = storage.getSessionState()
    const previousVersion = previousState?.extensionVersion
    if (currentVersion !== previousVersion) {
      storage.updateSessionState({ extensionVersion: currentVersion })
    }
    const versionDiff = semVerCompare(currentVersion, previousVersion || "", "minor")
    if (versionDiff === undefined || versionDiff > 0) {
      showWelcome = true
    }
  } else {
    Logger.warn("Skipped version check")
  }

  let userData: Result<UserData, Error>
  let workspaceManager: Result<WorkspaceManager, Error>
  let exerciseDecorationProvider: Result<ExerciseDecorationProvider, Error>
  if (resources.ok) {
    userData = new Ok(new UserData(storage))
    workspaceManager = new Ok(new WorkspaceManager(resources.val))
    context.subscriptions.push(workspaceManager.val)
    if (workspaceManager.val.activeCourse) {
      await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", true)
      await workspaceManager.val.verifyWorkspaceSettingsIntegrity()
    }
    exerciseDecorationProvider = new Ok(
      new ExerciseDecorationProvider(userData.val, workspaceManager.val),
    )
  } else {
    Logger.warn("Skipped userdata setup")
    exerciseDecorationProvider = new Err(
      new InitializationError(
        resources.val,
        "Could not initialize exercise decoration provider due to failure in resource initialization",
      ),
    )
    userData = new Err(
      new InitializationError(
        resources.val,
        "Could not initialize exercise decoration provider due to failure in resource initialization",
      ),
    )
    workspaceManager = new Err(
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
      vscode.window.registerFileDecorationProvider(exerciseDecorationProvider.val),
    )
  }

  if (authenticated) {
    vscode.commands.executeCommand("tmc.updateExercises", "silent")
    checkForCourseUpdates(actionContext)
  }

  if (maintenanceInterval) {
    clearInterval(maintenanceInterval)
  }

  maintenanceInterval = setInterval(async () => {
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
    if (authStatus.tmc || authStatus.mooc) {
      vscode.commands.executeCommand("tmc.updateExercises", "silent")
      checkForCourseUpdates(actionContext)
    }
    await applyAuthContext()
  }, EXERCISE_CHECK_INTERVAL)

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

export function deactivate(): void {
  if (maintenanceInterval) {
    clearInterval(maintenanceInterval)
  }
}

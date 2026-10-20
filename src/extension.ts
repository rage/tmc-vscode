import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { backendName, LocalCourseData } from "../shared/lib"
import { onDidFinishSubmission, refreshLocalExercises, scanLocalExercises } from "./actions"
import type {
  ActionContext,
  DegradedStartup,
  ReadyActionContext,
  Startup,
  StartupStep,
} from "./actions/types"
import { isReady } from "./actions/types"
import AiRestriction, { isActiveCourseAiAllowed } from "./api/aiRestriction"
import { AiUseGate, warnOfUnwritableWorkspaceFile } from "./api/aiUseGate"
import { createAuthState } from "./api/authState"
import { CourseWorkspaceSwitches } from "./api/courseWorkspaceSwitches"
import type { NotificationButton } from "./api/dialog"
import Dialog from "./api/dialog"
import ExerciseDecorationProvider from "./api/exerciseDecorationProvider"
import Langs from "./api/langs"
import {
  MOOC_AUTHENTICATION_PROVIDER_ID,
  MoocAuthenticationProvider,
} from "./api/moocAuthenticationProvider"
import WorkspaceManager, {
  ensureCourseWorkspaceFile,
  ensureWorkspaceRootFile,
} from "./api/workspaceManager"
import { WorkspaceTrustGate } from "./api/workspaceTrustGate"
import { promptForCourseWorkspaceTrust } from "./api/workspaceTrustPrompt"
import { createCourseWorkspaceOffer, login, logout, refreshEverything } from "./commands"
import {
  CLIENT_NAME,
  closedExercisesSettingKey,
  DEBUG_MODE,
  EXERCISE_CHECK_INTERVAL,
  EXTENSION_ID,
  FOCUS_REFRESH_INTERVAL,
  EXTENSION_VERSION,
  TMC_LANGS_CONFIG_DIR,
  TMC_LANGS_DL_URL,
  TMC_LANGS_VERSION,
} from "./config/constants"
import Settings from "./config/settings"
import { UserData } from "./config/userdata"
import {
  FileSystemError,
  InitializationError,
  presentationFor,
  SESSION_ENDED_MESSAGE,
} from "./errors"
import * as init from "./init"
import { OpenCourseRefresh } from "./openCourseRefresh"
import { TmcPanel } from "./panels/TmcPanel"
import { createSessionExpiryTracker } from "./sessionExpiryTracker"
import Storage from "./storage"
import {
  trackActiveEditorExercise,
  trackHasCourses,
  trackHasDownloadedExercises,
} from "./ui/contextKeys"
import { openCourseId } from "./ui/courseHome"
import { exerciseOperations } from "./ui/exerciseOperations"
import { failedUpdates } from "./ui/failedUpdates"
import { AccountStatusBarItem } from "./ui/statusBarAccount"
import { ExerciseStatusBarItem } from "./ui/statusBarExercise"
import { FailedUpdatesStatusBarItem } from "./ui/statusBarFailedUpdates"
import CoursesTree, { COURSES_VIEW_ID } from "./ui/treeview/treeview"
import { cliFolder, Logger, semVerCompare } from "./utilities"
import { showNextWalkthroughStep, trackWalkthroughActive } from "./window/walkthrough"

interface InitializationErrorReporter {
  /** Logs a failed step; the user hears about it from {@link notify}. */
  record: (step: string, error: Error) => void
  /**
   * Shows one notification for everything recorded, if anything was: one root cause, an
   * unreachable CLI say, fails most of the steps after it.
   */
  notify: (isDegraded: boolean) => void
}

/** Builds the reporter an activation uses for its initialization steps that fail. */
function makeInitializationErrorReporter(dialog: Dialog): InitializationErrorReporter {
  const failures: { step: string; error: Error }[] = []
  return {
    record: (step, error) => {
      Logger.error(`Initialization error: ${step} failed.`, error)
      failures.push({ step, error })
    },
    notify: (isDegraded) => {
      const [first] = failures
      if (!first) {
        return
      }
      const { message } = presentationFor(first.error)
      const others =
        new Set(failures.map(({ error }) => `${error.name}\n${error.message}`)).size - 1
      const more =
        others > 0
          ? ` ${others} more ${others === 1 ? "problem is" : "problems are"} in the logs.`
          : ""
      void dialog.errorNotification(
        `TestMyCode ${isDegraded ? "could not start" : "started with a problem"}. ` +
          `${first.step} failed: ${message}${more}`,
        first.error,
        [
          "Show Details",
          (): void => void vscode.commands.executeCommand("tmc.viewInitializationErrorHelp"),
        ],
      )
    },
  }
}

/** The failed ones among these steps; one never attempted is left out. */
function startupFailures(
  steps: Record<StartupStep, Result<unknown, Error> | undefined>,
): DegradedStartup["failures"] {
  return Object.fromEntries(
    Object.entries(steps).flatMap(([step, result]) =>
      result?.err ? [[step, result.val] as const] : [],
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

/** Whether activation has set the context keys that replace the "Starting TestMyCode…" view. */
interface StartupContext {
  isApplied: boolean
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startupContext: StartupContext = { isApplied: false }
  try {
    // The Courses view shows "Starting TestMyCode…" until activation settles; this gives it
    // a progress bar too.
    await vscode.window.withProgress({ location: { viewId: COURSES_VIEW_ID } }, () =>
      activateInner(context, startupContext),
    )
  } catch (e) {
    // this should never occur, we always want to activate the extension even if only partially
    Logger.error("Fatal error during initialization:", e)
    if (!startupContext.isApplied) {
      void vscode.commands.executeCommand("setContext", "test-my-code:Degraded", true)
    }
    const message = e instanceof Error ? e.message : String(e)
    void vscode.window
      .showErrorMessage(`TestMyCode could not start. ${message}`, "Show Logs")
      .then((picked) => picked && Logger.show())
  }
}

/** When the last unprompted refresh started, in epoch milliseconds. */
let lastBackgroundRefreshAt = 0

function refreshInBackground(
  ready: ReadyActionContext,
  openCourseRefresh: OpenCourseRefresh | undefined,
  isPromptless = false,
): void {
  lastBackgroundRefreshAt = Date.now()
  openCourseRefresh?.noteRefreshed()
  void refreshEverything(ready, { silent: true, isPromptless }).catch((e) =>
    Logger.error("Background refresh failed", e),
  )
}

async function activateInner(
  context: vscode.ExtensionContext,
  startupContext: StartupContext,
): Promise<void> {
  const storage = new Storage(context)
  const settings = new Settings()
  context.subscriptions.push(settings)
  // Must precede the first CLI invocation below, which logs at the user's level.
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
  const coursesTree = new CoursesTree()
  context.subscriptions.push(coursesTree)
  init.registerServiceFreeCommands(context, dialog)
  const initializationErrors = makeInitializationErrorReporter(dialog)
  const reportInitializationError = initializationErrors.record
  const cliPathResult = await init.ensureLangsUpdated(cliFolder(context), dialog, {
    downloadUrl: TMC_LANGS_DL_URL,
    version: TMC_LANGS_VERSION,
  })

  // download langs if necessary
  let langs: Result<Langs, Error>
  if (cliPathResult.err) {
    langs = cliPathResult
    reportInitializationError("Setting up the TestMyCode tools", cliPathResult.val)
  } else {
    // fire-and-forget: verify the CLI's output contract matches this build's schema
    void init.verifyCliSchema(cliPathResult.val, context.extensionPath, context.globalState)
    const langsInstance = new Langs(cliPathResult.val, CLIENT_NAME, EXTENSION_VERSION, {
      cliConfigDir: TMC_LANGS_CONFIG_DIR,
      javaHome: () => settings.getJavaHome(),
    })
    // A submit or paste would otherwise keep polling the backend past shutdown.
    context.subscriptions.push({ dispose: () => langsInstance.killAllProcesses() })
    langs = new Ok(langsInstance)
  }

  const authState = createAuthState(langs)
  authState.subscribe((loggedIn) => coursesTree.setLoggedIn(loggedIn))
  context.subscriptions.push(trackWalkthroughActive())
  // Awaited only after the migration: it can refresh a token over the network, and nothing
  // before needs its answer.
  const initialAuthCheck = authState.refresh({ timeout: 15000 })

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
      reportInitializationError("Migrating stored data", reopened.val)
    } else if (migration.kind === "failed") {
      reportInitializationError("Migrating stored data", migration.error)
    }
  } else {
    Logger.warn("Skipped data migration")
  }

  // After the migration, which can move the exercises and the projects-dir setting.
  const [authChecked, startupScan] = await Promise.all([
    initialAuthCheck,
    langs.ok ? scanLocalExercises(langs.val) : undefined,
  ])
  if (authChecked.err) {
    reportInitializationError("Checking your login", authChecked.val)
  }

  let tmcDataPath: string | undefined
  if (startupScan) {
    const { settings: cliSettings } = startupScan
    if (cliSettings.err) {
      Logger.error("Failed to define datapath:", cliSettings.val)
      reportInitializationError("Finding the exercises folder", cliSettings.val)
    } else {
      tmcDataPath = cliSettings.val.projects_dir
    }
  }

  const resources = await init.resourceInitialization(storage, tmcDataPath, workspaceFileFolder)
  if (resources.err) {
    reportInitializationError("Preparing the extension's files", resources.val)
  }

  // Armed only while logged in: a session can only drop silently for someone who has one.
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

  // Created once the commands it runs are registered, which is after the listeners below.
  let accountStatus: AccountStatusBarItem | undefined
  // `tmc.showMoocLogin` exists only once a ready activation has registered it.
  let canOfferLogin = false

  const sessionExpiredWarning = (): void => {
    accountStatus?.markSessionExpired()
    const logIn: NotificationButton = [
      "Log In",
      (): void => void vscode.commands.executeCommand("tmc.showMoocLogin"),
    ]
    dialog.warningNotification(SESSION_ENDED_MESSAGE, ...(canOfferLogin ? [logIn] : []))
  }

  // Seeded from the startup check above; shared with the background poll further down.
  const sessionExpiry = createSessionExpiryTracker(authState.loggedIn, sessionExpiredWarning)
  dialog.setSessionLostReporter((cause) => sessionExpiry.onSessionLost(cause))

  if (langs.ok) {
    langs.val.on("login", async () => {
      await authState.set(true)
      sessionExpiry.onLogin()
    })
    langs.val.on("logout", async (expected, rejection) => {
      if (expected) {
        await authState.set(false)
        sessionExpiry.onLogout()
        return
      }
      const checked = await authState.refresh()
      if (checked.err) {
        Logger.error("Failed to check if authenticated", checked.val)
      }
      sessionExpiry.onAuthChecked(authState.loggedIn, rejection)
    })
    langs.val.on("notification", (notification) => {
      void dialog.warningNotification(notification.message)
    })
  } else {
    Logger.warn("Skipped login command setup")
  }

  let versionChange: "installed" | "updated" | undefined
  try {
    const previousVersion = storage.getSessionState()?.extensionVersion
    if (EXTENSION_VERSION !== previousVersion) {
      await storage.updateSessionState({ extensionVersion: EXTENSION_VERSION })
    }
    const versionDiff = semVerCompare(EXTENSION_VERSION, previousVersion || "", "minor")
    if (versionDiff === undefined) {
      versionChange = "installed"
    } else if (versionDiff > 0) {
      versionChange = "updated"
    }
  } catch (e) {
    // An unreadable session state costs the walkthrough or the update notice, nothing else.
    Logger.warn("Skipped version check", e)
  }

  let workspaceManager: WorkspaceManager | undefined
  let userData: Result<UserData, Error> | undefined
  let aiRestriction: AiRestriction | undefined
  if (resources.ok) {
    workspaceManager = new WorkspaceManager(
      resources.val,
      (backend, courseSlug, closedExerciseSlugs) =>
        langs.ok
          ? langs.val.setSetting(
              closedExercisesSettingKey(backend, courseSlug),
              closedExerciseSlugs,
            )
          : Promise.resolve(
              new Err(new InitializationError("Cannot record closed exercises without tmc-langs")),
            ),
    )
    context.subscriptions.push(workspaceManager, trackActiveEditorExercise(workspaceManager))
    // Stored data this version cannot parse must degrade the extension, not abort it.
    try {
      userData = new Ok(new UserData(storage))
    } catch (e) {
      const error =
        e instanceof Error ? e : new InitializationError(e, "Could not read stored user data")
      reportInitializationError("Reading your stored courses", error)
      userData = new Err(error)
    }
    if (workspaceManager.activeCourse) {
      await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", true)
      await workspaceManager.verifyWorkspaceSettingsIntegrity()
      const courseWorkspace = workspaceManager
      const courses = userData.ok ? userData.val : undefined
      aiRestriction = new AiRestriction(
        courseWorkspace,
        context.workspaceState,
        () => isActiveCourseAiAllowed(courseWorkspace, courses),
        courses?.onDidChangeCourses,
      )
      context.subscriptions.push(
        aiRestriction,
        aiRestriction.onDidRefuseWorkspaceFile(
          (lapse) => void warnOfUnwritableWorkspaceFile(dialog, lapse),
        ),
      )
      // The AI-use gate enforces its own pass before a submit, test run or paste.
      void aiRestriction.apply()
    }
  } else {
    Logger.warn("Skipped userdata setup")
  }
  const exerciseDecorationProvider =
    workspaceManager && userData?.ok
      ? new ExerciseDecorationProvider(userData.val, workspaceManager)
      : undefined

  const courseWorkspaceSwitches = new CourseWorkspaceSwitches(context.globalState)
  // The window that switched here has just offered whatever the startup refresh would.
  const isOpenedBySwitch = await courseWorkspaceSwitches.take(
    vscode.workspace.workspaceFile?.fsPath,
  )
  const trustGate = new WorkspaceTrustGate()
  context.subscriptions.push(trustGate)
  const startup: Startup =
    langs.ok && resources.ok && workspaceManager && userData?.ok && exerciseDecorationProvider
      ? {
          kind: "ready",
          aiUseGate: new AiUseGate(aiRestriction),
          courseWorkspaceSwitches,
          langs: langs.val,
          resources: resources.val,
          trustGate,
          workspaceManager,
          userData: userData.val,
          exerciseDecorationProvider,
        }
      : { kind: "degraded", failures: startupFailures({ langs, resources, userData }) }
  if (startup.kind === "degraded") {
    Logger.warn(`Activation degraded, failed: ${Object.keys(startup.failures).join(", ")}`)
  }
  const actionContext: ActionContext = { authState, coursesTree, dialog, settings, startup }
  const readyContext = isReady(actionContext) ? actionContext : undefined

  if (readyContext) {
    const refreshResult = await refreshLocalExercises(readyContext, startupScan)
    if (refreshResult.err) {
      Logger.warn("Failed to set initial exercises.", refreshResult.val)
    }
    const { startup: ready } = readyContext
    const { activeCourse, activeCourseBackend } = ready.workspaceManager
    const isRestrictedCourseWorkspace = !vscode.workspace.isTrusted && activeCourse !== undefined
    coursesTree.setRestricted(isRestrictedCourseWorkspace)
    if (isRestrictedCourseWorkspace && activeCourseBackend !== undefined) {
      const course = ready.userData.getCourseBySlug(activeCourseBackend, activeCourse)
      void promptForCourseWorkspaceTrust(
        course.ok ? LocalCourseData.getCourseTitle(course.val) : activeCourse,
        context.workspaceState,
      )
    }
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => coursesTree.setRestricted(false)),
      ready.workspaceManager.onDidOpenOutsideCourseWorkspace(
        createCourseWorkspaceOffer(readyContext),
      ),
    )
    // A failed activation leaves the view empty, and its `viewsWelcome` offers the way out.
    coursesTree.setSource({
      getCourses: () => ready.userData.getCourses(),
      onDidChangeCourses: ready.userData.onDidChangeCourses,
      workspaceManager: ready.workspaceManager,
    })
  }

  const testController = readyContext && init.registerTesting(context, readyContext)
  init.registerCommands(context, actionContext, testController)
  canOfferLogin = readyContext !== undefined
  context.subscriptions.push(
    TmcPanel.registerSerializers(context, actionContext),
    TmcPanel.showSubmissionViews(context, actionContext),
  )
  if (readyContext) {
    init.registerSettingsCallbacks(readyContext)
    const account = new AccountStatusBarItem(authState.loggedIn)
    authState.subscribe((loggedIn) => account.setLoggedIn(loggedIn))
    accountStatus = account
    const moocAccount = new MoocAuthenticationProvider({
      isLoggedIn: () => authState.loggedIn,
      login: async () => (await login(readyContext)) === "loggedIn",
      logout: () => logout(readyContext),
    })
    authState.subscribe((loggedIn) => moocAccount.setLoggedIn(loggedIn))
    context.subscriptions.push(
      moocAccount,
      vscode.authentication.registerAuthenticationProvider(
        MOOC_AUTHENTICATION_PROVIDER_ID,
        backendName("mooc"),
        moocAccount,
      ),
      account,
      new ExerciseStatusBarItem({
        workspaceManager: readyContext.startup.workspaceManager,
        userData: readyContext.startup.userData,
        operations: exerciseOperations,
      }),
      new FailedUpdatesStatusBarItem(failedUpdates),
      trackHasCourses(readyContext.startup.userData),
      trackHasDownloadedExercises(readyContext.startup.workspaceManager),
      // Point totals come from the backend, so without this the Courses view and Course
      // Details totals stay stale until the user refreshes by hand.
      onDidFinishSubmission((courseId) => {
        void refreshEverything(readyContext, {
          silent: true,
          isQueuedWhenBusy: true,
          courseId,
          offersNewExercises: false,
        })
      }),
    )
  }

  // The palette and the explorer menus uncover their entries on this key, and VS Code
  // rejects a command it cannot find: nothing may set it before the registration above.
  await vscode.commands.executeCommand(
    "setContext",
    "test-my-code:Initialized",
    startup.kind === "ready",
  )
  await vscode.commands.executeCommand(
    "setContext",
    "test-my-code:Degraded",
    startup.kind === "degraded",
  )
  startupContext.isApplied = true

  if (exerciseDecorationProvider) {
    context.subscriptions.push(
      exerciseDecorationProvider,
      vscode.window.registerFileDecorationProvider(exerciseDecorationProvider),
    )
  }

  // Created further down, once the listeners it must follow are registered.
  let openCourseRefresh: OpenCourseRefresh | undefined
  if (readyContext && authState.loggedIn) {
    refreshInBackground(readyContext, openCourseRefresh, isOpenedBySwitch)
  }

  async function runMaintenancePoll(): Promise<void> {
    try {
      const checked = await authState.refresh()
      if (checked.err) {
        Logger.error("Failed to check if authenticated", checked.val)
      }
      // Proactively catches a session dropping between polls, not just on a failed command.
      sessionExpiry.onAuthChecked(authState.loggedIn)
      if (readyContext && authState.loggedIn) {
        refreshInBackground(readyContext, openCourseRefresh)
      }
    } catch (e) {
      Logger.error("Maintenance check failed", e)
    }
  }

  setMaintenancePollArmed(authState.loggedIn)

  // The poll alone would leave exercises published mid-session unnoticed for up to its whole
  // interval; coming back to the window is when the student would want to hear of them.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (
        state.focused &&
        readyContext &&
        authState.loggedIn &&
        Date.now() - lastBackgroundRefreshAt >= FOCUS_REFRESH_INTERVAL
      ) {
        refreshInBackground(readyContext, openCourseRefresh)
      }
    }),
  )

  // Created after the listener above, so that a full refresh due on the same focus runs first and
  // stands in for this one.
  if (readyContext) {
    openCourseRefresh = new OpenCourseRefresh({
      openCourse: () => (authState.loggedIn ? openCourseId(readyContext) : undefined),
      refresh: (courseId) =>
        void refreshEverything(readyContext, { silent: true, courseId }).catch((e) =>
          Logger.error("Open course refresh failed", e),
        ),
    })
    context.subscriptions.push(openCourseRefresh)
  }

  if (readyContext && isOpenedBySwitch) {
    const { startup: ready } = readyContext
    // Outside a window reload, a released VS Code opens the Explorer in place of the extension
    // view a workspace last showed in its sidebar.
    void Promise.resolve(vscode.commands.executeCommand(`${COURSES_VIEW_ID}.focus`)).catch((e) =>
      Logger.warn("Could not show the Courses view", e),
    )
    // The course home lists what to do next in the course just opened, so it goes in front of
    // the walkthrough, which still moves on to its next step behind it; but not over code the
    // student has opened meanwhile.
    const courseId = openCourseId(readyContext)
    void showNextWalkthroughStep({
      isLoggedIn: authState.loggedIn,
      hasCourses: ready.userData.getCourses().length > 0,
      hasDownloadedExercises: ready.workspaceManager.getExercises().length > 0,
    })
      .catch((e) => Logger.warn("Could not show the next walkthrough step", e))
      .then(
        () =>
          courseId &&
          !vscode.window.activeTextEditor &&
          vscode.commands.executeCommand("tmc.courseDetails", courseId),
      )
      .then(undefined, (e) => Logger.warn("Could not show the course home", e))
  }

  // `tmc.showWelcome` is registered only in the ready case, and VS Code rejects a command
  // it cannot find -- which would abort the rest of this function.
  if (readyContext && versionChange === "installed") {
    await vscode.commands.executeCommand("tmc.showWelcome")
  } else if (readyContext && versionChange === "updated") {
    dialog.statusMessage(`TestMyCode was updated to ${EXTENSION_VERSION}.`)
  }

  initializationErrors.notify(!readyContext)
}

// Everything activation starts is registered in `context.subscriptions`, which VS Code
// disposes for us; this exists because the extension API requires the export.
export function deactivate(): void {}

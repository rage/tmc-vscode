import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { LocalCourseData, LOGGED_OUT_MESSAGE, toError } from "../shared/lib"
import { onDidFinishSubmission, refreshLocalExercises, scanLocalExercises } from "./actions"
import { pendingGradings } from "./actions/pendingGradings"
import type {
  ActionContext,
  DegradedStartup,
  ReadyActionContext,
  Startup,
  StartupStep,
} from "./actions/types"
import { isReady } from "./actions/types"
import { AccountHandover } from "./api/accountHandover"
import AiRestriction, { closeChatSideBar, isActiveCourseAiAllowed } from "./api/aiRestriction"
import { AiUseGate, warnOfUnwritableWorkspaceFile } from "./api/aiUseGate"
import { createAuthState } from "./api/authState"
import { CourseWorkspaceSwitches } from "./api/courseWorkspaceSwitches"
import type { NotificationButton } from "./api/dialog"
import Dialog from "./api/dialog"
import ExerciseDecorationProvider from "./api/exerciseDecorationProvider"
import { KeptCopies } from "./api/keptCopies"
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
import { handOverExercisesOnAccountChange } from "./commands/handOverExercises"
import {
  CLIENT_NAME,
  closedExercisesSettingKey,
  DEBUG_MODE,
  EXERCISE_CHECK_INTERVAL,
  EXTENSION_ID,
  DEFERRED_AUTH_CHECK_DELAY,
  FOCUS_AUTH_CHECK_INTERVAL,
  FOCUS_REFRESH_INTERVAL,
  STARTUP_AUTH_CHECK_TIMEOUT,
  EXTENSION_VERSION,
  TMC_LANGS_CONFIG_DIR,
  TMC_LANGS_CHECKSUMS,
  TMC_LANGS_DL_URL,
  TMC_LANGS_VERSION,
  MOOC_BACKEND_URL,
  TMC_BACKEND_URL,
} from "./config/constants"
import Settings from "./config/settings"
import { UserData } from "./config/userdata"
import { ConnectionError, FileSystemError, InitializationError, TimeoutError } from "./errors"
import * as init from "./init"
import { OpenCourseRefresh } from "./openCourseRefresh"
import { TmcPanel } from "./panels/TmcPanel"
import { createExpiryNotifier, createSessionExpiryTracker } from "./sessionExpiryTracker"
import Storage from "./storage"
import { SerializedMemento } from "./storage/serializedMemento"
import { backgroundJobs } from "./ui/backgroundJobs"
import {
  trackActiveEditorExercise,
  trackActiveExerciseRemoved,
  trackActiveExerciseSubmitRefused,
  trackHasCourses,
  trackHasDownloadedExercises,
} from "./ui/contextKeys"
import { openCourseId } from "./ui/courseHome"
import { failedUpdates } from "./ui/failedUpdates"
import { JobProgressNotifications } from "./ui/jobProgressNotifications"
import { LanguageExtensionOffer } from "./ui/languageExtensionOffer"
import { shownCourseHome } from "./ui/shownCourseHome"
import { AccountStatusBarItem, accountLabel } from "./ui/statusBarAccount"
import { BackgroundStatusBarItem } from "./ui/statusBarBackground"
import { ExerciseStatusBarItem } from "./ui/statusBarExercise"
import { submissionViews } from "./ui/submissionViews"
import CoursesTree, { COURSES_VIEW_ID } from "./ui/treeview/treeview"
import { recordCli } from "./uninstall"
import type { VersionChange } from "./utilities"
import {
  cliFolder,
  legacyCliFolder,
  Logger,
  semVerCompare,
  setRedactedExtensionStorage,
  versionChangeSince,
} from "./utilities"
import { keepExerciseFilesInFirstGroup } from "./window/exerciseEditorPlacement"
import {
  listWalkthroughUnlessUpdated,
  openWalkthroughWhenRegistered,
  reachWalkthroughMilestone,
  restoreWalkthroughMilestones,
  showNextWalkthroughStep,
  startWalkthroughRegistration,
  trackWalkthroughActive,
  walkthroughProgressOf,
} from "./window/walkthrough"

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
      const notification =
        `TestMyCode ${isDegraded ? "could not start" : "started with a problem"}. ` +
        `${first.step} failed.`
      // The startup help lists every failure, where Show Details of one would show only it.
      const startupHelp: NotificationButton = [
        "Show Details",
        (): void => void vscode.commands.executeCommand("tmc.viewInitializationErrorHelp"),
      ]
      void dialog.errorNotification(
        notification,
        isDegraded ? undefined : first.error,
        ...(isDegraded ? [startupHelp] : []),
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

/** The extension's mementos; `context`'s own are written only through these. */
interface Mementos {
  globalState: SerializedMemento
  workspaceState: SerializedMemento
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setRedactedExtensionStorage(context.globalStorageUri.fsPath)
  startWalkthroughRegistration()
  const mementos: Mementos = {
    globalState: new SerializedMemento(context.globalState),
    workspaceState: new SerializedMemento(context.workspaceState),
  }
  // `onStartupFinished` activates in every window; one TestMyCode has no part in yet stays light.
  if (await init.canDeferActivation(context, mementos.globalState)) {
    await init.deferActivation(context, mementos.globalState, () =>
      activateFully(context, mementos),
    )
  } else {
    await activateFully(context, mementos)
  }
}

async function activateFully(context: vscode.ExtensionContext, mementos: Mementos): Promise<void> {
  const startupContext: StartupContext = { isApplied: false }
  try {
    // The Courses view shows "Starting TestMyCode…" until activation settles; this gives it
    // a progress bar too.
    await vscode.window.withProgress({ location: { viewId: COURSES_VIEW_ID } }, () =>
      activateInner(context, mementos, startupContext),
    )
  } catch (e) {
    // this should never occur, we always want to activate the extension even if only partially
    Logger.error("Fatal error during initialization:", e)
    if (!startupContext.isApplied) {
      void vscode.commands.executeCommand("setContext", "test-my-code:Degraded", true)
    }
    const error = toError(e)
    void new Dialog().errorNotification(
      "TestMyCode could not start. Show Details says what failed.",
      error,
    )
  }
}

/** When the last unprompted refresh started, in epoch milliseconds. */
let lastBackgroundRefreshAt = 0

/** Set by a logout and cleared by a login, so a later start does not report an expired session. */
const LOGGED_OUT_KEY = "loggedOut"
/** The first version with the redesigned UI; an update from before it says what moved. */
const REDESIGN_VERSION = "3.9.0"

function refreshInBackground(
  ready: ReadyActionContext,
  openCourseRefresh: OpenCourseRefresh | undefined,
  isPromptless = false,
): void {
  lastBackgroundRefreshAt = Date.now()
  openCourseRefresh?.noteRefreshed()
  void refreshEverything(ready, {
    silent: true,
    isPromptless,
    skipsRecentlyLostCourses: true,
  }).catch((e) => Logger.error("Background refresh failed", e))
}

async function activateInner(
  context: vscode.ExtensionContext,
  { globalState, workspaceState }: Mementos,
  startupContext: StartupContext,
): Promise<void> {
  const storage = new Storage(globalState)
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
  Logger.banner(`Platform: ${process.platform} ${process.arch}`)
  Logger.banner(`TestMyCode tools version: ${TMC_LANGS_VERSION}`)
  Logger.banner(`Backends: ${TMC_BACKEND_URL}, ${MOOC_BACKEND_URL}`)
  Logger.banner(`courses.mooc.fi courses: ${settings.isCoursesMoocFiEnabled() ? "on" : "off"}`)

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
    builtInChecksums: TMC_LANGS_CHECKSUMS,
  })
  if (cliFolder(context) !== legacyCliFolder(context)) {
    void init.removeStaleCliFiles(legacyCliFolder(context), [], { keepPrevious: false })
  }

  // download langs if necessary
  let langs: Result<Langs, Error>
  if (cliPathResult.err) {
    langs = cliPathResult
    reportInitializationError("Setting up the TestMyCode tools", cliPathResult.val)
  } else {
    // fire-and-forget: verify the CLI's output contract matches this build's schema
    void init.verifyCliSchema(cliPathResult.val, context.extensionPath, globalState)
    void recordCli({ cliPath: cliPathResult.val, httpProxy: settings.getHttpProxy() })
    const langsInstance = new Langs(cliPathResult.val, CLIENT_NAME, EXTENSION_VERSION, {
      cliConfigDir: TMC_LANGS_CONFIG_DIR,
      javaHome: () => settings.getJavaHome(),
      httpProxy: () => settings.getHttpProxy(),
    })
    // A submit or paste would otherwise keep polling the backend past shutdown.
    context.subscriptions.push({ dispose: () => langsInstance.killAllProcesses() })
    langs = new Ok(langsInstance)
  }

  pendingGradings.attach(globalState)
  const authState = createAuthState(langs)
  authState.subscribe(() => coursesTree.setAccount(authState))
  context.subscriptions.push(trackWalkthroughActive())
  restoreWalkthroughMilestones(globalState)
  // Awaited only after the migration: it can refresh a token over the network, and nothing
  // before needs its answer.
  const initialAuthCheck = authState.refresh({ timeout: STARTUP_AUTH_CHECK_TIMEOUT })

  const workspaceFileFolder = init.workspaceFileFolderOf(context)

  const migration = await storage.migrateToLatest(
    dialog,
    langs.ok ? langs.val : undefined,
    vscode.workspace.getConfiguration(),
  )
  let migrationFailure: Error | undefined
  if (migration.kind === "needsReload") {
    const reopened = await reopenInMigratedWorkspace(workspaceFileFolder, migration.workspaceName)
    if (reopened.ok) {
      Logger.warn("Extension expected to restart to migrate the open workspace")
      return
    }
    migrationFailure = reopened.val
  } else if (migration.kind === "failed") {
    migrationFailure = migration.error
  }
  if (migrationFailure) {
    reportInitializationError("Migrating stored data", migrationFailure)
  }
  // Courses left unmigrated would read as an empty list.
  const unmigratedUserData =
    migration.kind !== "done" && !migration.hasMigratedUserData ? migrationFailure : undefined

  // After the migration, which can move the exercises and the projects-dir setting.
  const [authChecked, startupScan] = await Promise.all([
    initialAuthCheck,
    langs.ok ? scanLocalExercises(langs.val) : undefined,
  ])
  // A slow network or a first-run antivirus scan is no startup failure: the check is retried
  // until it answers.
  const isAuthCheckDeferred =
    authChecked.err &&
    (authChecked.val instanceof TimeoutError || authChecked.val instanceof ConnectionError)
  if (authChecked.err && !isAuthCheckDeferred) {
    reportInitializationError("Checking your login", authChecked.val)
  } else if (authChecked.err) {
    Logger.warn("Could not check the login at startup; checking again later", authChecked.val)
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

  // `tmc.showMoocLogin` exists only once a ready activation has registered it.
  let canOfferLogin = false

  const expiryNotifier = createExpiryNotifier(
    () => TmcPanel.isAnyScreenVisible(),
    () => {
      const logIn: NotificationButton = [
        "Log In",
        (): void => void vscode.commands.executeCommand("tmc.showMoocLogin"),
      ]
      dialog.warningNotification(LOGGED_OUT_MESSAGE, ...(canOfferLogin ? [logIn] : []))
    },
  )
  const sessionExpiredWarning = (): void => {
    authState.markSessionExpired()
    expiryNotifier.onExpired()
  }

  // Seeded from the startup check above; shared with the background poll further down.
  const sessionExpiry = createSessionExpiryTracker(authState.loggedIn, sessionExpiredWarning)
  dialog.setSessionLostReporter((cause) => sessionExpiry.onSessionLost(cause))

  if (langs.ok) {
    langs.val.on("login", async () => {
      await authState.set(true)
      void globalState.update(LOGGED_OUT_KEY, undefined)
      sessionExpiry.onLogin()
      expiryNotifier.onLogin()
      // Names the account, for the status bar and the exercise hand-over.
      void authState.refresh()
    })
    langs.val.on("logout", async (expected, rejection) => {
      if (expected) {
        await globalState.update(LOGGED_OUT_KEY, true)
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

  let versionChange: VersionChange | undefined
  let previousVersion: string | undefined
  try {
    previousVersion = storage.getSessionState()?.extensionVersion
    if (EXTENSION_VERSION !== previousVersion) {
      await storage.updateSessionState({ extensionVersion: EXTENSION_VERSION })
    }
    versionChange = versionChangeSince(previousVersion, EXTENSION_VERSION)
  } catch (e) {
    // An unreadable session state costs the walkthrough or the update notice, nothing else.
    Logger.warn("Skipped version check", e)
  }
  listWalkthroughUnlessUpdated(versionChange)

  let workspaceManager: WorkspaceManager | undefined
  let userData: Result<UserData, Error> | undefined =
    unmigratedUserData && new Err(unmigratedUserData)
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
      userData ??= new Ok(new UserData(storage))
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
        workspaceState,
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
      if (!isActiveCourseAiAllowed(courseWorkspace, courses)) {
        void closeChatSideBar()
      }
    }
  } else {
    Logger.warn("Skipped userdata setup")
  }
  const exerciseDecorationProvider =
    workspaceManager && userData?.ok
      ? new ExerciseDecorationProvider(userData.val, workspaceManager)
      : undefined

  const courseWorkspaceSwitches = new CourseWorkspaceSwitches(context.globalStorageUri.fsPath)
  // The window that switched here has just offered whatever the startup refresh would.
  const openingSwitch = await courseWorkspaceSwitches.take(vscode.workspace.workspaceFile?.fsPath)
  const isOpenedBySwitch = openingSwitch !== undefined
  await aiRestriction?.adopt(openingSwitch?.aiOffSettingsWritten ?? [])
  const trustGate = new WorkspaceTrustGate(
    ({ message, action }) => dialog.offer(message, action),
    (message) => void dialog.notification(message),
  )
  context.subscriptions.push(trustGate)
  const startup: Startup =
    langs.ok && resources.ok && workspaceManager && userData?.ok && exerciseDecorationProvider
      ? {
          kind: "ready",
          accountHandover: new AccountHandover(globalState),
          aiUseGate: new AiUseGate(aiRestriction, vscode.env.appName),
          courseWorkspaceSwitches,
          langs: langs.val,
          resources: resources.val,
          trustGate,
          workspaceManager,
          userData: userData.val,
          exerciseDecorationProvider,
          keptCopies: new KeptCopies(globalState),
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
        readyContext.dialog,
        course.ok ? LocalCourseData.getCourseTitle(course.val) : activeCourse,
        workspaceState,
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
    TmcPanel.showLoginScreens(context, actionContext),
  )
  if (readyContext) {
    init.registerSettingsCallbacks(readyContext)
    const account = new AccountStatusBarItem(authState)
    authState.subscribe(() => account.update(authState))
    // Only on a login or logout: a session naming its account changes no listing.
    let isAddCourseLoggedIn = authState.loggedIn
    authState.subscribe((loggedIn) => {
      if (loggedIn !== isAddCourseLoggedIn) {
        isAddCourseLoggedIn = loggedIn
        TmcPanel.reloadAddCourse()
      }
    })
    const moocAccount = new MoocAuthenticationProvider({
      isLoggedIn: () => authState.loggedIn,
      accountLabel: () => accountLabel(authState.session),
      login: async () => (await login(readyContext)) === "loggedIn",
      logout: () => logout(readyContext),
    })
    authState.subscribe((loggedIn) => moocAccount.setLoggedIn(loggedIn))
    context.subscriptions.push(
      moocAccount,
      vscode.authentication.registerAuthenticationProvider(
        MOOC_AUTHENTICATION_PROVIDER_ID,
        "MOOC.fi",
        moocAccount,
      ),
      account,
      new ExerciseStatusBarItem({
        workspaceManager: readyContext.startup.workspaceManager,
        userData: readyContext.startup.userData,
      }),
      new BackgroundStatusBarItem({ jobs: backgroundJobs, failedUpdates }),
      new JobProgressNotifications(readyContext.dialog, backgroundJobs, {
        isCourseHomeVisible: (courseId) => shownCourseHome.isShowing(courseId),
        isResultsVisible: (exerciseId) => submissionViews.shownFor(exerciseId) !== undefined,
        isCoursesViewVisible: () => coursesTree.isVisible,
        onDidChange: (listener) =>
          vscode.Disposable.from(
            shownCourseHome.onDidChange(listener),
            submissionViews.onDidChangeShown(listener),
            coursesTree.onDidChangeVisibility(listener),
          ),
      }),
      keepExerciseFilesInFirstGroup(
        (uri) => readyContext.startup.workspaceManager.getExerciseContaining(uri) !== undefined,
      ),
      new LanguageExtensionOffer(
        readyContext.dialog,
        readyContext.startup.workspaceManager,
        globalState,
      ),
      trackHasCourses(readyContext.startup.userData),
      trackActiveExerciseRemoved(
        readyContext.startup.workspaceManager,
        readyContext.startup.userData,
      ),
      trackActiveExerciseSubmitRefused(
        readyContext.startup.workspaceManager,
        readyContext.startup.userData,
      ),
      trackHasDownloadedExercises(readyContext.startup.workspaceManager),
      // Point totals come from the backend, so without this the Courses view and Course
      // Details totals stay stale until the user refreshes by hand.
      onDidFinishSubmission((courseId) => {
        reachWalkthroughMilestone("test-my-code:HasSubmitted")
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

  /** @returns Whether the login check answered. */
  async function runMaintenancePoll(): Promise<boolean> {
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
      return checked.ok
    } catch (e) {
      Logger.error("Maintenance check failed", e)
      return false
    }
  }

  setMaintenancePollArmed(authState.loggedIn)

  if (isAuthCheckDeferred) {
    // Until a check answers, the poll is not armed and the student is shown as logged out.
    let retry: NodeJS.Timeout | undefined
    let isDisposed = false
    const scheduleAuthRetry = (): void => {
      retry = setTimeout(() => {
        void runMaintenancePoll().then((isAnswered) => {
          if (!isAnswered && !isDisposed && !authState.loggedIn) {
            scheduleAuthRetry()
          }
        })
      }, DEFERRED_AUTH_CHECK_DELAY)
    }
    scheduleAuthRetry()
    context.subscriptions.push({
      dispose: () => {
        isDisposed = true
        clearTimeout(retry)
      },
    })
  }

  // Another window may have logged in, out or as someone else since this one last looked.
  let lastFocusAuthCheckAt = Date.now()
  async function recheckLoginOnFocus(): Promise<void> {
    if (Date.now() - lastFocusAuthCheckAt < FOCUS_AUTH_CHECK_INTERVAL) {
      return
    }
    lastFocusAuthCheckAt = Date.now()
    const wasLoggedIn = authState.loggedIn
    const checked = await authState.refresh()
    if (checked.err) {
      Logger.warn("Failed to recheck the login", checked.val)
      return
    }
    if (!wasLoggedIn && authState.loggedIn && readyContext) {
      refreshInBackground(readyContext, openCourseRefresh)
    }
  }

  // The poll alone would leave exercises published mid-session unnoticed for up to its whole
  // interval; coming back to the window is when the student would want to hear of them.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        return
      }
      void recheckLoginOnFocus().catch((e) => Logger.error("Login recheck failed", e))
      if (readyContext) {
        void readyContext.startup.userData
          .reloadFromStorage()
          .catch((e) => Logger.error("Rereading the stored courses failed", e))
      }
      if (
        readyContext &&
        authState.loggedIn &&
        Date.now() - lastBackgroundRefreshAt >= FOCUS_REFRESH_INTERVAL
      ) {
        refreshInBackground(readyContext, openCourseRefresh)
      }
    }),
  )

  if (readyContext) {
    const handoverContext = readyContext
    authState.subscribe(() => {
      const session = authState.session
      if (session?.kind === "mooc" && session.account) {
        void handOverExercisesOnAccountChange(handoverContext, session.account.id).catch((e) =>
          Logger.error("Checking whose the exercises are failed", e),
        )
      }
    })
    // Stored courses with no login and no logout is a session that ended while VS Code was closed.
    if (
      authChecked.ok &&
      !authState.loggedIn &&
      !globalState.get<boolean>(LOGGED_OUT_KEY) &&
      handoverContext.startup.userData.getCourses().length > 0
    ) {
      authState.markSessionExpired()
    }
  }

  // Created after the listener above, so that a full refresh due on the same focus runs first and
  // stands in for this one.
  if (readyContext) {
    openCourseRefresh = new OpenCourseRefresh({
      openCourse: () => (authState.loggedIn ? openCourseId(readyContext) : undefined),
      refresh: (courseId) =>
        void refreshEverything(readyContext, {
          silent: true,
          courseId,
          skipsRecentlyLostCourses: true,
        }).catch((e) => Logger.error("Open course refresh failed", e)),
    })
    context.subscriptions.push(openCourseRefresh)
  }

  if (readyContext && openingSwitch) {
    const courseId = openCourseId(readyContext)
    // Outside a window reload, a released VS Code opens the Explorer in place of the extension
    // view a workspace last showed in its sidebar. Activation can end after the student has
    // started typing in the new window, so the view must not take the keyboard.
    const shownCoursesView = courseId
      ? coursesTree.revealCourse(courseId, { isFocused: false })
      : vscode.commands.executeCommand(`${COURSES_VIEW_ID}.focus`)
    void Promise.resolve(shownCoursesView).catch((e) =>
      Logger.warn("Could not show the Courses view", e),
    )
    // The course home lists what to do next in the course just opened, so it goes in front of
    // the walkthrough, which still moves on to its next step behind it. Code the student opens
    // meanwhile goes in front instead: the walkthrough, once open, is the active editor, so
    // whether the student has one must be watched for rather than read afterwards.
    let studentEditor = vscode.window.activeTextEditor
    const studentEditorWatch = vscode.window.onDidChangeActiveTextEditor((editor) => {
      studentEditor = editor ?? studentEditor
    })
    void showNextWalkthroughStep(() => walkthroughProgressOf(readyContext), {
      isOpenedIfClosed: openingSwitch.isWalkthroughOpen,
    })
      .catch((e) => Logger.warn("Could not show the next walkthrough step", e))
      .then(async () => {
        if (!studentEditor && courseId) {
          await vscode.commands.executeCommand("tmc.courseDetails", courseId)
        }
        // Also one opened while the course home was being shown, which covered it.
        if (studentEditor) {
          await vscode.window.showTextDocument(studentEditor.document, studentEditor.viewColumn)
        }
      })
      .then(undefined, (e) => Logger.warn("Could not show the course home", e))
      .finally(() => studentEditorWatch.dispose())
  }

  if (readyContext && versionChange === "installed") {
    void openWalkthroughWhenRegistered(() => walkthroughProgressOf(readyContext), {
      isUnasked: true,
    }).catch((e) => Logger.warn("Could not open the walkthrough", e))
  } else if (readyContext && versionChange === "updated") {
    if ((semVerCompare(previousVersion ?? "", REDESIGN_VERSION, "patch") ?? 0) < 0) {
      void dialog.notification(
        `TestMyCode ${EXTENSION_VERSION} looks different: your courses are in the TestMyCode view, ` +
          "Run Tests and Submit are buttons in the editor title, and the old Ctrl+Shift+T, C and A " +
          "shortcuts are gone.",
        [
          "What's New",
          (): void =>
            void vscode.commands.executeCommand(
              "markdown.showPreview",
              vscode.Uri.joinPath(context.extensionUri, "CHANGELOG.md"),
            ),
        ],
        [
          "Show Courses",
          (): void => void vscode.commands.executeCommand(`${COURSES_VIEW_ID}.focus`),
        ],
      )
    } else {
      dialog.statusMessage(`TestMyCode was updated to ${EXTENSION_VERSION}.`)
    }
  }

  initializationErrors.notify(!readyContext)
}

// Everything activation starts is registered in `context.subscriptions`, which VS Code
// disposes for us; this exists because the extension API requires the export.
export function deactivate(): void {}

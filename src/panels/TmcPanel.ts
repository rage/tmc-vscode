import { upperFirst } from "lodash"
import type { Webview, WebviewOptions, WebviewPanel } from "vscode"
import { Disposable, extensions, Uri, ViewColumn, window } from "vscode"
import type * as vscode from "vscode"

import type { ExerciseSubmissionPanel, LoginPanel, Panel, SubmissionView } from "../../shared/lib"
import {
  assertUnreachable,
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  arePointsHeldForReview,
  offersLogIn,
  SUBMIT_REFUSAL_LABELS,
  submitRefusalOf,
  submitRefusalSentence,
  pendingReviewSentence,
  unwrap,
  WebviewStateSchema,
} from "../../shared/lib"
import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type { StoredExercise, UserData } from "../config/userdata"
import { getExerciseIncludingClosedChapters } from "../config/userdata"
import { buildCourseHomeView } from "../ui/courseHome"
import { exerciseStandingView, leadsOnFrom, nextExerciseOf } from "../ui/exerciseStanding"
import { failedUpdates } from "../ui/failedUpdates"
import { lastExerciseReached } from "../ui/lastExerciseReached"
import { loginScreens } from "../ui/loginScreens"
import { modelSolutionUrl } from "../ui/modelSolution"
import { recentPolicyChanges } from "../ui/recentPolicyChanges"
import { recentUpdates } from "../ui/recentUpdates"
import { shownCourseHome } from "../ui/shownCourseHome"
import { submissionViews } from "../ui/submissionViews"
import { Logger } from "../utilities"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { messageHandlers } from "./handlers"
import { postMessageToWebview, renderPanel } from "./panel"
import type { HandlerContext, PanelHost, PanelMessage } from "./router"
import { dispatch } from "./router"
import { errorDetailsPanel, initializationErrorHelpPanel, nextPanelId, panelTitle } from "./routes"
import { failuresClearedMessage, screenFailureMessage } from "./screenFailures"
import { withExerciseState } from "./submissionView"

/**
 * The main panel's webview type, which its serializer is registered for.
 *
 * Namespaced, as webview types are one registry shared by every extension. package.json's
 * `onWebviewPanel:` activation event must name it.
 */
export const MAIN_PANEL_VIEW_TYPE = "tmc.mainPanel"

/** The side panel's webview type; like {@link MAIN_PANEL_VIEW_TYPE}, an activation event names it. */
export const SIDE_PANEL_VIEW_TYPE = "tmc.sidePanel"

/**
 * Manages the extension's two webview panels: their lifecycle, and the transport to and
 * from each. What a message does is up to its handler in `./handlers`.
 */
export class TmcPanel {
  public static mainPanel: TmcPanel | undefined

  // extra panel for situations where we want to render another view beside the main one
  public static sidePanel: TmcPanel | undefined

  private readonly _panel: WebviewPanel

  private readonly _actionContext: ActionContext

  private readonly _isMain: boolean

  // resent on "ready" so a reloaded webview can recover. Per-instance: the main and
  // side panels show different panels.
  private _route: Panel | undefined

  // Until "ready", messages are only buffered: that handshake is the single path that
  // renders a panel, for a new document and one reloaded after being hidden alike.
  private _isWebviewReady = false

  // latest message per type targeted at _route's id, resent after it on "ready"
  // so a reload doesn't lose one-shot results that already fired
  private _messageBuffer = new Map<string, PanelMessage>()

  private _disposables: Disposable[] = []

  // `_panel.dispose()` fires `onDidDispose`, which calls back into `dispose()`
  private _isDisposed = false

  /**
   * Shows the submissions the submit actions report in the side panel. Call once, at activation.
   *
   * An outcome for a submission the side panel is not showing reopens a closed panel on it, and
   * otherwise is offered in a notification, so the student's current view stays put.
   */
  public static showSubmissionViews(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): Disposable {
    const show = (panel: ExerciseSubmissionPanel): void =>
      TmcPanel._showSubmission(extensionContext, actionContext, panel)
    const repostShown = (): void => {
      const route = TmcPanel.sidePanel?._route
      const view = route?.type === "ExerciseSubmission" && submissionViews.latestView(route.id)
      if (route?.type === "ExerciseSubmission" && view) {
        TmcPanel.sidePanel?._postMessage(submissionViewMessage(actionContext, route, view))
      }
    }
    const subscriptions = Disposable.from(
      submissionViews.onDidOpen(show),
      submissionViews.onDidRequestReveal(({ panel, section }) => {
        TmcPanel._renderIn(false, extensionContext, actionContext, panel, true)
        const sidePanel = TmcPanel.sidePanel
        const view = submissionViews.latestView(panel.id)
        if (view !== undefined) {
          sidePanel?._postMessage(submissionViewMessage(actionContext, panel, view))
        }
        if (section) {
          sidePanel?._postMessage({
            type: "openExerciseSection",
            target: { id: panel.id, type: panel.type },
            section: section.name,
            serial: section.serial,
            shouldPaste: section.shouldPaste,
          })
        }
      }),
      submissionViews.onDidFail(({ exerciseId, headline, error, tone }) => {
        const sidePanel = TmcPanel.sidePanel
        const route = sidePanel?._route
        if (
          route?.type === "ExerciseSubmission" &&
          ExerciseIdentifier.key(route.exerciseId) === ExerciseIdentifier.key(exerciseId)
        ) {
          sidePanel?._postMessage(screenFailureMessage(route, headline, error, tone))
        }
      }),
      submissionViews.onDidClearFailures(({ exerciseId, operation }) => {
        const route = TmcPanel.sidePanel?._route
        if (
          route?.type === "ExerciseSubmission" &&
          ExerciseIdentifier.key(route.exerciseId) === ExerciseIdentifier.key(exerciseId)
        ) {
          TmcPanel.sidePanel?._postMessage(failuresClearedMessage(route, operation))
        }
      }),
      submissionViews.onDidClear(() => {
        if (TmcPanel.sidePanel?._route?.type === "ExerciseSubmission") {
          TmcPanel.sidePanel.dispose()
        }
      }),
      submissionViews.onDidUpdate(({ panel, view, shouldReopen }) => {
        const { sidePanel } = TmcPanel
        if (sidePanel?._route?.id === panel.id) {
          sidePanel._postMessage(submissionViewMessage(actionContext, panel, view))
        } else if (shouldReopen && sidePanel === undefined) {
          show(panel)
        } else if (shouldReopen) {
          void offerSubmissionOutcome(actionContext, panel, view, show)
        }
      }),
      ...(isReady(actionContext)
        ? [
            actionContext.startup.workspaceManager.onDidChangeExercises(repostShown),
            actionContext.startup.userData.onDidChangeCourses(repostShown),
          ]
        : []),
    )
    // A login or logout turns the results screen's Submit into Log In to Submit, or back.
    let wasLoggedIn = actionContext.authState.loggedIn
    actionContext.authState.subscribe((loggedIn) => {
      const isAccountChange = loggedIn !== wasLoggedIn
      wasLoggedIn = loggedIn
      submissionViews.replaceLatest(({ panel, view }) =>
        isSupersededByAuthChange(view, loggedIn && isAccountChange)
          ? standingAfterFailure(actionContext, panel)
          : undefined,
      )
      // What failed under the earlier account, or for the lack of one, is no longer the story.
      if (isAccountChange) {
        TmcPanel.mainPanel?._clearFailures()
        TmcPanel.sidePanel?._clearFailures()
      }
      repostShown()
    })
    return subscriptions
  }

  /**
   * Shows each login's screen in the main panel, with the views the login sends it. Call once,
   * at activation.
   */
  public static showLoginScreens(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): Disposable {
    const post = (panel: LoginPanel): void => {
      const view = loginScreens.latestView(panel.id)
      if (view && TmcPanel.mainPanel?._route?.id === panel.id) {
        TmcPanel.mainPanel._postMessage({
          type: "loginView",
          target: { id: panel.id, type: panel.type },
          view,
        })
      }
    }
    return Disposable.from(
      loginScreens.onDidOpen((panel) => {
        TmcPanel.renderMain(extensionContext, actionContext, panel)
        post(panel)
      }),
      loginScreens.onDidUpdate(({ panel }) => post(panel)),
      loginScreens.onDidRequestClose((panel) => {
        if (TmcPanel.mainPanel?._route?.id === panel.id) {
          TmcPanel.mainPanel.dispose()
        }
      }),
    )
  }

  /** Shows `panel` in the side panel with the latest view its submission reported. */
  private static _showSubmission(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: ExerciseSubmissionPanel,
  ): void {
    TmcPanel.renderSide(extensionContext, actionContext, panel)
    const view = submissionViews.latestView(panel.id)
    if (view !== undefined) {
      TmcPanel.sidePanel?._postMessage(submissionViewMessage(actionContext, panel, view))
    }
  }

  /** Whether the student can see either panel now, whichever screen it shows. */
  public static isAnyScreenVisible(): boolean {
    return [TmcPanel.mainPanel, TmcPanel.sidePanel].some(
      (shown) => shown !== undefined && !shown._isDisposed && shown._panel.visible,
    )
  }

  /** Tells the two panels' log lines apart. */
  private get _webviewName(): string {
    return this._isMain ? "Main webview" : "Side webview"
  }

  /** Takes back every failure this panel's screen shows. */
  private _clearFailures(): void {
    const route = this._route
    if (route?.type === "CourseDetails" || route?.type === "ExerciseSubmission") {
      this._postMessage(failuresClearedMessage(route))
    }
  }

  /** Sends `message` to this panel's webview alone, buffering it for a reload. */
  private _postMessage(message: PanelMessage): void {
    if (message.type === "failuresCleared") {
      for (const [key, buffered] of this._messageBuffer) {
        if (
          buffered.type === "operationFailed" &&
          buffered.target.id === message.target.id &&
          (message.operation === undefined || buffered.failure.operation === message.operation)
        ) {
          this._messageBuffer.delete(key)
        }
      }
      // Not buffered: a reloaded document is resent only the failures still standing.
      this._postTransient(message)
      return
    }
    // A `reply` is left out: the reloaded webview asks again, and a replayed answer to the
    // request of a page that no longer exists settles nothing.
    if (message.type !== "reply" && message.target.id === this._route?.id) {
      // Each failure is resent, not only the latest: a reloaded screen lists them all.
      const key =
        message.type === "operationFailed"
          ? `${message.target.id}:${message.type}:${message.failure.serial}`
          : `${message.target.id}:${message.type}`
      this._messageBuffer.set(key, message)
      this._dropOldestFailures()
    }
    this._postTransient(message)
  }

  private _dropOldestFailures(): void {
    const failures = [...this._messageBuffer].filter(
      ([, buffered]) => buffered.type === "operationFailed",
    )
    for (const [key] of failures.slice(0, -FAILURES_RESENT)) {
      this._messageBuffer.delete(key)
    }
  }

  private _postTransient(message: PanelMessage): void {
    if (!this._isWebviewReady || this._isDisposed) {
      return
    }
    postMessageToWebview(this._panel.webview, message, this._webviewName)
  }

  /** Shows `route` in the main panel, creating the panel if needed. */
  public static renderMain(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
  ): void {
    TmcPanel._renderIn(true, extensionContext, actionContext, route)
  }

  /**
   * Shows `route` in the side panel without taking focus: submission results appear while the
   * student is typing, and must not pull their keystrokes away.
   */
  public static renderSide(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
  ): void {
    TmcPanel._renderIn(false, extensionContext, actionContext, route)
  }

  /**
   * Shows `route`, which the student asked for, focused in the panel other than the screen they
   * asked from, as a tab in that screen's editor group; asked from no screen, in the side panel.
   */
  public static renderBeside(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
    askedFrom: "main" | "side" | undefined,
  ): void {
    const opener = askedFrom === "main" ? TmcPanel.mainPanel : TmcPanel.sidePanel
    const column = askedFrom === undefined ? undefined : opener?._panel.viewColumn
    TmcPanel._renderIn(askedFrom === "side", extensionContext, actionContext, route, true, column)
  }

  /**
   * @param isRequested The student asked for `route`, so it takes the focus even beside.
   * @param column The editor group to show the panel in; by default the main panel stays where it
   * is, and the side panel stays beside the first group, which holds the exercise files.
   */
  private static _renderIn(
    isMain: boolean,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
    isRequested = isMain,
    column?: ViewColumn,
  ): void {
    const existing = isMain ? TmcPanel.mainPanel : TmcPanel.sidePanel
    if (existing !== undefined) {
      Logger.info(`Revealing the ${existing._webviewName} for "${route.type}"`)
      // Rendering the shown screen again would reload its document for nothing.
      if (existing._route?.id !== route.id) {
        existing._render(route)
      }
      // A side panel Error Details put among the exercise files goes back beside them.
      const isAmongCode = !isMain && existing._panel.viewColumn === ViewColumn.One
      existing._panel.reveal(column ?? (isAmongCode ? ViewColumn.Two : undefined), !isRequested)
      return
    }
    // VS Code restores a background webview without asking the serializer until it is shown,
    // so the main panel a reload brought back may sit there unadopted.
    const restoredMainTabs = isMain ? panelTabs(MAIN_PANEL_VIEW_TYPE) : []
    const restoredColumn = restoredMainTabs[0]?.group.viewColumn
    // `Beside` would follow the active group, which a third group could be.
    const showOptions = isMain
      ? { viewColumn: column ?? restoredColumn ?? ViewColumn.One, preserveFocus: false }
      : { viewColumn: column ?? ViewColumn.Two, preserveFocus: !isRequested }
    const panelViewType = isMain ? MAIN_PANEL_VIEW_TYPE : SIDE_PANEL_VIEW_TYPE
    const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", showOptions, {
      ...webviewOptions(extensionContext.extensionUri),
      enableFindWidget: true,
    })
    const created = TmcPanel._adopt(webviewPanel, extensionContext, actionContext, route, isMain)
    if (isMain) {
      TmcPanel.mainPanel = created
      void closeTabs(restoredMainTabs, "restored main panel tab(s), replaced by a new one")
    } else {
      TmcPanel.sidePanel = created
    }
  }

  /**
   * Reopens the main panel VS Code restores after a window reload, on the screen its webview
   * saved. One whose screen cannot be shown any more, or whose activation failures this one
   * did not repeat, is closed instead. A restored side panel is always closed: the submission
   * it showed lived only in the previous extension host's memory.
   */
  public static registerSerializers(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): Disposable {
    const main = TmcPanel._registerMainSerializer(extensionContext, actionContext)
    // Without a serializer VS Code would restore the side panel's editor group empty.
    const side = window.registerWebviewPanelSerializer(SIDE_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: async (webviewPanel) => {
        Logger.info("Closing a restored side panel, whose submission is gone")
        webviewPanel.dispose()
      },
    })
    // VS Code asks the serializer only once a restored tab is shown, so a background one stays.
    void closeSidePanelTabs()
    return Disposable.from(main, side)
  }

  private static _registerMainSerializer(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): Disposable {
    return window.registerWebviewPanelSerializer(MAIN_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: async (webviewPanel, state) => {
        const route = restoredRoute(state, actionContext, extensionContext)
        if (!route || TmcPanel.mainPanel !== undefined) {
          Logger.info("Closing a restored main panel, which has no screen to show")
          webviewPanel.dispose()
          return
        }
        Logger.info(`Restoring the main panel on "${route.type}"`)
        // The saved options may name an older install's directory.
        webviewPanel.webview.options = webviewOptions(extensionContext.extensionUri)
        TmcPanel.mainPanel = TmcPanel._adopt(
          webviewPanel,
          extensionContext,
          actionContext,
          route,
          true,
        )
      },
    })
  }

  private static _adopt(
    webviewPanel: WebviewPanel,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
    isMain: boolean,
  ): TmcPanel {
    const { extensionUri } = extensionContext
    webviewPanel.iconPath = {
      light: Uri.joinPath(extensionUri, "media", "TMC-light.svg"),
      dark: Uri.joinPath(extensionUri, "media", "TMC.svg"),
    }
    const currentPanel = new TmcPanel(webviewPanel, extensionContext, actionContext, isMain)
    currentPanel._render(route)
    return currentPanel
  }

  private constructor(
    panel: WebviewPanel,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    isMain: boolean,
  ) {
    this._panel = panel
    this._actionContext = actionContext
    this._isMain = isMain

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    // A hidden webview's document is destroyed; the one VS Code loads on reveal sends "ready".
    this._panel.onDidChangeViewState(
      ({ webviewPanel }) => {
        if (!webviewPanel.visible) {
          this._isWebviewReady = false
        }
        this._recordShown()
      },
      null,
      this._disposables,
    )

    this._panel.webview.html = webviewContent(this._panel.webview, extensionContext.extensionUri)

    if (isReady(actionContext)) {
      this._disposables.push(
        actionContext.startup.userData.onDidChangeCourses((changed) =>
          this._onDidChangeCourses(changed),
        ),
        // Every other source of the Courses view, gathered into one change per burst.
        actionContext.coursesTree.onDidRender(() => this._onDidChangeCourses(undefined)),
        recentUpdates.onDidChange(() => this._onDidChangeCourses(undefined)),
        failedUpdates.onDidChange(() => this._onDidChangeCourses(undefined)),
        recentPolicyChanges.onDidChange(() => this._onDidChangeCourses(undefined)),
        lastExerciseReached.onDidChange(() => this._onDidChangeCourses(undefined)),
        shownCourseHome.onDidClearFailures(({ courseId, operation }) => {
          const route = this._route
          if (
            route?.type === "CourseDetails" &&
            CourseIdentifier.equals(route.courseId, courseId)
          ) {
            this._postMessage(failuresClearedMessage(route, operation))
          }
        }),
        // Installing a language extension the course home asks for clears its notice.
        extensions.onDidChange(() => this._onDidChangeCourses(undefined)),
        shownCourseHome.onDidFail(({ courseId, headline, error, tone }) => {
          const route = this._route
          if (
            route?.type === "CourseDetails" &&
            CourseIdentifier.equals(route.courseId, courseId)
          ) {
            this._postMessage(screenFailureMessage(route, headline, error, tone))
          }
        }),
      )
    }

    const handlerContext: HandlerContext = {
      host: this._createHost(extensionContext),
      actionContext,
    }
    const handlers = {
      ...messageHandlers,
      ready: { requiresReady: false, handle: () => this._onReady() },
    } as const
    this._panel.webview.onDidReceiveMessage(
      (message: unknown) => dispatch(handlers, message, handlerContext),
      undefined,
      this._disposables,
    )
  }

  public dispose(): void {
    if (this._isDisposed) {
      return
    }
    this._isDisposed = true
    this._panel.dispose()
    this._leaveLoginScreen()

    if (this._isMain) {
      TmcPanel.mainPanel = undefined
      shownCourseHome.set(undefined)
    } else {
      TmcPanel.sidePanel = undefined
      submissionViews.setShown(undefined)
    }

    while (this._disposables.length > 0) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }

  private _createHost(extensionContext: vscode.ExtensionContext): PanelHost {
    const currentRoute = (): Panel | undefined => this._route
    const isVisible = (): boolean => !this._isDisposed && this._panel.visible
    return {
      name: this._webviewName,
      get route() {
        return currentRoute()
      },
      get isVisible() {
        return isVisible()
      },
      post: (message) => this._postMessage(message),
      closeSidePanel: () => TmcPanel.sidePanel?.dispose(),
      showBeside: (route) =>
        TmcPanel.renderBeside(
          extensionContext,
          this._actionContext,
          route,
          this._isMain ? "main" : "side",
        ),
    }
  }

  /**
   * Keeps a CourseDetails screen and its tab title on the course's current state. Not
   * buffered: the screen asks for it whenever its document loads.
   *
   * @param changed The one course that changed; `undefined` when any may have.
   */
  private _onDidChangeCourses(changed: CourseIdentifier | undefined): void {
    const route = this._route
    if (route?.type !== "CourseDetails" || !isReady(this._actionContext)) {
      return
    }
    if (changed && !CourseIdentifier.equals(changed, route.courseId)) {
      return
    }
    // A removed course leaves nothing to show, e.g. after Remove Course in its own notice.
    if (this._actionContext.startup.userData.getCourse(route.courseId).err) {
      this.dispose()
      return
    }
    // Hidden, the document is gone, and the one loaded on reveal asks for the view itself.
    if (!this._isWebviewReady) {
      return
    }
    const view = buildCourseHomeView(this._actionContext, route.courseId)
    if (view.err) {
      return
    }
    this._panel.title = panelTitle(route, this._actionContext)
    this._postTransient({
      type: "setCourseHomeView",
      target: { id: route.id, type: route.type },
      view: view.val,
    })
  }

  /**
   * Tells {@link shownCourseHome} which course this main panel shows on screen, and
   * {@link submissionViews} which submission this side panel shows, if any.
   */
  private _recordShown(): void {
    if (this._isDisposed) {
      return
    }
    const route = this._route
    const isVisible = this._panel.visible
    if (this._isMain) {
      shownCourseHome.set(route?.type === "CourseDetails" && isVisible ? route.courseId : undefined)
    } else {
      submissionViews.setShown(
        route?.type === "ExerciseSubmission" && isVisible ? route : undefined,
      )
    }
  }

  /** Tells the login this panel shows, if any, that its screen is gone. */
  private _leaveLoginScreen(): void {
    if (this._route?.type === "Login") {
      loginScreens.leave(this._route.id)
    }
  }

  // remembers `route` so "ready" can (re)send it
  private _render(route: Panel): void {
    if (this._route?.id !== route.id) {
      this._leaveLoginScreen()
    }
    this._route = route
    this._recordShown()
    this._messageBuffer.clear()
    this._panel.title = panelTitle(route, this._actionContext)
    if (this._isWebviewReady && !this._isDisposed) {
      renderPanel(route, this._panel.webview)
    }
  }

  private _onReady(): void {
    this._isWebviewReady = true
    const route = this._route
    Logger.info(
      `Received "ready" from the ${this._webviewName}` +
        (route ? `, resending panel "${route.type}"` : ", no panel to resend"),
    )
    if (!route) {
      return
    }
    // Not `_render`, which would clear the buffer about to be resent.
    renderPanel(route, this._panel.webview)
    for (const buffered of this._messageBuffer.values()) {
      postMessageToWebview(this._panel.webview, buffered, this._webviewName)
    }
  }
}

/**
 * Whether an account change makes `view` out of date: a submission that failed before reaching
 * the backend. One whose remedy is logging in stays until a login, as it still says what to do.
 */
function isSupersededByAuthChange(view: SubmissionView, isLogin: boolean): boolean {
  return view.phase === "failed" && !view.canKeepWaiting && (isLogin || !offersLogIn(view.error))
}

/** The exercise's standing, shown in place of a failure that no longer holds. */
function standingAfterFailure(
  actionContext: ActionContext,
  panel: ExerciseSubmissionPanel,
): SubmissionView | undefined {
  return isReady(actionContext)
    ? exerciseStandingView(actionContext.startup.userData, panel.exerciseId)
    : undefined
}

function submissionViewMessage(
  actionContext: ActionContext,
  panel: ExerciseSubmissionPanel,
  view: SubmissionView,
): PanelMessage {
  if (!isReady(actionContext)) {
    return { type: "submissionView", target: { id: panel.id, type: panel.type }, view }
  }
  const { userData } = actionContext.startup
  const stored = getExerciseIncludingClosedChapters(userData, panel.exerciseId)
  const exercise = stored.ok ? stored.val.exercise : undefined
  const refusal =
    exercise && submitRefusalOf(exercise, new Date(), stored.ok ? stored.val.course : undefined)
  // Without a submission the view is the stored standing, which a course refresh changes. A
  // submission that failed is out of date once the exercise can no longer be submitted at all.
  const isStanding =
    view.phase === "standing" || (view.phase === "failed" && !view.canKeepWaiting && !!refusal)
  const current = withCurrentStanding(
    userData,
    isStanding ? (exerciseStandingView(userData, panel.exerciseId) ?? view) : view,
    stored.ok ? stored.val : undefined,
    panel.exerciseId,
  )
  const shown = withExerciseState(current, {
    isOnDisk: actionContext.startup.workspaceManager.getExercise(panel.exerciseId) !== undefined,
    isInCourse: stored.ok,
    submitRefusal:
      exercise && refusal
        ? submitRefusalSentence(
            refusal,
            exercise.data.name,
            exercise.kind === "mooc" ? exercise.data.chapter?.name : undefined,
          )
        : undefined,
    submitRefusalLabel: refusal && upperFirst(SUBMIT_REFUSAL_LABELS[refusal]),
    triesLeft: exercise?.kind === "mooc" ? exercise.data.triesLeft : undefined,
    pendingReview:
      exercise?.kind === "mooc" && exercise.data.pendingReview
        ? pendingReviewSentence(exercise.data.pendingReview, exercise.data.awardedPoints)
        : undefined,
    solutionUrl: exercise && stored.ok ? modelSolutionUrl(stored.val) : undefined,
    materialUrl: exercise && stored.ok ? materialUrlOf(stored.val) : undefined,
    isLoggedOut: !actionContext.authState.loggedIn,
    arePointsHeld:
      exercise?.kind === "mooc" &&
      arePointsHeldForReview(exercise.data.pendingReview, exercise.data.awardedPoints),
  })
  return { type: "submissionView", target: { id: panel.id, type: panel.type }, view: shown }
}

/**
 * `view` with whether the exercise is passed and the exercise to go on to, as the course stands
 * now: a refresh since the grading can hold its points for a review, or end the enrollment.
 */
function withCurrentStanding(
  userData: UserData,
  view: SubmissionView,
  stored: StoredExercise | undefined,
  exerciseId: ExerciseIdentifier,
): SubmissionView {
  if (!stored || (view.phase !== "finished" && view.phase !== "standing")) {
    return view
  }
  const { nextExercise: _graded, isExercisePassed: gradedPassed, ...rest } = view
  const isExercisePassed = gradedPassed === undefined ? undefined : unwrap(stored.exercise).passed
  const nextExercise =
    leadsOnFrom(stored.exercise) && stored.course
      ? nextExerciseOf(userData, LocalCourseData.getCourseId(stored.course), exerciseId)
      : undefined
  return {
    ...rest,
    ...(isExercisePassed === undefined ? {} : { isExercisePassed }),
    ...(nextExercise ? { nextExercise } : {}),
  }
}

/** The exercise's course material page, else its course's. */
function materialUrlOf({ exercise, course }: StoredExercise): string | undefined {
  if (exercise.kind === "mooc") {
    return exercise.data.pageUrl
  }
  return course.kind === "tmc" ? (course.data.materialUrl ?? undefined) : undefined
}

/** Offers to show the outcome of a submission the side panel is not showing. */
async function offerSubmissionOutcome(
  { dialog }: ActionContext,
  panel: ExerciseSubmissionPanel,
  view: SubmissionView,
  show: (panel: ExerciseSubmissionPanel) => void,
): Promise<void> {
  const isShowRequested = await dialog.offer(
    `Submission of ${panel.exerciseName}: ${view.headline}`,
    "Show Result",
  )
  // A later submission of the exercise supersedes this one.
  if (isShowRequested && submissionViews.latestView(panel.id) !== undefined) {
    show(panel)
  }
}

/** How many of a screen's failures a reloaded webview is sent again, the latest. */
const FAILURES_RESENT = 5

function webviewOptions(extensionUri: Uri): WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [Uri.joinPath(extensionUri, "webview-ui/public/build")],
  }
}

/** Closes every side panel tab, which at activation can only be one restored from before. */
async function closeSidePanelTabs(): Promise<void> {
  await closeTabs(
    panelTabs(SIDE_PANEL_VIEW_TYPE),
    "restored side panel tab(s), whose submission is gone",
  )
}

/** The tabs of every panel of `viewType`, in this window's tab groups. */
function panelTabs(viewType: string): vscode.Tab[] {
  return window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      const tabViewType = (tab.input as { viewType?: unknown } | undefined)?.viewType
      // VS Code prefixes the type a webview was created with, e.g. "mainThreadWebview-".
      return typeof tabViewType === "string" && tabViewType.endsWith(viewType)
    }),
  )
}

/** @param what Completes "Closing <n> ..." in the log. */
async function closeTabs(tabs: vscode.Tab[], what: string): Promise<void> {
  if (tabs.length === 0) {
    return
  }
  Logger.info(`Closing ${tabs.length} ${what}`)
  try {
    await window.tabGroups.close(tabs)
  } catch (error) {
    Logger.warn(`Could not close ${what}`, error)
  }
}

/** The screen a restored main panel's saved `state` names, if it can still be shown. */
function restoredRoute(
  state: unknown,
  actionContext: ActionContext,
  extensionContext: vscode.ExtensionContext,
): Panel | undefined {
  const saved = WebviewStateSchema.safeParse(state)
  const route = saved.success ? saved.data.route : undefined
  switch (route?.type) {
    case "CourseDetails": {
      const isCourseStored =
        isReady(actionContext) && actionContext.startup.userData.getCourse(route.courseId).ok
      return isCourseStored ? { id: nextPanelId(), ...route } : undefined
    }
    case "ErrorHelp":
      if (route.kind === "operation") {
        return route.detailsId === undefined ? undefined : errorDetailsPanel(route.detailsId)
      }
      // A startup help reopened after a healthy start would list another start's failures.
      return route.kind === "startup" && isReady(actionContext)
        ? undefined
        : initializationErrorHelpPanel(actionContext, extensionContext)
    case "AddCourse":
      return isReady(actionContext) ? { id: nextPanelId(), type: route.type } : undefined
    case undefined:
      return undefined
    default:
      return assertUnreachable(route)
  }
}

function webviewContent(webview: Webview, extensionUri: Uri): string {
  const stylesUri = getUri(webview, extensionUri, ["webview-ui", "public", "build", "bundle.css"])
  const scriptUri = getUri(webview, extensionUri, ["webview-ui", "public", "build", "bundle.js"])
  const codiconCssUri = getUri(webview, extensionUri, [
    "webview-ui",
    "public",
    "build",
    "codicon.css",
  ])

  const nonce = getNonce()

  return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <title>TestMyCode</title>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta
                    http-equiv="Content-Security-Policy"
                    content="
                        default-src 'none';
                        img-src ${webview.cspSource};
                        font-src ${webview.cspSource};
                        style-src 'nonce-${nonce}';
                        script-src 'nonce-${nonce}';"
                />
                <meta property="csp-nonce" content="${nonce}" />
                <link nonce="${nonce}" rel="stylesheet" type="text/css" href="${stylesUri}" />
                <!-- id required: vscode-icon clones this stylesheet into each icon's shadow root.
                     crossorigin: serveCodiconsFromMemory reads its rules. -->
                <link
                    nonce="${nonce}"
                    id="vscode-codicon-stylesheet"
                    rel="stylesheet"
                    type="text/css"
                    crossorigin="anonymous"
                    href="${codiconCssUri}"
                />
                <script defer nonce="${nonce}" src="${scriptUri}"></script>
            </head>
            <body></body>
            </html>
      `
}

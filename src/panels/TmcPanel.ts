import getFolderSize from "get-folder-size"
import type { Result } from "ts-results"
import { Err } from "ts-results"
import type { Disposable, Webview, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import * as vscode from "vscode"
import { z } from "zod"

import type { ActionContext, ReadyActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type Dialog from "../api/dialog"
import { ConnectionError, InitializationError } from "../errors"
import type {
  BackendKind,
  CourseDetailsPanel,
  CourseIdentifier,
  ExerciseGroup,
  ExerciseIdentifier,
  ExerciseStatus,
  ExtensionToWebview,
  MyCoursesPanel,
  Panel,
  TargetPanel,
  WebviewToExtension,
  WelcomePanel,
} from "../shared/shared"
import {
  LocalCourseData,
  LocalCourseExercise,
  panelTarget,
  toWebviewError,
  WebviewToExtensionSchema,
} from "../shared/shared"
import { cliFolder, formatSizeInBytes, Logger } from "../utilities"
import { buildCourseDetailsView } from "./courseDetailsViewModel"
import type { CourseDetailsView } from "./courseDetailsViewModel"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { moocLoginRegistry } from "./moocLoginRegistry"
import { postMessageToWebview, renderPanel } from "./panel"
import { updateablesRegistry } from "./updateablesRegistry"

/**
 * The action- and command-layer entry points the webview message handlers invoke.
 *
 * Declared here and supplied at activation rather than imported: both of those layers
 * import this module, so importing them back would put the panel layer inside a runtime
 * import cycle spanning most of the extension. The signatures are checked against the
 * real functions where `registerWebviewHandlers` is called.
 */
export interface WebviewHandlers {
  /** Stops the test run `testRunId`. Does nothing if it already finished. */
  cancelTests: (testRunId: number) => void
  closeExercises: (
    actionContext: ReadyActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<ExerciseIdentifier[], Error>>
  downloadAndOpenExercises: (
    extensionContext: vscode.ExtensionContext,
    actionContext: ReadyActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<ExerciseIdentifier[], Error>>
  downloadExercisesForUi: (
    actionContext: ReadyActionContext,
    mode: string,
    courseId: CourseIdentifier,
    ids: ExerciseIdentifier[],
  ) => Promise<void>
  openWorkspace: (
    actionContext: ReadyActionContext,
    courseName: string,
    backend: BackendKind,
  ) => Promise<void>
  pasteExercise: (
    actionContext: ReadyActionContext,
    backend: BackendKind,
    courseSlug: string,
    exerciseName: string,
  ) => Promise<Result<string, Error>>
  /** Rescans the exercises on disk, so exercises the backend dropped stop showing as open. */
  refreshLocalExercises: (actionContext: ReadyActionContext) => Promise<Result<void, Error>>
  removeCourse: (actionContext: ReadyActionContext, id: CourseIdentifier) => Promise<void>
  submitExercise: (
    extensionContext: vscode.ExtensionContext,
    actionContext: ReadyActionContext,
    exerciseUri: vscode.Uri,
  ) => Promise<Result<void, Error>>
  updateCourse: (
    actionContext: ReadyActionContext,
    courseId: CourseIdentifier,
  ) => Promise<Result<boolean, Error>>
}

let registeredHandlers: WebviewHandlers | undefined

/** Wires the panel layer to the actions and commands it dispatches to. Called once, at activation. */
export function registerWebviewHandlers(webviewHandlers: WebviewHandlers): void {
  registeredHandlers = webviewHandlers
}

function handlers(): WebviewHandlers {
  if (registeredHandlers === undefined) {
    throw new InitializationError("Webview handlers were never registered")
  }
  return registeredHandlers
}

type PanelDataTarget =
  | TargetPanel<WelcomePanel>
  | TargetPanel<MyCoursesPanel>
  | TargetPanel<CourseDetailsPanel>

/**
 * Manages the rendering of the extension webview panels.
 */
export class TmcPanel {
  // primary panel that most data is displayed in
  public static mainPanel: TmcPanel | undefined

  // extra panel for situations where we want to render another view beside the main one
  public static sidePanel: TmcPanel | undefined

  private readonly _panel: WebviewPanel

  // if true, this is the main panel, otherwise this is the side panel
  private readonly _isMain: boolean

  // resent on "ready" so a reloaded webview can recover. Per-instance: the main and
  // side panels show different panels.
  private _lastPanel: Panel | undefined

  // latest message per type targeted at _lastPanel's id, resent after it on "ready"
  // so a reload doesn't lose one-shot results that already fired
  private _messageBuffer = new Map<string, ExtensionToWebview>()

  private _disposables: Disposable[] = []

  // `_panel.dispose()` fires `onDidDispose`, which calls back into `dispose()`
  private _isDisposed = false

  // sends a message to the main and side panels
  public static postMessage(...messages: ExtensionToWebview[]): void {
    for (const message of messages) {
      TmcPanel.mainPanel?._postMessage(message)
      TmcPanel.sidePanel?._postMessage(message)
    }
  }

  /** Tells the two panels' log lines apart. */
  private get _webviewName(): string {
    return this._isMain ? "Main webview" : "Side webview"
  }

  /**
   * Sends `message` to this panel's webview alone, buffering it for a reload.
   *
   * Every reply to a request this webview made goes through here; {@link postMessage}
   * is for messages every open panel should see.
   */
  private _postMessage(message: ExtensionToWebview): void {
    // Only id-carrying targets are buffered. A broadcast target has no id, and the
    // delta messages that use one (setUpdateables, setNewExercises) are posted once
    // per course, so they would all collapse onto one key and only the last would
    // survive; those are restored from the extension's own state instead.
    // `panelDataResult` is left out on top of that: the reloaded webview asks again and
    // its request ids restart from the beginning, so a replayed answer could settle a
    // request it does not belong to.
    if (
      message.type !== "panelDataResult" &&
      "id" in message.target &&
      message.target.id === this._lastPanel?.id
    ) {
      this._messageBuffer.set(`${message.target.id}:${message.type}`, message)
    }
    postMessageToWebview(this._panel.webview, message, this._webviewName)
  }

  /**
   * Tells the panel that asked for `requestId` that its data has been sent.
   *
   * Goes out after the messages the panel needs to render, not before. Whatever a handler
   * still has in flight by then only refines what the panel is already showing.
   */
  private _postPanelDataSent(target: PanelDataTarget, requestId: number): void {
    this._postMessage({ type: "panelDataResult", target, requestId })
  }

  /**
   * Tells the panel that asked for `requestId` that its data is not coming.
   *
   * Every path out of a `request*Data` handler needs one of these two: a request the
   * panel never sees answered only stops on the panel's own timeout, seconds later.
   */
  private _postPanelDataFailed(target: PanelDataTarget, requestId: number, error: unknown): void {
    this._postMessage({
      type: "panelDataResult",
      target,
      requestId,
      error: toWebviewError(error),
    })
  }

  // renders the `panel` in the main panel
  public static renderMain(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: Panel,
  ): void {
    if (TmcPanel.mainPanel !== undefined) {
      Logger.info(`Revealing existing main panel for "${panel.type}"`)
      TmcPanel.mainPanel._renderPanel(panel)
      TmcPanel.mainPanel._panel.reveal(ViewColumn.One, false)
    } else {
      TmcPanel.mainPanel = TmcPanel.renderNew(
        extensionUri,
        extensionContext,
        actionContext,
        panel,
        true,
      )
    }
  }

  // renders the `panel` in the side panel
  public static renderSide(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: Panel,
  ): void {
    const column = ViewColumn.Two
    // Navigating away from an in-flight mooc login abandons it, so kill its CLI
    // process. Exempt for re-entering MoocLogin: the new `moocLogin` handler
    // interrupt-and-replaces the old attempt itself.
    if (panel.type !== "MoocLogin") {
      moocLoginRegistry.cancelAll()
    }
    if (TmcPanel.sidePanel !== undefined) {
      Logger.info(`Revealing existing side panel for "${panel.type}"`)
      TmcPanel.sidePanel._renderPanel(panel)
      TmcPanel.sidePanel._panel.reveal(column, false)
    } else {
      const currentPanel = TmcPanel.renderNew(
        extensionUri,
        extensionContext,
        actionContext,
        panel,
        false,
      )
      TmcPanel.sidePanel = currentPanel
    }
  }

  // convenience function for rendering a main/side panel when no main/side panel exists yet
  // otherwise the panel can simply be "revealed" with `panel.reveal`
  public static renderNew(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: Panel,
    isMain: boolean,
  ): TmcPanel {
    let panelViewType
    let column
    if (isMain) {
      panelViewType = "mainPanel"
      column = ViewColumn.One
    } else {
      panelViewType = "sidePanel"
      column = ViewColumn.Two
    }
    const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", column, {
      enableScripts: true,
      // otherwise a hidden-then-revealed panel reloads and drops messages posted
      // before the reveal
      retainContextWhenHidden: true,
      localResourceRoots: [Uri.joinPath(extensionUri, "webview-ui/public/build")],
    })
    const currentPanel = new TmcPanel(
      webviewPanel,
      extensionContext,
      extensionUri,
      actionContext,
      isMain,
    )
    currentPanel._renderPanel(panel)
    return currentPanel
  }

  private constructor(
    panel: WebviewPanel,
    extensionContext: vscode.ExtensionContext,
    extensionUri: Uri,
    actionContext: ActionContext,
    isMain: boolean,
  ) {
    this._panel = panel

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri)

    this._setWebviewMessageListener(this._panel.webview, extensionContext, actionContext)

    this._isMain = isMain
  }

  // disposes the side panel when disposing the main panel as well
  public dispose(): void {
    if (this._isDisposed) {
      return
    }
    this._isDisposed = true
    this._panel.dispose()

    if (this._isMain) {
      TmcPanel.mainPanel = undefined
      TmcPanel.sidePanel?.dispose()
    } else {
      TmcPanel.sidePanel = undefined
      // Interrupt any in-flight mooc login on side-panel dispose (close/reload)
      // so no orphaned CLI process keeps polling.
      moocLoginRegistry.cancelAll()
    }

    while (this._disposables.length > 0) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }

  // remembers `panel` so "ready" can resend it
  private _renderPanel(panel: Panel): void {
    this._lastPanel = panel
    this._messageBuffer.clear()
    renderPanel(panel, this._panel.webview)
  }

  private _getWebviewContent(webview: Webview, extensionUri: Uri): string {
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
                <!-- id required: vscode-icon clones this stylesheet into each icon's shadow root. -->
                <link
                    nonce="${nonce}"
                    id="vscode-codicon-stylesheet"
                    rel="stylesheet"
                    type="text/css"
                    href="${codiconCssUri}"
                />
                <script defer nonce="${nonce}" src="${scriptUri}"></script>
            </head>
            <body></body>
            </html>
      `
  }

  // receives messages from the webview
  private _setWebviewMessageListener(
    webview: Webview,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): void {
    webview.onDidReceiveMessage(
      reportingFailures(actionContext.dialog, async (untrustedMessage: unknown) => {
        const validationResult = WebviewToExtensionSchema.safeParse(untrustedMessage)
        if (!validationResult.success) {
          Logger.error(
            "Ignoring invalid message from webview:",
            z.prettifyError(validationResult.error),
          )
          return
        }
        // zod strips unknown fields, so the original message is used instead of the parse result
        const message = untrustedMessage as WebviewToExtension
        switch (message.type) {
          case "ready": {
            Logger.info(
              `Received "ready" from ${this._isMain ? "main" : "side"} webview` +
                (this._lastPanel
                  ? `, resending panel "${this._lastPanel.type}"`
                  : ", no panel to resend"),
            )
            if (this._lastPanel) {
              // Resending MoocLogin deliberately restarts the device flow: the reloaded
              // webview has lost the code it was showing, and MoocLogin's mount posts
              // `moocLogin` again, which interrupts the now-unreachable CLI process.
              // not this._renderPanel(), which would clear the buffer we're about to resend
              renderPanel(this._lastPanel, webview)
              for (const buffered of this._messageBuffer.values()) {
                postMessageToWebview(webview, buffered, this._webviewName)
              }
            }
            break
          }
          case "requestCourseDetailsData": {
            const target = panelTarget(message.sourcePanel)
            if (!isReady(actionContext)) {
              this._postPanelDataFailed(
                target,
                message.requestId,
                reportNotInitialized(actionContext.dialog),
              )
              return
            }
            const { langs, userData, workspaceManager } = actionContext.startup
            const courseResult = userData.getCourse(message.sourcePanel.courseId)
            if (courseResult.err) {
              actionContext.dialog.reportError("Failed to read the course.", courseResult.val)
              this._postPanelDataFailed(target, message.requestId, courseResult.val)
              return
            }
            const course = courseResult.val
            this._postMessage({
              type: "setCourseData",
              target,
              courseData: course,
            })
            // Deriving this here would mean re-running `checkForExerciseUpdates`, which
            // spawns several CLI processes, so it is answered from what was last posted.
            // Targeted at the requesting panel although the schema is a broadcast one --
            // `setCourseDisabledStatus` below does the same.
            this._postMessage({
              type: "setUpdateables",
              target,
              courseId: message.sourcePanel.courseId,
              exerciseIds: updateablesRegistry.get(message.sourcePanel.courseId),
            })

            this._postMessage({
              type: "setCourseDisabledStatus",
              target,
              courseId: LocalCourseData.getCourseId(course),
              disabled: course.data.disabled,
            })

            const buildView = (offlineMode: boolean): CourseDetailsView =>
              buildCourseDetailsView(
                course,
                workspaceManager.getExercises(),
                offlineMode,
                new Date(),
              )
            const view = buildView(false)
            this._postMessage({
              type: "setExerciseStatuses",
              target,
              courseId: LocalCourseData.getCourseId(course),
              statuses: view.exerciseStatuses.map(
                ({ exerciseId, status }): [ExerciseIdentifier, ExerciseStatus] => [
                  exerciseId,
                  status,
                ],
              ),
            })
            this._postMessage({
              type: "setCourseGroups",
              target,
              offlineMode: false,
              exerciseGroups: toMessageGroups(view.exerciseGroups),
            })
            this._postPanelDataSent(target, message.requestId)

            // Everything above comes from stored data, so the panel is rendered by now.
            // The backend is reached only to find out whether the deadlines just posted
            // can be trusted; the groups are re-posted without them if not. Only an
            // unreachable backend means that -- any other failure leaves the stored
            // deadlines as good as they were.
            langs
              .getCourseDetails(message.sourcePanel.courseId)
              .then((apiCourse) => {
                if (apiCourse.err && apiCourse.val instanceof ConnectionError) {
                  this._postMessage({
                    type: "setCourseGroups",
                    target,
                    offlineMode: true,
                    exerciseGroups: toMessageGroups(buildView(true).exerciseGroups),
                  })
                }
              })
              .catch((error: unknown) => {
                // The panel is already rendered, so the only loss is the deadline check;
                // leaving the stored deadlines standing is what an unknown answer means.
                Logger.error("Failed to check whether the backend is reachable", error)
              })
            break
          }
          case "requestMyCoursesData": {
            const target = panelTarget(message.sourcePanel)
            if (!isReady(actionContext)) {
              this._postPanelDataFailed(
                target,
                message.requestId,
                reportNotInitialized(actionContext.dialog),
              )
              return
            }
            const { userData, resources } = actionContext.startup
            const projectsDirectory = resources.projectsDirectory
            if (!projectsDirectory) {
              this._postPanelDataFailed(
                target,
                message.requestId,
                reportNotInitialized(actionContext.dialog),
              )
              return
            }

            this._postMessage({
              type: "setMyCourses",
              target,
              courses: userData.getCourses(),
            })
            this._postMessage({
              type: "setTmcDataPath",
              target,
              tmcDataPath: projectsDirectory,
            })
            this._postPanelDataSent(target, message.requestId)
            getFolderSize
              .loose(projectsDirectory)
              .then((size) =>
                this._postMessage({
                  type: "setTmcDataSize",
                  target,
                  tmcDataSize: formatSizeInBytes(size),
                }),
              )
              .catch((error: unknown) => {
                Logger.error("Failed to measure the exercise directory", error)
                this._postMessage({
                  type: "setTmcDataSize",
                  target,
                  tmcDataSize: "unknown",
                })
              })
            break
          }
          case "requestWelcomeData": {
            const target = panelTarget(message.sourcePanel)
            if (!isReady(actionContext)) {
              this._postPanelDataFailed(
                target,
                message.requestId,
                reportNotInitialized(actionContext.dialog),
              )
              return
            }

            this._postMessage({
              type: "setWelcomeData",
              target,
              version: actionContext.startup.resources.extensionVersion,
            })
            this._postPanelDataSent(target, message.requestId)
            break
          }
          case "openCourseDetails": {
            this._renderPanel({
              id: nextPanelId(),
              type: "CourseDetails",
              courseId: message.courseId,
              exerciseStatuses: { tmc: {}, mooc: {} },
            })
            break
          }
          case "removeCourse": {
            if (!isReady(actionContext)) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const courseResult = actionContext.startup.userData.getCourse(message.id)
            if (courseResult.err) {
              actionContext.dialog.reportError("Failed to remove the course.", courseResult.val)
              return
            }
            const course = courseResult.val
            const courseName = LocalCourseData.getCourseName(course)
            if (
              await actionContext.dialog.explicitConfirmation(
                `Do you want to remove ${LocalCourseData.getCourseName(course)} from your courses? \
                                This won't delete your downloaded exercises.`,
              )
            ) {
              await handlers().removeCourse(actionContext, message.id)
              this._renderPanel({
                id: nextPanelId(),
                type: "MyCourses",
                courseDeadlines: {},
              })
              actionContext.dialog.notification(`${courseName} was removed from courses.`)
            }
            break
          }
          case "openCourseWorkspace": {
            if (!isReady(actionContext)) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const courseResult = actionContext.startup.userData.getCourse(message.courseId)
            if (courseResult.err) {
              actionContext.dialog.reportError("Failed to read the course.", courseResult.val)
              return
            }
            handlers().openWorkspace(
              actionContext,
              LocalCourseData.getCourseName(courseResult.val),
              message.courseId.kind,
            )
            break
          }
          case "addNewCourse": {
            await vscode.commands.executeCommand("tmc.addNewCourse")
            break
          }
          case "changeTmcDataPath": {
            await vscode.commands.executeCommand("tmc.changeTmcDataPath")
            break
          }
          case "openMyCourses": {
            this._renderPanel({
              id: nextPanelId(),
              type: "MyCourses",
              courseDeadlines: {},
            })
            break
          }
          case "closeExercises": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            const result = await handlers().closeExercises(
              readyContext,
              message.ids,
              message.courseId,
            )
            if (result.err) {
              actionContext.dialog.reportError(
                "Failed to close the selected exercises.",
                result.val,
              )
            }
            break
          }
          case "clearNewExercises": {
            if (!isReady(actionContext)) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const clearResult = await actionContext.startup.userData.clearFromNewExercises(
              message.courseId,
            )
            if (clearResult.err) {
              actionContext.dialog.reportError(
                "Failed to dismiss the new exercises.",
                clearResult.val,
              )
            }
            break
          }
          case "downloadExercises": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            await handlers().downloadExercisesForUi(
              readyContext,
              message.mode,
              message.courseId,
              message.ids,
            )
            break
          }
          case "openExercises": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            await handlers().downloadAndOpenExercises(
              extensionContext,
              readyContext,
              message.ids,
              message.courseId,
            )
            break
          }
          case "refreshCourseDetails": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            const courseId = message.id
            const updateResult = await handlers().updateCourse(readyContext, courseId)
            if (updateResult.err) {
              actionContext.dialog.reportError("Failed to update course.", updateResult.val)
            }
            // `updateCourse` does not rescan, and the re-render below reads the exercise
            // statuses straight out of the workspace manager.
            const rescanResult = await handlers().refreshLocalExercises(readyContext)
            if (rescanResult.err) {
              Logger.warn("Failed to rescan the local exercises", rescanResult.val)
            }
            this._renderPanel({
              id: nextPanelId(),
              type: "CourseDetails",
              courseId,
              exerciseStatuses: { tmc: {}, mooc: {} },
            })
            break
          }
          case "closeSidePanel": {
            if (TmcPanel.sidePanel) {
              TmcPanel.sidePanel.dispose()
            }
            break
          }
          case "cancelTests": {
            handlers().cancelTests(message.testRunId)
            break
          }
          case "submitExercise": {
            // commands.submitExercise renders its own ExerciseSubmission side panel;
            // a pre-render here would just flash a second one that's immediately replaced.
            // When it fails there is no such panel, so the ExerciseTests panel still on
            // screen has to be told, or its Submit button stays disabled forever.
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              TmcPanel.postMessage({ type: "submitFailed", target: { type: "ExerciseTests" } })
              return
            }
            try {
              const result = await handlers().submitExercise(
                extensionContext,
                readyContext,
                message.exerciseUri,
              )
              if (result.err) {
                TmcPanel.postMessage({ type: "submitFailed", target: { type: "ExerciseTests" } })
              }
            } catch (error) {
              Logger.error("Unexpected error during exercise submission", error)
              TmcPanel.postMessage({ type: "submitFailed", target: { type: "ExerciseTests" } })
            }
            break
          }
          case "pasteExercise": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              // The requesting panel is waiting on a `pasteResult`/`pasteError` reply,
              // same as a genuine paste failure below -- silence would leave it waiting.
              TmcPanel.postMessage({
                type: "pasteError",
                target: message.requestingPanel,
                error: NOT_INITIALIZED_MESSAGE,
              })
              return
            }
            const pasteResult = await handlers().pasteExercise(
              readyContext,
              message.course.kind,
              LocalCourseData.getCourseName(message.course),
              LocalCourseExercise.getSlug(message.exercise),
            )
            if (pasteResult.err) {
              // No notification: the panel that asked is on screen and renders this
              // itself, so a toast on top of it would report the same failure twice.
              TmcPanel.postMessage({
                type: "pasteError",
                target: message.requestingPanel,
                error: pasteResult.val.message,
              })
            } else {
              TmcPanel.postMessage({
                type: "pasteResult",
                target: message.requestingPanel,
                pasteLink: pasteResult.val,
              })
            }
            break
          }
          case "openLinkInBrowser": {
            // Non-strict `Uri.parse` never throws and invents a `file` scheme for a string
            // without one, so a link from the webview has to be parsed strictly and its
            // scheme checked before it reaches the OS handler.
            let link
            try {
              link = vscode.Uri.parse(message.url, true)
            } catch (error) {
              Logger.error("Refusing to open an unparseable link from the webview", error)
              break
            }
            if (link.scheme !== "http" && link.scheme !== "https") {
              Logger.error(`Refusing to open a "${link.scheme}" link from the webview`, message.url)
              break
            }
            vscode.env.openExternal(link)
            break
          }
          case "moocLogin": {
            const moocLoginPanel = message.sourcePanel
            if (!isReady(actionContext)) {
              reportNotInitialized(actionContext.dialog)
              // The panel shows "starting" until it hears back.
              postMessageToWebview(webview, {
                type: "moocLoginError",
                target: moocLoginPanel,
                error: NOT_INITIALIZED_MESSAGE,
              })
              return
            }
            const { langs } = actionContext.startup
            // Set below, after `authenticateMooc` returns; the callback fires
            // asynchronously so it always sees the real id.
            let invocationId = 0
            const { result, interrupt } = langs.authenticateMooc((info) => {
              // Stay silent if this attempt was superseded or cancelled.
              if (!moocLoginRegistry.isCurrent(invocationId)) {
                return
              }
              // Unbuffered: a reload restarts the device flow, so resending this would
              // show the code of the attempt that reload abandoned.
              postMessageToWebview(webview, {
                type: "moocDeviceCode",
                target: moocLoginPanel,
                userCode: info.user_code,
                verificationUri: info.verification_uri,
                verificationUriComplete: info.verification_uri_complete,
                expiresIn: info.expires_in,
                interval: info.interval,
              })
            })
            // Interrupt-and-replaces any login already in flight, so two `mooc
            // login` processes never race on the credentials file.
            invocationId = moocLoginRegistry.start(moocLoginPanel.id, interrupt)
            // Caught here rather than by `reportingFailures`, which would leave the panel waiting.
            const loginResult = await result.catch((error: unknown) =>
              Err(error instanceof Error ? error : new Error(String(error))),
            )
            if (!moocLoginRegistry.isCurrent(invocationId)) {
              // Superseded or cancelled while polling; leave the live attempt's
              // registry entry untouched.
              break
            }
            moocLoginRegistry.finish(invocationId)
            if (loginResult.err) {
              // Unbuffered, for the reason given above the device-code post.
              postMessageToWebview(webview, {
                type: "moocLoginError",
                target: moocLoginPanel,
                error: loginResult.val.message,
              })
            } else {
              // Nothing to navigate back to, so close and confirm. Offer the step
              // the user most likely came to take rather than making them find it,
              // but as a button, so a login that was only meant to renew a session
              // is not hijacked into a course picker.
              TmcPanel.sidePanel?.dispose()
              actionContext.dialog.notification("Logged in to courses.mooc.fi.", [
                "Add new course",
                (): void => {
                  vscode.commands.executeCommand("tmc.addNewCourse")
                },
              ])
            }
            break
          }
          case "cancelMoocLogin": {
            moocLoginRegistry.cancel(message.sourcePanel.id)
            break
          }
          case "requestInitializationErrors": {
            const failures =
              actionContext.startup.kind === "degraded" ? actionContext.startup.failures : {}

            TmcPanel.postMessage({
              type: "initializationErrors",
              target: message.sourcePanel,
              cliFolder: cliFolder(extensionContext),
              initializationErrors: {
                tmc: formatError(failures.langs),
                userData: formatError(failures.userData),
                workspaceManager: formatError(failures.workspaceManager),
                resources: formatError(failures.resources),
                exerciseDecorationProvider: formatError(failures.exerciseDecorationProvider),
              },
            })
            break
          }
          default:
            assertUnreachable(message)
        }
      }),
      undefined,
      this._disposables,
    )
  }
}

/**
 * Narrows the view model's rows to the fields `ExerciseSchema` declares.
 *
 * `buildCourseDetailsView` assembles its groups out of `CourseDetailsExercise` rows,
 * which also carry the parsed `Date` deadlines it needs to sort and compare; the
 * message contract declares only their rendered strings, and a `Date` has no place
 * on the far side of a `postMessage`.
 */
function toMessageGroups(groups: ExerciseGroup[]): ExerciseGroup[] {
  return groups.map(({ name, nextDeadlineString, exercises }) => ({
    name,
    nextDeadlineString,
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      isHard: exercise.isHard,
      hardDeadlineString: exercise.hardDeadlineString,
      softDeadlineString: exercise.softDeadlineString,
      passed: exercise.passed,
    })),
  }))
}

const NOT_INITIALIZED_MESSAGE =
  "The extension did not initialize properly, so this action is unavailable."

/**
 * Answers a webview action the extension cannot serve because initialization
 * failed. The panels stay interactive in that state, so a click has to say why
 * nothing happened and point at the panel that explains the failure.
 *
 * @returns the failure, for a caller that also has a waiting panel to tell.
 */
function reportNotInitialized(dialog: Dialog): InitializationError {
  const error = new InitializationError(NOT_INITIALIZED_MESSAGE)
  dialog.errorNotification(NOT_INITIALIZED_MESSAGE, error, [
    "Show help",
    (): void => {
      vscode.commands.executeCommand("tmc.viewInitializationErrorHelp")
    },
  ])
  return error
}

/**
 * Narrows a message handler's context for the action- and command-layer calls that
 * require one, or reports why the action cannot run.
 *
 * A webview mounted before a failed (or since-degraded) activation can still post a
 * message, so this is what turns "not ready" into user-visible feedback for the
 * handlers below that would otherwise be handed a context they cannot use.
 */
function requireReady(actionContext: ActionContext): ReadyActionContext | undefined {
  if (isReady(actionContext)) {
    return actionContext
  }
  reportNotInitialized(actionContext.dialog)
  return undefined
}

/**
 * Wraps a webview message handler so a rejection is reported rather than dropped.
 *
 * The webview host discards whatever a listener rejects with, so without this a
 * handler that throws leaves the user looking at a panel that silently did nothing.
 */
function reportingFailures(
  dialog: Dialog,
  handle: (message: unknown) => Promise<void>,
): (message: unknown) => Promise<void> {
  return (message) =>
    handle(message).catch((error: unknown) => {
      Logger.error("Failed to handle a message from the webview", error)
      dialog.reportError(
        "Something went wrong while handling that action.",
        error instanceof Error ? error : new Error(String(error)),
      )
    })
}

// helper to make an exhaustive switch statement
function assertUnreachable(x: never): never {
  throw new Error(`unreachable ${x}`)
}

let panelIdCounter = 0

// identifies a panel for the lifetime of the extension host, so a buffered message can be
// matched against the panel currently rendered
export function nextPanelId(): number {
  panelIdCounter += 1
  return panelIdCounter
}

function formatError(error: Error | undefined): { error: string; stack: string } | null {
  if (!error) {
    return null
  }
  const stack = error.stack ?? "no stack trace"
  return error.cause
    ? { error: `${error.message}: ${error.cause}`, stack }
    : { error: error.message, stack }
}

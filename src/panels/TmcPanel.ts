import getFolderSize from "get-folder-size"
import type { Result } from "ts-results"
import type { Disposable, Webview, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import * as vscode from "vscode"
import { z } from "zod"

import type { ActionContext } from "../actions/types"
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
  match,
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
    actionContext: ActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<ExerciseIdentifier[], Error>>
  downloadAndOpenExercises: (
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<ExerciseIdentifier[], Error>>
  downloadExercisesForUi: (
    actionContext: ActionContext,
    mode: string,
    courseId: CourseIdentifier,
    ids: ExerciseIdentifier[],
  ) => Promise<void>
  openWorkspace: (
    actionContext: ActionContext,
    courseName: string,
    backend: BackendKind,
  ) => Promise<void>
  pasteMoocExercise: (
    actionContext: ActionContext,
    courseSlug: string,
    exerciseName: string,
  ) => Promise<Result<string, Error>>
  pasteTmcExercise: (
    actionContext: ActionContext,
    courseSlug: string,
    exerciseName: string,
  ) => Promise<Result<string, Error>>
  /** Rescans the exercises on disk, so exercises the backend dropped stop showing as open. */
  refreshLocalExercises: (actionContext: ActionContext) => Promise<Result<void, Error>>
  removeCourse: (actionContext: ActionContext, id: CourseIdentifier) => Promise<void>
  submitExercise: (
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    exerciseUri: vscode.Uri,
  ) => Promise<Result<void, Error>>
  updateCourse: (
    actionContext: ActionContext,
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
  public static async postMessage(...messages: ExtensionToWebview[]): Promise<void> {
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
  public static async renderMain(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: Panel,
  ): Promise<void> {
    if (TmcPanel.mainPanel !== undefined) {
      Logger.info(`Revealing existing main panel for "${panel.type}"`)
      await TmcPanel.mainPanel._renderPanel(panel)
      TmcPanel.mainPanel._panel.reveal(ViewColumn.One, false)
    } else {
      TmcPanel.mainPanel = await TmcPanel.renderNew(
        extensionUri,
        extensionContext,
        actionContext,
        panel,
        true,
      )
    }
  }

  // renders the `panel` in the side panel
  public static async renderSide(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: Panel,
  ): Promise<void> {
    const column = ViewColumn.Two
    // Navigating away from an in-flight mooc login abandons it, so kill its CLI
    // process. Exempt for re-entering MoocLogin: the new `moocLogin` handler
    // interrupt-and-replaces the old attempt itself.
    if (panel.type !== "MoocLogin") {
      moocLoginRegistry.cancelAll()
    }
    if (TmcPanel.sidePanel !== undefined) {
      Logger.info(`Revealing existing side panel for "${panel.type}"`)
      await TmcPanel.sidePanel._renderPanel(panel)
      TmcPanel.sidePanel._panel.reveal(column, false)
    } else {
      const currentPanel = await TmcPanel.renderNew(
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
  public static async renderNew(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: Panel,
    isMain: boolean,
  ): Promise<TmcPanel> {
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
    await currentPanel._renderPanel(panel)
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
  private async _renderPanel(panel: Panel): Promise<void> {
    this._lastPanel = panel
    this._messageBuffer.clear()
    await renderPanel(panel, this._panel.webview)
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
              await renderPanel(this._lastPanel, webview)
              for (const buffered of this._messageBuffer.values()) {
                postMessageToWebview(webview, buffered, this._webviewName)
              }
            }
            break
          }
          case "requestCourseDetailsData": {
            const { langs, userData, workspaceManager } = actionContext
            const target = panelTarget(message.sourcePanel)
            if (!(langs.ok && userData.ok && workspaceManager.ok)) {
              this._postPanelDataFailed(
                target,
                message.requestId,
                reportNotInitialized(actionContext.dialog),
              )
              return
            }
            const courseResult = userData.val.getCourse(message.sourcePanel.courseId)
            if (courseResult.err) {
              actionContext.dialog.errorNotification("Failed to read the course.", courseResult.val)
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
                workspaceManager.val.getExercises(),
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
            langs.val
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
            const { userData, workspaceManager, resources } = actionContext
            const target = panelTarget(message.sourcePanel)
            if (
              !(
                userData.ok &&
                workspaceManager.ok &&
                resources.ok &&
                resources.val.projectsDirectory
              )
            ) {
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
              courses: userData.val.getCourses(),
            })
            this._postMessage({
              type: "setTmcDataPath",
              target,
              tmcDataPath: resources.val.projectsDirectory,
            })
            this._postPanelDataSent(target, message.requestId)
            getFolderSize
              .loose(resources.val.projectsDirectory)
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
            const { resources } = actionContext
            const target = panelTarget(message.sourcePanel)
            if (!resources.ok) {
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
              version: resources.val.extensionVersion,
            })
            this._postPanelDataSent(target, message.requestId)
            break
          }
          case "openCourseDetails": {
            await this._renderPanel({
              id: randomPanelId(),
              type: "CourseDetails",
              courseId: message.courseId,
              exerciseStatuses: { tmc: {}, mooc: {} },
            })
            break
          }
          case "removeCourse": {
            const { userData } = actionContext
            if (!userData.ok) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const courseResult = userData.val.getCourse(message.id)
            if (courseResult.err) {
              actionContext.dialog.errorNotification(
                "Failed to remove the course.",
                courseResult.val,
              )
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
              await this._renderPanel({
                id: randomPanelId(),
                type: "MyCourses",
                courseDeadlines: {},
              })
              actionContext.dialog.notification(`${courseName} was removed from courses.`)
            }
            break
          }
          case "openCourseWorkspace": {
            const { userData } = actionContext
            if (!userData.ok) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const courseResult = userData.val.getCourse(message.courseId)
            if (courseResult.err) {
              actionContext.dialog.errorNotification("Failed to read the course.", courseResult.val)
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
            await this._renderPanel({
              id: randomPanelId(),
              type: "MyCourses",
              courseDeadlines: {},
            })
            break
          }
          case "closeExercises": {
            const result = await handlers().closeExercises(
              actionContext,
              message.ids,
              message.courseId,
            )
            if (result.err) {
              actionContext.dialog.errorNotification(
                "Errored while closing selected exercises.",
                result.val,
              )
            }
            break
          }
          case "clearNewExercises": {
            const { userData } = actionContext
            if (!userData.ok) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const clearResult = await userData.val.clearFromNewExercises(message.courseId)
            if (clearResult.err) {
              actionContext.dialog.errorNotification(
                "Failed to dismiss the new exercises.",
                clearResult.val,
              )
            }
            break
          }
          case "downloadExercises": {
            await handlers().downloadExercisesForUi(
              actionContext,
              message.mode,
              message.courseId,
              message.ids,
            )
            break
          }
          case "openExercises": {
            await handlers().downloadAndOpenExercises(
              extensionContext,
              actionContext,
              message.ids,
              message.courseId,
            )
            break
          }
          case "refreshCourseDetails": {
            const courseId = message.id
            const updateResult = await handlers().updateCourse(actionContext, courseId)
            if (updateResult.err) {
              actionContext.dialog.errorNotification("Failed to update course.", updateResult.val)
            }
            // `updateCourse` does not rescan, and the re-render below reads the exercise
            // statuses straight out of the workspace manager.
            const rescanResult = await handlers().refreshLocalExercises(actionContext)
            if (rescanResult.err) {
              Logger.warn("Failed to rescan the local exercises", rescanResult.val)
            }
            await this._renderPanel({
              id: randomPanelId(),
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
            try {
              const result = await handlers().submitExercise(
                extensionContext,
                actionContext,
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
            const pasteResult = await match(
              message.course,
              () =>
                handlers().pasteTmcExercise(
                  actionContext,
                  LocalCourseData.getCourseName(message.course),
                  LocalCourseExercise.getSlug(message.exercise),
                ),
              () =>
                handlers().pasteMoocExercise(
                  actionContext,
                  LocalCourseData.getCourseName(message.course),
                  LocalCourseExercise.getSlug(message.exercise),
                ),
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
            const { langs } = actionContext
            if (!langs.ok) {
              reportNotInitialized(actionContext.dialog)
              return
            }
            const moocLoginPanel = message.sourcePanel
            // Set below, after `authenticateMooc` returns; the callback fires
            // asynchronously so it always sees the real id.
            let invocationId = 0
            const { result, interrupt } = langs.val.authenticateMooc((info) => {
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
            const loginResult = await result
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
            const { exerciseDecorationProvider, resources, langs, userData, workspaceManager } =
              actionContext

            TmcPanel.postMessage({
              type: "initializationErrors",
              target: message.sourcePanel,
              cliFolder: cliFolder(extensionContext),
              initializationErrors: {
                tmc: formatError(langs),
                userData: formatError(userData),
                workspaceManager: formatError(workspaceManager),
                resources: formatError(resources),
                exerciseDecorationProvider: formatError(exerciseDecorationProvider),
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
      dialog.errorNotification(
        "Something went wrong while handling that action.",
        error instanceof Error ? error : new Error(String(error)),
      )
    })
}

// helper to make an exhaustive switch statement
function assertUnreachable(x: never): never {
  throw new Error(`unreachable ${x}`)
}

let nextPanelId = 0

// identifies a panel for the lifetime of the extension host, so a buffered message can be
// matched against the panel currently rendered
export function randomPanelId(): number {
  nextPanelId += 1
  return nextPanelId
}

function formatError(res: Result<unknown, Error>): { error: string; stack: string } | null {
  if (res.err) {
    if (res.val.cause) {
      const error = `${res.val.message}: ${res.val.cause}`
      const stack = res.val.stack ?? "no stack trace"
      return { error, stack }
    }
    const error = res.val.message
    const stack = res.val.stack ?? "no stack trace"
    return { error, stack }
  }
  return null
}

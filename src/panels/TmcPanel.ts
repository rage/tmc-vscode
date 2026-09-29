import getFolderSize from "get-folder-size"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type { Disposable, Webview, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import * as vscode from "vscode"
import { z } from "zod"

import type { OpenedExercises } from "../actions/openExercises"
import type { ActionContext, ReadyActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type Dialog from "../api/dialog"
import { shownInPanel, withOperation } from "../api/withOperation"
import { CLI_PROCESS_TIMEOUT, EXTENSION_ID, EXTENSION_VERSION } from "../config/constants"
import { ConnectionError, InitializationError } from "../errors"
import type {
  BackendKind,
  CourseDetailsPanel,
  ExerciseGroup,
  ExerciseStatus,
  ExtensionToWebview,
  LocalCourseData as LocalCourseDataType,
  MyCoursesPanel,
  Panel,
  TargetPanel,
  WebviewToExtension,
  WelcomePanel,
} from "../shared/shared"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  panelTarget,
  toWebviewError,
  WebviewToExtensionSchema,
} from "../shared/shared"
import { cliFolder, formatSizeInBytes, Logger, runSingleFlight } from "../utilities"
import { buildCourseDetailsView } from "./courseDetailsViewModel"
import type { CourseDetailsView } from "./courseDetailsViewModel"
import { exerciseStatusRegistry } from "./exerciseStatusRegistry"
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
    actionContext: ReadyActionContext,
    ids: ExerciseIdentifier[],
    courseId: CourseIdentifier,
  ) => Promise<Result<OpenedExercises, Error>>
  downloadExercisesForUi: (
    actionContext: ReadyActionContext,
    mode: "download" | "update",
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
  removeCourse: (
    actionContext: ReadyActionContext,
    id: CourseIdentifier,
  ) => Promise<Result<void, Error>>
  /** Answers a TMC submission's feedback questions; the URL must be one a result named. */
  sendSubmissionFeedback: (
    actionContext: ReadyActionContext,
    feedbackAnswerUrl: string,
    answers: readonly { questionId: number; answer: string }[],
  ) => Promise<Result<void, Error>>
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

// One CLI download per backend, then a rescan.
const DOWNLOAD_MAX_HOLD_MS = 3 * CLI_PROCESS_TIMEOUT

type PanelDataTarget = TargetPanel<MyCoursesPanel> | TargetPanel<CourseDetailsPanel>

/**
 * A panel as callers ask for it: the host fills in Welcome's `version` and `loggedIn`
 * when it renders the panel.
 */
export type PanelRequest = Exclude<Panel, WelcomePanel> | Pick<WelcomePanel, "id" | "type">

/**
 * Manages the rendering of the extension webview panels.
 */
export class TmcPanel {
  // primary panel that most data is displayed in
  public static mainPanel: TmcPanel | undefined

  // extra panel for situations where we want to render another view beside the main one
  public static sidePanel: TmcPanel | undefined

  private readonly _panel: WebviewPanel

  private readonly _actionContext: ActionContext

  // if true, this is the main panel, otherwise this is the side panel
  private readonly _isMain: boolean

  // resent on "ready" so a reloaded webview can recover. Per-instance: the main and
  // side panels show different panels.
  private _lastPanel: Panel | undefined

  // Until the first "ready", messages are only buffered: that handshake is the single
  // path that renders a panel, for a new document and a reloaded one alike.
  private _isWebviewReady = false

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
    if (!this._isWebviewReady) {
      return
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

  /**
   * Sends a CourseDetails panel everything it renders for `course`, from stored data.
   *
   * The deadlines go out as stored, then are withdrawn by a second `setCourseGroups` if the
   * backend turns out to be unreachable; nothing here waits on the backend.
   */
  private _postCourseDetails(
    target: TargetPanel<CourseDetailsPanel>,
    course: LocalCourseDataType,
    actionContext: ReadyActionContext,
  ): void {
    const courseId = LocalCourseData.getCourseId(course)
    this._postMessage({ type: "setCourseData", target, courseData: course })
    // Deriving this here would mean re-running `checkForExerciseUpdates`, which
    // spawns several CLI processes, so it is answered from what was last posted.
    // Targeted at the requesting panel although the schema is a broadcast one --
    // `setCourseDisabledStatus` below does the same.
    this._postMessage({
      type: "setUpdateables",
      target,
      courseId,
      exerciseIds: updateablesRegistry.get(courseId),
    })
    this._postMessage({
      type: "setCourseDisabledStatus",
      target,
      courseId,
      disabled: course.data.disabled,
    })
    const view = courseDetailsView(course, actionContext, false)
    this._postMessage({
      type: "setExerciseStatuses",
      target,
      courseId,
      statuses: withInFlightStatuses(view.exerciseStatuses, exerciseStatusRegistry.get(courseId)),
    })
    this._postMessage({
      type: "setCourseGroups",
      target,
      offlineMode: false,
      exerciseGroups: toMessageGroups(view.exerciseGroups),
    })

    // Only an unreachable backend makes the stored deadlines untrustworthy; any other
    // failure leaves them as good as they were.
    actionContext.startup.langs
      .getCourseDetails(courseId)
      .then((apiCourse) => {
        if (apiCourse.err && apiCourse.val instanceof ConnectionError) {
          this._postMessage({
            type: "setCourseGroups",
            target,
            offlineMode: true,
            exerciseGroups: toMessageGroups(
              courseDetailsView(course, actionContext, true).exerciseGroups,
            ),
          })
        }
      })
      .catch((error: unknown) => {
        // The panel is already rendered, so the only loss is the deadline check;
        // leaving the stored deadlines standing is what an unknown answer means.
        Logger.error("Failed to check whether the backend is reachable", error)
      })
  }

  /** The panel this webview shows, if it is `courseId`'s CourseDetails. */
  private _courseDetailsShowing(
    courseId: CourseIdentifier,
  ): TargetPanel<CourseDetailsPanel> | undefined {
    const panel = this._lastPanel
    return panel?.type === "CourseDetails" && isSameCourse(panel.courseId, courseId)
      ? panelTarget(panel)
      : undefined
  }

  // renders the `panel` in the main panel
  public static renderMain(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    panel: PanelRequest,
  ): void {
    if (TmcPanel.mainPanel !== undefined) {
      Logger.info(`Revealing existing main panel for "${panel.type}"`)
      TmcPanel.mainPanel._renderPanel(panel)
      TmcPanel.mainPanel._panel.reveal(undefined, false)
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
    panel: PanelRequest,
  ): void {
    // Navigating away from an in-flight mooc login abandons it, so kill its CLI
    // process. Exempt for re-entering MoocLogin: the new `moocLogin` handler
    // interrupt-and-replaces the old attempt itself.
    if (panel.type !== "MoocLogin") {
      moocLoginRegistry.cancelAll()
    }
    if (TmcPanel.sidePanel !== undefined) {
      Logger.info(`Revealing existing side panel for "${panel.type}"`)
      TmcPanel.sidePanel._renderPanel(panel)
      TmcPanel.sidePanel._panel.reveal(undefined, !takesFocus(panel))
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
    panel: PanelRequest,
    isMain: boolean,
  ): TmcPanel {
    const showOptions = isMain
      ? { viewColumn: ViewColumn.One, preserveFocus: false }
      : { viewColumn: ViewColumn.Beside, preserveFocus: !takesFocus(panel) }
    const panelViewType = isMain ? "mainPanel" : "sidePanel"
    const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", showOptions, {
      enableScripts: true,
      enableFindWidget: true,
      // A reload would restart MoocLogin's device flow and lose UI-only state (selection,
      // scroll, open parts) that no host registry holds.
      retainContextWhenHidden: true,
      localResourceRoots: [Uri.joinPath(extensionUri, "webview-ui/public/build")],
    })
    webviewPanel.iconPath = {
      light: Uri.joinPath(extensionUri, "media", "TMC-light.svg"),
      dark: Uri.joinPath(extensionUri, "media", "TMC.svg"),
    }
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
    this._actionContext = actionContext

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri)

    this._setWebviewMessageListener(this._panel.webview, extensionContext, actionContext)

    this._isMain = isMain
  }

  public dispose(): void {
    if (this._isDisposed) {
      return
    }
    this._isDisposed = true
    this._panel.dispose()

    if (this._isMain) {
      TmcPanel.mainPanel = undefined
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

  // remembers `panel` so "ready" can (re)send it
  private _renderPanel(request: PanelRequest): void {
    const panel = completePanel(request, this._actionContext)
    this._lastPanel = panel
    this._messageBuffer.clear()
    this._panel.title = panelTitle(panel, this._actionContext)
    if (this._isWebviewReady) {
      renderPanel(panel, this._panel.webview)
    }
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
            this._isWebviewReady = true
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
            // The panel shows why inline, so a toast here would report it twice.
            if (!isReady(actionContext)) {
              this._postPanelDataFailed(target, message.requestId, notInitialized())
              return
            }
            const courseResult = actionContext.startup.userData.getCourse(
              message.sourcePanel.courseId,
            )
            if (courseResult.err) {
              Logger.error("Failed to read the course.", courseResult.val)
              this._postPanelDataFailed(target, message.requestId, courseResult.val)
              return
            }
            this._postCourseDetails(target, courseResult.val, actionContext)
            this._postPanelDataSent(target, message.requestId)
            break
          }
          case "requestMyCoursesData": {
            const target = panelTarget(message.sourcePanel)
            if (!isReady(actionContext)) {
              this._postPanelDataFailed(target, message.requestId, notInitialized())
              return
            }
            const { userData, resources } = actionContext.startup
            const projectsDirectory = resources.projectsDirectory
            if (!projectsDirectory) {
              const error = new Error("tmc-langs did not report an exercise directory")
              Logger.error("Showing your courses is unavailable.", error)
              this._postPanelDataFailed(target, message.requestId, error)
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
              const removeResult = await withOperation(
                actionContext.dialog,
                { failure: "Failed to remove the course.", backend: message.id.kind },
                () => handlers().removeCourse(actionContext, message.id),
              )
              if (removeResult.ok) {
                this._renderPanel({
                  id: nextPanelId(),
                  type: "MyCourses",
                })
                actionContext.dialog.notification(`${courseName} was removed from courses.`)
              }
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
            await handlers().openWorkspace(
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
            })
            break
          }
          case "closeExercises": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            await withOperation(
              actionContext.dialog,
              {
                failure: "Failed to close the selected exercises.",
                backend: message.courseId.kind,
              },
              () => handlers().closeExercises(readyContext, message.ids, message.courseId),
            )
            break
          }
          case "clearNewExercises": {
            if (!isReady(actionContext)) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const { userData } = actionContext.startup
            await withOperation(
              actionContext.dialog,
              { failure: "Failed to dismiss the new exercises.", backend: message.courseId.kind },
              () => userData.clearFromNewExercises(message.courseId),
            )
            break
          }
          case "downloadExercises": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            await withOperation(
              actionContext.dialog,
              { failure: "Failed to download the exercises.", backend: message.courseId.kind },
              () =>
                // A panel re-opened mid-download re-enables its buttons until the
                // statuses arrive, so a second click must not start a second download.
                runSingleFlight(
                  {
                    key: `download:${message.courseId.kind}:${CourseIdentifier.toString(message.courseId)}`,
                    maxHoldMs: DOWNLOAD_MAX_HOLD_MS,
                    busyMessage: "This course's exercises are already downloading.",
                  },
                  async () => {
                    await handlers().downloadExercisesForUi(
                      readyContext,
                      message.mode,
                      message.courseId,
                      message.ids,
                    )
                    return Ok.EMPTY
                  },
                ),
            )
            break
          }
          case "openExercises": {
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              return
            }
            const openResult = await withOperation(
              actionContext.dialog,
              {
                failure: "Failed to open the selected exercises.",
                backend: message.courseId.kind,
              },
              () =>
                handlers().downloadAndOpenExercises(readyContext, message.ids, message.courseId),
            )
            const openLimit = openResult.ok ? openResult.val.exceededOpenLimit : undefined
            if (openLimit !== undefined) {
              const courseId = message.courseId
              void actionContext.dialog.warningNotification(
                `You have over ${openLimit} exercises open, which can slow VS Code down. Close the ones you have finished in Course Details.`,
                [
                  "Open course details",
                  (): void =>
                    TmcPanel.renderMain(
                      extensionContext.extensionUri,
                      extensionContext,
                      actionContext,
                      {
                        id: nextPanelId(),
                        type: "CourseDetails",
                        courseId,
                        exerciseStatuses: { tmc: {}, mooc: {} },
                      },
                    ),
                ],
              )
            }
            break
          }
          case "refreshCourseDetails": {
            const courseId = message.id
            // The panel waits on `refreshFinished`, so every way out of here sends one.
            let failure: unknown
            try {
              if (!isReady(actionContext)) {
                failure = notInitialized()
                return
              }
              const updateResult = await withOperation(
                actionContext.dialog,
                { failure: "Failed to update course.", backend: courseId.kind },
                async () => {
                  const updated = await handlers().updateCourse(actionContext, courseId)
                  return updated.err ? shownInPanel(updated.val) : updated
                },
              )
              if (updateResult.err) {
                failure = updateResult.val
              }
              // `updateCourse` does not rescan, and the statuses pushed below are read
              // straight out of the workspace manager.
              const rescanResult = await handlers().refreshLocalExercises(actionContext)
              if (rescanResult.err) {
                Logger.warn("Failed to rescan the local exercises", rescanResult.val)
              }
              // Pushed to the panel in place: re-rendering it would reset the student's
              // selection, and would drag them back here if they had navigated away.
              const target = this._courseDetailsShowing(courseId)
              const course = actionContext.startup.userData.getCourse(courseId)
              if (course.err) {
                failure = course.val
              } else if (target) {
                this._postCourseDetails(target, course.val, actionContext)
              }
            } catch (error) {
              failure = error
              throw error
            } finally {
              const target = this._courseDetailsShowing(courseId)
              if (target) {
                this._postMessage({
                  type: "refreshFinished",
                  target,
                  ok: failure === undefined,
                  ...(failure === undefined ? {} : { error: toWebviewError(failure) }),
                })
              }
            }
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
            const submitFailed: ExtensionToWebview = {
              type: "submitFailed",
              target: message.sourcePanel,
            }
            const readyContext = requireReady(actionContext)
            if (!readyContext) {
              this._postMessage(submitFailed)
              return
            }
            const shown = this._lastPanel
            if (shown?.type !== "ExerciseTests" || shown.id !== message.sourcePanel.id) {
              Logger.warn("Ignoring a submit from a test results panel that is no longer shown")
              this._postMessage(submitFailed)
              return
            }
            // The command reports its own failure; a throw is left to `reportingFailures`.
            let submitted = false
            try {
              const result = await handlers().submitExercise(
                extensionContext,
                readyContext,
                shown.exerciseUri,
              )
              submitted = result.ok
            } finally {
              if (!submitted) {
                this._postMessage(submitFailed)
              }
            }
            break
          }
          case "pasteExercise": {
            if (!isReady(actionContext)) {
              // The requesting panel is waiting on a `pasteResult`/`pasteError` reply,
              // same as a genuine paste failure below -- silence would leave it waiting.
              TmcPanel.postMessage({
                type: "pasteError",
                target: message.requestingPanel,
                error: notInitialized().message,
              })
              return
            }
            // Silent: the panel that asked is on screen and renders the failure itself.
            const pasteResult = await withOperation(
              actionContext.dialog,
              {
                failure: "Failed to paste the exercise.",
                backend: message.course.kind,
                silent: true,
              },
              () =>
                handlers().pasteExercise(
                  actionContext,
                  message.course.kind,
                  LocalCourseData.getCourseName(message.course),
                  LocalCourseExercise.getSlug(message.exercise),
                ),
            )
            if (pasteResult.err) {
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
            const link = parseWebLink(message.url)
            if (link) {
              vscode.env.openExternal(link)
            }
            break
          }
          case "sendFeedback": {
            const target = message.sourcePanel
            if (!isReady(actionContext)) {
              this._postMessage({
                type: "feedbackSent",
                target,
                ok: false,
                error: notInitialized().message,
              })
              return
            }
            const sent = await handlers().sendSubmissionFeedback(
              actionContext,
              message.feedbackAnswerUrl,
              message.answers,
            )
            if (sent.err) {
              Logger.error("Failed to send the submission feedback", sent.val)
            }
            this._postMessage({
              type: "feedbackSent",
              target,
              ok: sent.ok,
              ...(sent.err ? { error: sent.val.message } : {}),
            })
            break
          }
          case "copyToClipboard": {
            let isCopied = true
            try {
              await vscode.env.clipboard.writeText(message.text)
            } catch (error) {
              Logger.error("Failed to copy to the clipboard", error)
              isCopied = false
            }
            const shown = this._lastPanel
            if (shown?.type === "ExerciseTests" || shown?.type === "ExerciseSubmission") {
              this._postMessage({
                type: "clipboardCopied",
                target: panelTarget(shown),
                ok: isCopied,
              })
            }
            break
          }
          case "webviewError": {
            Logger.error(`${this._webviewName} error: ${message.message}`, message.stack ?? "")
            break
          }
          case "runCommand": {
            await vscode.commands.executeCommand(
              message.command,
              ...runCommandArguments(message.command),
            )
            break
          }
          case "moocLogin": {
            const moocLoginPanel = message.sourcePanel
            if (!isReady(actionContext)) {
              // The panel shows "starting" until it hears back.
              postMessageToWebview(webview, {
                type: "moocLoginError",
                target: moocLoginPanel,
                error: notInitialized().message,
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

/** Fills in what the host knows about a panel at render time. */
function completePanel(request: PanelRequest, actionContext: ActionContext): Panel {
  return request.type === "Welcome"
    ? { ...request, version: EXTENSION_VERSION, loggedIn: actionContext.authState.loggedIn }
    : request
}

/** The editor tab label for `panel`, so tabs can be told apart in Open Editors and Ctrl+Tab. */
function panelTitle(panel: Panel, actionContext: ActionContext): string {
  switch (panel.type) {
    case "App":
      return "TestMyCode"
    case "Welcome":
      return "Welcome"
    case "MyCourses":
      return "My Courses"
    case "CourseDetails": {
      const course = isReady(actionContext)
        ? actionContext.startup.userData.getCourse(panel.courseId)
        : undefined
      return course?.ok ? LocalCourseData.getCourseTitle(course.val) : "Course Details"
    }
    case "ExerciseTests":
      return `Tests: ${LocalCourseExercise.getSlug(panel.exercise)}`
    case "ExerciseSubmission":
      return `Submission: ${LocalCourseExercise.getSlug(panel.exercise)}`
    case "MoocLogin":
      return "Log In"
    case "InitializationErrorHelp":
      return "TestMyCode Help"
    default:
      return assertUnreachable(panel)
  }
}

/**
 * Whether showing `panel` in the side panel should move keyboard focus into it.
 *
 * Only a side panel the user asked for takes focus; test and submission results appear
 * while the student is typing, and a re-run must not pull their keystrokes away.
 */
function takesFocus(panel: PanelRequest): boolean {
  return panel.type === "MoocLogin"
}

/**
 * The on-disk statuses with the downloads still running, or failed, laid over them.
 *
 * A failure is shown only while the exercise is still absent from disk: one downloaded
 * since, by any route, is no longer failed.
 */
function withInFlightStatuses(
  onDisk: CourseDetailsView["exerciseStatuses"],
  inFlight: [ExerciseIdentifier, ExerciseStatus][],
): [ExerciseIdentifier, ExerciseStatus][] {
  const inFlightById = new Map(inFlight.map(([id, status]) => [exerciseKey(id), status]))
  return onDisk.map(({ exerciseId, status }): [ExerciseIdentifier, ExerciseStatus] => {
    const override = inFlightById.get(exerciseKey(exerciseId))
    const isOnDisk = status === "opened" || status === "closed"
    const shown =
      override === "downloading" || (override === "downloadFailed" && !isOnDisk) ? override : status
    return [exerciseId, shown]
  })
}

function exerciseKey(id: ExerciseIdentifier): string {
  return `${id.kind}:${ExerciseIdentifier.toString(id)}`
}

function isSameCourse(a: CourseIdentifier, b: CourseIdentifier): boolean {
  return a.kind === b.kind && CourseIdentifier.toString(a) === CourseIdentifier.toString(b)
}

function courseDetailsView(
  course: LocalCourseDataType,
  actionContext: ReadyActionContext,
  offlineMode: boolean,
): CourseDetailsView {
  return buildCourseDetailsView(
    course,
    actionContext.startup.workspaceManager.getExercises(),
    offlineMode,
    new Date(),
  )
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
  return groups.map(({ name, nextDeadlineString, defaultOpen, exercises }) => ({
    name,
    nextDeadlineString,
    defaultOpen,
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      isHard: exercise.isHard,
      hardDeadlineString: exercise.hardDeadlineString,
      softDeadlineString: exercise.softDeadlineString,
      deadlineIso: exercise.deadlineIso,
      passed: exercise.passed,
    })),
  }))
}

/**
 * Resolves a link the webview supplied, or `undefined` for anything but http(s).
 *
 * Non-strict `Uri.parse` never throws and invents a `file` scheme for a string without
 * one, so the link is parsed strictly and its scheme checked before the OS handler sees it.
 */
function parseWebLink(url: string): vscode.Uri | undefined {
  let link
  try {
    link = vscode.Uri.parse(url, true)
  } catch (error) {
    Logger.error("Refusing an unparseable link from the webview", error)
    return undefined
  }
  if (link.scheme !== "http" && link.scheme !== "https") {
    Logger.error(`Refusing a "${link.scheme}" link from the webview`, url)
    return undefined
  }
  return link
}

type RunnableCommand = Extract<WebviewToExtension, { type: "runCommand" }>["command"]

/** The arguments the host supplies for a command the webview may run. */
function runCommandArguments(command: RunnableCommand): unknown[] {
  switch (command) {
    case "workbench.action.openSettings":
      return ["testMyCode.logLevel"]
    case "workbench.action.openIssueReporter":
      return [{ extensionId: EXTENSION_ID }]
    case "tmc.logs":
    case "workbench.action.restartExtensionHost":
      return []
    default:
      return assertUnreachable(command)
  }
}

/**
 * The failure a panel waiting on this action is told about when initialization failed.
 * Logged rather than notified: the panel shows it.
 */
function notInitialized(): InitializationError {
  const error = new InitializationError("The extension did not initialize properly")
  Logger.error("This action is unavailable.", error)
  return error
}

/**
 * Answers a webview action the extension cannot serve because initialization
 * failed. The panels stay interactive in that state, so a click has to say why
 * nothing happened.
 *
 * @returns the failure, for a caller that also has a waiting panel to tell.
 */
function reportNotInitialized(dialog: Dialog): InitializationError {
  const error = new InitializationError("The extension did not initialize properly")
  void dialog.reportError("This action is unavailable.", error)
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

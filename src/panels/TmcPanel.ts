import getFolderSize from "get-folder-size"
import type { Result } from "ts-results"
import type { Disposable, Webview, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import * as vscode from "vscode"
import { z } from "zod"

import {
  closeExercises,
  downloadAndOpenExercises,
  downloadExercisesForUi,
  openWorkspace,
  pasteMoocExercise,
  pasteTmcExercise,
  removeCourse,
  testInterrupts,
  updateCourse,
} from "../actions"
import type { ActionContext } from "../actions/types"
import type Dialog from "../api/dialog"
import { ExerciseStatus } from "../api/workspaceManager"
import * as commands from "../commands"
import { InitializationError } from "../errors"
import type { ExerciseGroup, ExtensionToWebview, Panel, WebviewToExtension } from "../shared/shared"
import {
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  match,
  WebviewToExtensionSchema,
} from "../shared/shared"
import type * as UITypes from "../ui/types"
import {
  cliFolder,
  dateToString,
  formatSizeInBytes,
  Logger,
  parseDate,
  parseNextDeadlineAfter,
} from "../utilities"
import { getNonce } from "../utilities/getNonce"
import { getUri } from "../utilities/getUri"
import { postMessageToWebview, renderPanel } from "../utilities/panel"
import { moocLoginRegistry } from "./moocLoginRegistry"
import { updateablesRegistry } from "./updateablesRegistry"

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
      TmcPanel.mainPanel?._postMessage(message, "Main webview")
      TmcPanel.sidePanel?._postMessage(message, "Side webview")
    }
  }

  private _postMessage(message: ExtensionToWebview, context: string): void {
    // Only id-carrying targets are buffered. A broadcast target has no id, and the
    // delta messages that use one (setUpdateables, setNewExercises) are posted once
    // per course, so they would all collapse onto one key and only the last would
    // survive; those are restored from the extension's own state instead.
    if ("id" in message.target && message.target.id === this._lastPanel?.id) {
      this._messageBuffer.set(`${message.target.id}:${message.type}`, message)
    }
    postMessageToWebview(this._panel.webview, message, context)
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
      localResourceRoots: [
        Uri.joinPath(extensionUri, "out"),
        Uri.joinPath(extensionUri, "webview-ui/public/build"),
        Uri.joinPath(extensionUri, "media"),
        Uri.joinPath(extensionUri, "resources"),
      ],
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
                        img-src ${webview.cspSource} https:;
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
                <script defer nonce="${nonce}" src="${scriptUri}" />
            </head>
                <body>
                </body>
            </html>

            <style>
                body {
                    /* ensures no layout shift during loading */
                    scrollbar-gutter: stable;
                }
            </style>
      `
  }

  // receives messages from the webview
  private _setWebviewMessageListener(
    webview: Webview,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): void {
    webview.onDidReceiveMessage(
      async (untrustedMessage: unknown) => {
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
              const context = this._isMain ? "Main webview" : "Side webview"
              for (const buffered of this._messageBuffer.values()) {
                postMessageToWebview(webview, buffered, context)
              }
            }
            break
          }
          case "requestCourseDetailsData": {
            const { langs, userData, workspaceManager } = actionContext
            if (!(langs.ok && userData.ok && workspaceManager.ok)) {
              reportNotInitialized(actionContext.dialog)
              return
            }
            const courseResult = userData.val.getCourse(message.sourcePanel.courseId)
            if (courseResult.err) {
              actionContext.dialog.errorNotification("Failed to read the course.", courseResult.val)
              return
            }
            const course = courseResult.val
            postMessageToWebview(webview, {
              type: "setCourseData",
              target: message.sourcePanel,
              courseData: course,
            })
            // Deriving this here would mean re-running `checkForExerciseUpdates`, which
            // spawns several CLI processes, so it is answered from what was last posted.
            // Targeted at the requesting panel although the schema is a broadcast one --
            // `setCourseDisabledStatus` below does the same.
            postMessageToWebview(webview, {
              type: "setUpdateables",
              target: message.sourcePanel,
              courseId: message.sourcePanel.courseId,
              exerciseIds: updateablesRegistry.get(message.sourcePanel.courseId),
            })

            langs.val.getCourseDetails(message.sourcePanel.courseId).then((apiCourse) => {
              const offlineMode = apiCourse.err // failed to get course details = offline mode

              const currentDate = new Date()
              postMessageToWebview(webview, {
                type: "setCourseDisabledStatus",
                target: message.sourcePanel,
                courseId: LocalCourseData.getCourseId(course),
                disabled: course.data.disabled,
              })

              const exerciseGroupData = new Map<string, UITypes.CourseDetailsExerciseGroup>()
              LocalCourseData.getExercises(course).forEach((ex) => {
                const nameMatch = LocalCourseExercise.getSlug(ex).match(/(\w+)-(.+)/)
                const groupName = nameMatch?.[1] || ""
                const group = exerciseGroupData.get(groupName)
                const name = nameMatch?.[2] || ""
                // the workspace manager only tracks on-disk exercises, so an undownloaded
                // exercise is expected to be missing here rather than an error
                const exData = workspaceManager.val.getExerciseBySlug(
                  course.kind,
                  LocalCourseData.getCourseName(course),
                  LocalCourseExercise.getSlug(ex),
                )
                if (!exData) {
                  Logger.debug(
                    `Exercise ${LocalCourseExercise.getSlug(ex)} has not been downloaded yet`,
                  )
                }

                const softDeadline = ex.data.softDeadline ? parseDate(ex.data.softDeadline) : null
                const hardDeadline = ex.data.deadline ? parseDate(ex.data.deadline) : null

                const exerciseId = LocalCourseExercise.getId(ex)
                postMessageToWebview(webview, {
                  type: "exerciseStatusChange",
                  target: message.sourcePanel,
                  courseId: LocalCourseData.getCourseId(course),
                  exerciseId,
                  status: mapStatus(
                    exData?.status ?? ExerciseStatus.Missing,
                    hardDeadline !== null && currentDate >= hardDeadline,
                  ),
                })
                const entry: UITypes.CourseDetailsExercise = {
                  id: exerciseId,
                  name,
                  passed:
                    LocalCourseData.getExercises(course).find(
                      (ce) =>
                        ExerciseIdentifier.toString(LocalCourseExercise.getId(ce)) ===
                        ExerciseIdentifier.toString(exerciseId),
                    )?.data.passed || false,
                  softDeadline,
                  softDeadlineString: softDeadline ? dateToString(softDeadline) : "-",
                  hardDeadline,
                  hardDeadlineString: hardDeadline ? dateToString(hardDeadline) : "-",
                  isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
                }
                exerciseGroupData.set(groupName, {
                  name: groupName,
                  nextDeadlineString: "",
                  exercises: group?.exercises.concat(entry) || [entry],
                })
              })
              const exerciseGroups: ExerciseGroup[] = Array.from(exerciseGroupData.values())
                .toSorted((a, b) => (a.name > b.name ? 1 : -1))
                .map((e) => {
                  return {
                    name: e.name,
                    exercises: e.exercises.toSorted((a, b) => (a.name > b.name ? 1 : -1)),
                    nextDeadlineString: offlineMode
                      ? "Next deadline: Not available"
                      : parseNextDeadlineAfter(
                          currentDate,
                          e.exercises.map((ex) => ({
                            date: ex.isHard ? ex.hardDeadline : ex.softDeadline,
                            active: !ex.passed,
                          })),
                        ),
                  }
                })
              postMessageToWebview(webview, {
                type: "setCourseGroups",
                target: message.sourcePanel,
                offlineMode,
                exerciseGroups,
              })
            })
            break
          }
          case "requestExerciseSubmissionData": {
            break
          }
          case "requestExerciseTestsData": {
            break
          }
          case "requestMyCoursesData": {
            const { userData, workspaceManager, resources } = actionContext
            if (
              !(
                userData.ok &&
                workspaceManager.ok &&
                resources.ok &&
                resources.val.projectsDirectory
              )
            ) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            postMessageToWebview(webview, {
              type: "setMyCourses",
              target: message.sourcePanel,
              courses: userData.val.getCourses(),
            })
            postMessageToWebview(webview, {
              type: "setTmcDataPath",
              target: message.sourcePanel,
              tmcDataPath: resources.val.projectsDirectory,
            })
            getFolderSize.loose(resources.val.projectsDirectory).then((size) =>
              postMessageToWebview(webview, {
                type: "setTmcDataSize",
                target: message.sourcePanel,
                tmcDataSize: formatSizeInBytes(size),
              }),
            )
            break
          }
          case "requestWelcomeData": {
            const { resources } = actionContext
            if (!resources.ok) {
              reportNotInitialized(actionContext.dialog)
              return
            }

            const version = resources.val.extensionVersion
            postMessageToWebview(webview, {
              type: "setWelcomeData",
              target: message.sourcePanel,
              version,
            })
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
              await removeCourse(actionContext, message.id)
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
            openWorkspace(actionContext, message.courseName, message.backend)
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
            const result = await closeExercises(actionContext, message.ids, message.courseId)
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
            await downloadExercisesForUi(actionContext, message.mode, message.courseId, message.ids)
            break
          }
          case "openExercises": {
            await downloadAndOpenExercises(
              extensionContext,
              actionContext,
              message.ids,
              message.courseId,
            )
            break
          }
          case "refreshCourseDetails": {
            const courseId = message.id
            const updateResult = await updateCourse(actionContext, courseId)
            if (updateResult.err) {
              actionContext.dialog.errorNotification("Failed to update course.", updateResult.val)
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
            const interrupts = testInterrupts.get(message.testRunId)
            if (interrupts) {
              for (const interrupt of interrupts) {
                interrupt()
                testInterrupts.delete(message.testRunId)
              }
            }
            break
          }
          case "submitExercise": {
            // commands.submitExercise renders its own ExerciseSubmission side panel;
            // a pre-render here would just flash a second one that's immediately replaced.
            // When it fails there is no such panel, so the ExerciseTests panel still on
            // screen has to be told, or its Submit button stays disabled forever.
            try {
              const result = await commands.submitExercise(
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
                pasteTmcExercise(
                  actionContext,
                  LocalCourseData.getCourseName(message.course),
                  LocalCourseExercise.getSlug(message.exercise),
                ),
              () =>
                pasteMoocExercise(
                  actionContext,
                  LocalCourseData.getCourseName(message.course),
                  LocalCourseExercise.getSlug(message.exercise),
                ),
            )
            if (pasteResult.err) {
              const pasteService = match(
                message.course,
                () => "TMC Paste",
                () => "the courses.mooc.fi paste service",
              )
              actionContext.dialog.errorNotification(
                `Failed to send to ${pasteService}.`,
                pasteResult.val,
              )
              TmcPanel.postMessage({
                type: "pasteError",
                target: message.requestingPanel,
                error: pasteResult.val.message,
              })
            } else {
              const value = pasteResult.val || "Link not provided by server."
              TmcPanel.postMessage({
                type: "pasteResult",
                target: message.requestingPanel,
                pasteLink: value,
              })
            }
            break
          }
          case "openLinkInBrowser": {
            vscode.env.openExternal(vscode.Uri.parse(message.url))
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
      },
      undefined,
      this._disposables,
    )
  }
}

/**
 * Answers a webview action the extension cannot serve because initialization
 * failed. The panels stay interactive in that state, so a click has to say why
 * nothing happened and point at the panel that explains the failure.
 */
function reportNotInitialized(dialog: Dialog): void {
  dialog.errorNotification(
    "The extension did not initialize properly, so this action is unavailable.",
    new InitializationError("Extension was not initialized properly"),
    [
      "Show help",
      (): void => {
        vscode.commands.executeCommand("tmc.viewInitializationErrorHelp")
      },
    ],
  )
}

// helper to make an exhaustive switch statement
function assertUnreachable(x: never): never {
  throw new Error(`unreachable ${x}`)
}

// helper to generate a random ids when creating panels
function mapStatus(status: ExerciseStatus, expired: boolean): UITypes.ExerciseStatus {
  switch (status) {
    case ExerciseStatus.Closed:
      return "closed"
    case ExerciseStatus.Open:
      return "opened"
    default:
      return expired ? "expired" : "new"
  }
}

export function randomPanelId(): number {
  return Math.floor(Math.random() * 100_000_000)
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

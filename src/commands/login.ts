import * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { LoginOptions } from "../ui/loginScreens"
import { loginFailureView, loginScreens } from "../ui/loginScreens"
import { Logger, openWebLink, redactUrlQuery } from "../utilities"
import { showNextWalkthroughStep, walkthroughProgressOf } from "../window/walkthrough"
import { handOverExercises } from "./handOverExercises"
import { refreshEverything } from "./refreshEverything"

/** How a login ended. `cancelled` also covers a newer login replacing this one. */
export type LoginOutcome = "loggedIn" | "cancelled" | "failed"

let cancelCurrentLogin: (() => void) | undefined

/**
 * Logs in to courses.mooc.fi with the device flow, in the user's own browser so their
 * existing browser session is reused.
 *
 * The login screen shows the code and opens the verification page on request. Closing the
 * screen cancels the login; showing another screen in its place leaves it waiting for the
 * approval, with a status bar message. Starting a login cancels any already in flight, so two
 * `mooc login` processes never race on the credentials file. A failure stays on the screen, with
 * Try again. A user with no courses goes on to the add-course screen, as does `isAddingCourse`.
 */
export async function login(
  actionContext: ReadyActionContext,
  { isAddingCourse = false }: LoginOptions = {},
): Promise<LoginOutcome> {
  const { dialog } = actionContext

  cancelCurrentLogin?.()
  const panel = loginScreens.open({ isAddingCourse }, { phase: "requestingCode" })
  const { deviceCode, result, interrupt } = actions.startMoocLogin(actionContext)

  // Once set, a code the CLI still reports belongs to a login no screen shows.
  let isEnded = false
  let verificationPage: string | undefined
  const cancellation = Promise.withResolvers<"cancelled">()
  let waitingMessage: vscode.Disposable | undefined
  const cancel = (): void => {
    isEnded = true
    interrupt()
    cancellation.resolve("cancelled")
  }
  cancelCurrentLogin = cancel
  const subscriptions = vscode.Disposable.from(
    loginScreens.onDidLeave(({ panelId, isClosed }) => {
      if (panelId !== panel.id) {
        return
      }
      if (isClosed) {
        cancel()
      } else {
        waitingMessage ??= vscode.window.setStatusBarMessage(
          "$(loading~spin) TestMyCode: waiting for the login to be approved in the browser",
        )
      }
    }),
    loginScreens.onDidRequestAction(({ panelId, action }) => {
      if (panelId !== panel.id) {
        return
      }
      if (action === "cancel") {
        cancel()
        loginScreens.close(panel)
      } else if (action === "openVerificationPage" && verificationPage) {
        void openInBrowser(verificationPage)
      }
    }),
  )
  void deviceCode.then((info) => {
    if (isEnded) {
      return
    }
    verificationPage = info.verification_uri_complete ?? info.verification_uri
    loginScreens.update(panel, {
      phase: "waiting",
      userCode: info.user_code,
      verificationUrl: info.verification_uri,
      expiresAt: new Date(Date.now() + info.expires_in * 1000).toISOString(),
    })
  })

  const settled = await Promise.race([result, cancellation.promise])
  isEnded = true
  subscriptions.dispose()
  waitingMessage?.dispose()
  if (cancelCurrentLogin === cancel) {
    cancelCurrentLogin = undefined
  }
  if (settled === "cancelled") {
    return "cancelled"
  }
  if (settled.err) {
    const failed = loginFailureView(settled.val)
    if (failed.error.actions) {
      Logger.error("Logging in failed", settled.val)
    }
    loginScreens.update(panel, failed)
    return "failed"
  }

  loginScreens.update(panel, { phase: "loggedIn" })
  dialog.statusMessage("Logged in.")
  void handOverExercises(actionContext).catch((e) =>
    Logger.error("Checking whose the exercises are after login failed", e),
  )
  // A login that restores an expired session finds the user's courses still added.
  if (isAddingCourse || actionContext.startup.userData.getCourses().length === 0) {
    // Replaces the login screen; the walkthrough moves on once a course is added.
    void vscode.commands.executeCommand("tmc.showAddCourse")
  } else {
    loginScreens.close(panel)
    await showNextWalkthroughStep(
      () => ({ ...walkthroughProgressOf(actionContext), isLoggedIn: true }),
      { isVisibleOnly: true },
    ).catch((e) => Logger.warn("Could not show the next walkthrough step", e))
  }
  void refreshEverything(actionContext, { silent: true }).catch((e) =>
    Logger.error("Refresh after login failed", e),
  )
  return "loggedIn"
}

/**
 * Opens `url` in the user's browser. A refusal leaves the login waiting, as the screen names
 * the page to open by hand.
 */
async function openInBrowser(url: string): Promise<void> {
  if (!(await openWebLink(url))) {
    Logger.warn(`Could not open ${redactUrlQuery(url)} in a browser`)
  }
}

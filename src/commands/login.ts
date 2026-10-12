import * as vscode from "vscode"

import type { MoocDeviceLogin } from "../../shared/langsSchema"
import { backendName } from "../../shared/lib"
import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import {
  ConnectionError,
  DeviceLoginDeniedError,
  DeviceLoginExpiredError,
  presentationFor,
  ServerError,
} from "../errors"
import { Logger, openWebLink } from "../utilities"
import { refreshEverything } from "./refreshEverything"

const SITE = backendName("mooc")

/** How a login ended. `cancelled` also covers a newer login replacing this one. */
export type LoginOutcome = "loggedIn" | "cancelled" | "failed"

type Settled =
  | { kind: "deviceCode"; info: MoocDeviceLogin }
  | { kind: "finished"; error: Error | undefined }
  | { kind: "cancelled" }

let cancelCurrentLogin: (() => void) | undefined

/**
 * Logs in to courses.mooc.fi with the device flow, in the user's own browser so their
 * existing browser session is reused.
 *
 * A cancellable progress notification shows the code while it waits for the approval. The
 * verification page opens at once when its URL carries the code; otherwise a modal first offers
 * to copy the code for pasting there. Starting a login cancels any login already in flight, so
 * two `mooc login` processes never race on the credentials file. Every failure is reported
 * here, with a Try again action.
 */
export async function login(actionContext: ReadyActionContext): Promise<LoginOutcome> {
  const { dialog } = actionContext

  cancelCurrentLogin?.()
  const { deviceCode: code, result, interrupt } = actions.startMoocLogin(actionContext)
  const deviceCode = code.then((info): Settled => ({ kind: "deviceCode", info }))
  const finished = result.then(
    (loginResult): Settled => ({
      kind: "finished",
      error: loginResult.err ? loginResult.val : undefined,
    }),
  )
  const cancellation = Promise.withResolvers<Settled>()
  const cancelled = cancellation.promise
  const cancel = (): void => {
    interrupt()
    cancellation.resolve({ kind: "cancelled" })
  }
  cancelCurrentLogin = cancel

  const settled = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Logging in to ${SITE}`,
      cancellable: true,
    },
    async (progress, token): Promise<Settled> => {
      token.onCancellationRequested(cancel)
      progress.report({ message: "Requesting a login code…" })
      const first = await Promise.race([deviceCode, finished, cancelled])
      if (first.kind !== "deviceCode") {
        return first
      }
      const { info } = first
      progress.report({
        message: `Waiting for you to approve in the browser… Code ${info.user_code} at ${info.verification_uri}`,
      })
      const ended = Promise.race([finished, cancelled])
      if (info.verification_uri_complete) {
        // No modal of our own: VS Code already asks before opening a domain the user has not
        // trusted, and the code is in the URL it shows.
        void openInBrowser(info.verification_uri_complete)
      } else if (!(await offerCode(info, ended))) {
        cancel()
        return { kind: "cancelled" }
      }
      return ended
    },
  )

  if (cancelCurrentLogin === cancel) {
    cancelCurrentLogin = undefined
  }
  if (settled.kind === "cancelled") {
    return "cancelled"
  }
  if (settled.kind === "finished" && settled.error) {
    reportFailure(actionContext, ...failureMessage(settled.error))
    return "failed"
  }

  void dialog.notification(`Logged in to ${SITE}.`, [
    "Add new course",
    (): void => void vscode.commands.executeCommand("tmc.addNewCourse"),
  ])
  void refreshEverything(actionContext, { silent: true }).catch((e) =>
    Logger.error("Refresh after login failed", e),
  )
  return "loggedIn"
}

/**
 * Shows a code the user must type in a modal, and on "Copy & Open" copies it and opens the
 * verification page.
 *
 * @param ended Settles when the login ends without the user. VS Code cannot close a modal,
 * so one still open then is left to the user, and its button opens nothing.
 * @returns false when the user dismissed the modal while the login was still running.
 */
async function offerCode(info: MoocDeviceLogin, ended: Promise<unknown>): Promise<boolean> {
  let hasEnded = false
  void ended.then(() => {
    hasEnded = true
  })
  const copyAndOpen = `Copy & Open ${SITE}`
  const picked = await vscode.window.showInformationMessage(
    `Your ${SITE} login code is ${info.user_code}`,
    { modal: true, detail: "Paste the code on the page that opens, then approve the login." },
    copyAndOpen,
  )
  if (hasEnded) {
    return true
  }
  if (picked !== copyAndOpen) {
    return false
  }
  await vscode.env.clipboard.writeText(info.user_code)
  await openInBrowser(info.verification_uri)
  return true
}

/**
 * Opens `url` in the user's browser. A refusal leaves the login waiting, as the progress names
 * the page to open by hand.
 */
async function openInBrowser(url: string): Promise<void> {
  if (!(await openWebLink(url))) {
    Logger.warn(`Could not open ${url} in a browser`)
  }
}

/** The sentence for a failed login, plus the error when its details belong in the logs. */
function failureMessage(error: Error): [message: string, error?: Error] {
  if (error instanceof DeviceLoginDeniedError) {
    return ["The login was denied in the browser."]
  }
  if (error instanceof DeviceLoginExpiredError) {
    return ["The login code expired before it was approved."]
  }
  if (error instanceof ConnectionError) {
    return [`Could not reach ${SITE}. Check your internet connection.`, error]
  }
  if (error instanceof ServerError) {
    return [presentationFor(error).message, error]
  }
  return [`Logging in to ${SITE} failed. ${presentationFor(error).message}`, error]
}

function reportFailure(actionContext: ReadyActionContext, message: string, error?: Error): void {
  void actionContext.dialog.errorNotification(message, error, [
    "Try again",
    (): void => void vscode.commands.executeCommand("tmc.showMoocLogin"),
  ])
}

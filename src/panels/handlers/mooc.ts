import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { moocLoginRegistry } from "../moocLoginRegistry"
import type { HandlerMap } from "../router"

/** The courses.mooc.fi device-flow login screen's messages. */
export const moocHandlers = {
  moocLogin: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      const loginPanel = message.sourcePanel
      // Set below, after `authenticateMooc` returns; the callback fires asynchronously so it
      // always sees the real id.
      let invocationId = 0
      const { result, interrupt } = actionContext.startup.langs.authenticateMooc((info) => {
        if (!moocLoginRegistry.isCurrent(invocationId)) {
          return
        }
        // Not kept for a reload: a reload restarts the device flow, so resending this would
        // show the code of the attempt that reload abandoned.
        host.postTransient({
          type: "moocDeviceCode",
          target: loginPanel,
          userCode: info.user_code,
          verificationUri: info.verification_uri,
          verificationUriComplete: info.verification_uri_complete,
          expiresIn: info.expires_in,
          interval: info.interval,
        })
      })
      // Interrupt-and-replaces any login already in flight, so two `mooc login` processes
      // never race on the credentials file.
      invocationId = moocLoginRegistry.start(loginPanel.id, interrupt)
      const loginResult = await result.catch((error: unknown) =>
        Err(error instanceof Error ? error : new Error(String(error))),
      )
      if (!moocLoginRegistry.isCurrent(invocationId)) {
        // Superseded or cancelled while polling; the live attempt's entry is not ours to clear.
        return Err(new Error("The login was cancelled."))
      }
      moocLoginRegistry.finish(invocationId)
      if (loginResult.err) {
        return loginResult
      }
      // Nothing to navigate back to, so close and confirm. Offer the step the user most
      // likely came to take, but as a button, so a login that was only meant to renew a
      // session is not hijacked into a course picker.
      host.closeSidePanel()
      actionContext.dialog.notification("Logged in to courses.mooc.fi.", [
        "Add new course",
        (): void => {
          vscode.commands.executeCommand("tmc.addNewCourse")
        },
      ])
      return Ok(undefined)
    },
  },
  cancelMoocLogin: {
    requiresReady: false,
    handle(message): void {
      moocLoginRegistry.cancel(message.sourcePanel.id)
    },
  },
} satisfies Partial<HandlerMap>

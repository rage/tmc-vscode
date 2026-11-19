import * as vscode from "vscode"

import type { LoginOptions } from "../../ui/loginScreens"
import { loginScreens } from "../../ui/loginScreens"
import { Logger } from "../../utilities"
import type { HandlerMap } from "../router"

/** The login screen's messages. */
export const loginHandlers = {
  loginAction: {
    requiresReady: true,
    async handle(message, { host }): Promise<void> {
      const route = host.route
      if (route?.type !== "Login" || route.id !== message.sourcePanel.id) {
        Logger.warn("Ignoring a login action from a panel that no longer shows the login")
        return
      }
      if (message.action === "tryAgain") {
        const options: LoginOptions = { isAddingCourse: route.isAddingCourse }
        await vscode.commands.executeCommand("tmc.showMoocLogin", options)
        return
      }
      loginScreens.requestAction(route.id, message.action)
    },
  },
} satisfies Partial<HandlerMap>

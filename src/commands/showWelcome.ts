import { ActionContext } from "../actions/types";
import { randomPanelId, TmcPanel } from "../panels/TmcPanel";
import { Logger } from "../utilities";
import * as vscode from "vscode";

export async function showWelcome(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
): Promise<void> {
    Logger.info("Showing welcome");

    TmcPanel.renderMain(context.extensionUri, context, actionContext, {
        type: "Welcome",
        id: randomPanelId(),
    });
}

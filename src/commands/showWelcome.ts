import * as path from "path";
import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { WebviewMessage } from "../ui/types";

export async function showWelcome(actionContext: ActionContext): Promise<void> {
    const { resources, settings, ui } = actionContext;
    const insiderStatus: WebviewMessage = {
        command: "setInsiderStatus",
        enabled: settings.isInsider(),
    };
    ui.webview.setContentFromTemplate(
        {
            templateName: "welcome",
            version: resources.extensionVersion,
            newTreeView: vscode.Uri.file(
                path.join(resources.mediaFolder, "welcome_new_treeview.png"),
            ),
            actionsExplorer: vscode.Uri.file(
                path.join(resources.mediaFolder, "welcome_actions_jupyter.png"),
            ),
            tmcLogoFile: vscode.Uri.file(path.join(resources.mediaFolder, "TMC.png")),
        },
        false,
        [insiderStatus],
    );
}

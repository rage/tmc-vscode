import * as path from "path";
import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { WebviewMessage } from "../ui/types";
import { Logger } from "../utilities";

export async function showWelcome(actionContext: ActionContext): Promise<void> {
    const { resources, settings, ui } = actionContext;
    Logger.info("Showing welcome");

    const insiderStatus: WebviewMessage = {
        command: "setBooleanSetting",
        setting: "insider",
        enabled: settings.isInsider(),
    };
    ui.webview.setContentFromTemplate(
        {
            templateName: "welcome",
            version: resources.extensionVersion,
            exerciseDecorations: vscode.Uri.file(
                path.join(resources.mediaFolder, "welcome_exercise_decorations.png"),
            ),
            tmcLogoFile: vscode.Uri.file(path.join(resources.mediaFolder, "TMC.png")),
        },
        false,
        [insiderStatus],
    );
}

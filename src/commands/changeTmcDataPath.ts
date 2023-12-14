import * as vscode from "vscode";

import { moveExtensionDataPath } from "../actions";
import { ActionContext } from "../actions/types";
import { TmcPanel } from "../panels/TmcPanel";
import { Logger } from "../utilities";

/**
 * Removes language specific meta files from exercise directory.
 */
export async function changeTmcDataPath(actionContext: ActionContext): Promise<void> {
    const { dialog, resources } = actionContext;
    Logger.info("Changing TMC data path");

    const old = resources.projectsDirectory;
    const options: vscode.OpenDialogOptions = {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select folder",
        defaultUri: vscode.Uri.parse(old),
    };
    const newPath = (await vscode.window.showOpenDialog(options))?.[0];
    if (newPath && old) {
        const res = await dialog.progressNotification(
            "Moving projects directory...",
            (progress) => {
                return moveExtensionDataPath(actionContext, newPath, (update) =>
                    progress.report(update),
                );
            },
        );
        if (res.ok) {
            Logger.info(`Moved workspace folder from ${old} to ${newPath.fsPath}`);
            dialog.notification(`TMC Data was successfully moved to ${newPath.fsPath}`, [
                "OK",
                (): void => {},
            ]);
        } else {
            dialog.errorNotification(res.val.message, res.val);
        }
        TmcPanel.postMessage({
            type: "setTmcDataPath",
            tmcDataPath: resources.projectsDirectory,
            target: {
                type: "MyCourses",
            },
        });
    }
}

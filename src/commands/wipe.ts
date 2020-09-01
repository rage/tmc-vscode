import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { activate, deactivate } from "../extension";
import { isCorrectWorkspaceOpen, Logger } from "../utils";
import { askForConfirmation, showNotification } from "../window";

export async function wipe(
    actionContext: ActionContext,
    context: vscode.ExtensionContext,
): Promise<void> {
    const { resources, userData } = actionContext;
    const workspace = vscode.workspace.name?.split(" ")[0];
    if (workspace && isCorrectWorkspaceOpen(resources, workspace)) {
        showNotification(
            "Please close the TMC Workspace before wiping data and make sure you have closed all files related to TMC.",
            ["OK", (): void => {}],
        );
        return;
    }
    const wipe = await askForConfirmation(
        "Are you sure you want to wipe all data for the TMC Extension?",
        true,
    );
    if (!wipe) {
        return;
    }
    const reallyWipe = await askForConfirmation(
        "This action cannot be undone. This might permanently delete the extension data, exercises, settings...",
        true,
    );
    if (reallyWipe) {
        await vscode.commands.executeCommand("tmc.logout");
        fs.removeSync(path.join(resources.getDataPath()));
        await userData.wipeDataFromStorage();
        deactivate();
        for (const sub of context.subscriptions) {
            try {
                sub.dispose();
            } catch (e) {
                Logger.error(e);
            }
        }
        activate(context);
    }
}

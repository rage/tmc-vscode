import * as fs from "fs-extra";
import { Err, Ok } from "ts-results";
import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { deactivate } from "../extension";
import { Logger } from "../utilities";

export async function wipe(
    actionContext: ActionContext,
    context: vscode.ExtensionContext,
): Promise<void> {
    const { dialog, resources, langs, userData, workspaceManager } = actionContext;
    Logger.info("Wiping");
    if (
        !(
            workspaceManager.ok &&
            resources.ok &&
            langs.ok &&
            userData.ok &&
            resources.val.projectsDirectory
        )
    ) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    if (workspaceManager.val.activeCourse) {
        dialog.warningNotification(
            "Extension data can't be wiped now because a TMC Workspace is open. \
Please close the workspace and any related files before running this command again.",
            [
                "Close workspace",
                (): void => {
                    vscode.commands.executeCommand("workbench.action.closeFolder");
                },
            ],
        );
        return;
    }

    const wipe = await dialog.explicitConfirmation(
        "Are you sure you want to wipe all data for the TMC Extension?",
    );
    if (!wipe) {
        return;
    }

    const reallyWipe = await dialog.explicitConfirmation(
        "This action cannot be undone. This might permanently delete the extension data, exercises, settings...",
    );
    if (!reallyWipe) {
        return;
    }

    // Change to Explorer view to avoid instant restart
    await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");

    const message = "Removing extension data...";
    const wipeResult = await dialog.progressNotification(message, async (progress) => {
        if (
            !(workspaceManager && resources && langs && userData && resources.val.projectsDirectory)
        ) {
            Logger.error("Extension was not initialized properly");
            return Err(new Error("Extension was not initialized properly"));
        }

        // Remove exercises
        try {
            fs.removeSync(resources.val.projectsDirectory);
        } catch (_e) {
            return Err(new Error("Failed to remove projects directory."));
        }
        progress.report({ message, percent: 0.25 });

        // Reset Langs settings
        const result2 = await langs.val.resetSettings();
        if (result2.err) {
            return result2;
        }
        progress.report({ message, percent: 0.5 });

        // Maybe logout should have setting to disable events?
        langs.val.on("logout", () => {});
        const result3 = await langs.val.deauthenticate();
        if (result3.err) {
            return result3;
        }
        progress.report({ message, percent: 0.75 });

        // Clear storage
        await userData.val.wipeDataFromStorage();
        progress.report({ message, percent: 1 });

        // All clear
        return Ok.EMPTY;
    });

    if (wipeResult.err) {
        dialog.errorNotification("Failed to wipe extension data.", wipeResult.val);
        return;
    }

    await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", undefined);
    await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", undefined);

    deactivate();
    for (const sub of context.subscriptions) {
        try {
            sub.dispose();
        } catch (e) {
            Logger.error(e);
        }
    }

    Logger.info("Extension wipe completed.");
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

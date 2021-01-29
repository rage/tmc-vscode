import * as fs from "fs-extra";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { deactivate } from "../extension";
import { Logger } from "../utils";
import { askForConfirmation, showNotification } from "../window";

export async function wipe(
    actionContext: ActionContext,
    context: vscode.ExtensionContext,
): Promise<void> {
    const { resources, tmc, userData, workspaceManager } = actionContext;
    if (workspaceManager.activeCourse) {
        showNotification(
            "Please close the TMC Workspace before wiping data and make sure you have closed all files related to TMC.",
            [
                "Close workspace",
                (): void => {
                    vscode.commands.executeCommand("workbench.action.closeFolder");
                },
            ],
            ["Cancel", (): void => {}],
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
    if (!reallyWipe) {
        return;
    }

    const wipeResult = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "TestMyCode",
        },
        async (progress) => {
            progress.report({ message: "Removing extension data..." });

            // Remove exercises
            const result1 = Result.wrap(() => {
                fs.removeSync(resources.projectsDirectory);
            });
            if (result1.err) return result1;

            // Reset langs settings
            const result2 = await tmc.resetSettings();
            if (result2.err) return result2;

            // Maybe logout should have setting to disable events?
            tmc.on("logout", () => {});
            const result3 = await tmc.deauthenticate();
            if (result3.err) return result3;

            // Clear storage
            await userData.wipeDataFromStorage();

            // All clear
            return Ok.EMPTY;
        },
    );

    if (wipeResult.err) {
        Logger.error("Failed to wipe extension data: ", wipeResult.val);
        showNotification("Failed to wipe extension data.");
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

    Logger.log("Extension wipe completed.");
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

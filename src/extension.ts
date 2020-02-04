import * as vscode from "vscode";
import * as init from "./init";

import TMC from "./api/tmc";
import Storage from "./config/storage";
import UI from "./ui/ui";
import { sleep } from "./utils";

export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "tmc-vscode" is now active!');

    const result = await init.firstTimeInitialization(context);
    if (result.ok) {

        const resources = result.val;

        const ui = new UI(context, resources);
        const storage = new Storage(context);
        const tmc = new TMC(storage, context, resources);

        init.registerUiActions(context, ui, storage, tmc, resources);

        context.subscriptions.push(
            vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
        );
        context.subscriptions.push(
            vscode.commands.registerCommand("uploadArchive", async () => {
                const path = vscode.window.activeTextEditor?.document.fileName;
                if (path) {
                    const exerciseId = tmc.getExercisePath(path);
                    if (exerciseId) {
                        const submitResult = await tmc.submitExercise(exerciseId);
                        if (submitResult.ok) {
                            vscode.window.showInformationMessage("Exercise submitted successfully: " +
                                                                 submitResult.val.show_submission_url);
                            while (true) {
                                const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
                                if (statusResult.ok) {
                                    if (statusResult.val.status !== "processing") {
                                        if (statusResult.val.all_tests_passed) {
                                            vscode.window.showInformationMessage("All tests passed on server!");
                                        } else {
                                            vscode.window.showInformationMessage("Tests failed on server");
                                        }
                                        break;
                                    }
                                } else {
                                    console.error(statusResult.val);
                                }
                                await sleep(2500);
                            }
                        } else {
                            vscode.window.showErrorMessage(`Exercise submission failed: \
                                                            ${submitResult.val.name} - ${submitResult.val.message}`);
                            console.error(submitResult.val);
                        }
                    } else {
                        vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
                    }
                }
            }),
        );
    } else {
        vscode.window.showErrorMessage("Something broke: " + result.val.message);
    }
}

export function deactivate() {}

import * as vscode from "vscode";
import * as init from "./init";

import TMC from "./api/tmc";
import Storage from "./config/storage";
import TemporaryWebview from "./ui/temporaryWebview";
import UI from "./ui/ui";
import { sleep } from "./utils";

export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "tmc-vscode" is now active!');

    const result = await init.firstTimeInitialization(context);
    if (result.ok) {

        const resources = result.val;

        const currentWorkspaceFile = vscode.workspace.workspaceFile;
        const tmcWorkspaceFile = vscode.Uri.file(resources.tmcWorkspaceFilePath);

        if (!currentWorkspaceFile) {
            await vscode.commands.executeCommand("vscode.openFolder", tmcWorkspaceFile);
        } else if (currentWorkspaceFile.toString() !== tmcWorkspaceFile.toString()) {
            console.log(currentWorkspaceFile);
            console.log(tmcWorkspaceFile);
            vscode.window.showErrorMessage("Wont't open TMC workspace while another workspace is open");
            return;
        }

        const ui = new UI(context, resources);
        const storage = new Storage(context);
        const tmc = new TMC(storage, context, resources);

        init.registerUiActions(ui, storage, tmc);

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
                            const temp = new TemporaryWebview(resources, ui,
                                                                    "TMC server submission", () => {});
                            while (true) {
                                const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
                                if (statusResult.ok) {
                                    const statusData = statusResult.val;
                                    temp.setContent("submission-status", statusData);
                                    if (statusResult.val.status !== "processing") {
                                        temp.setContent("submission-result", statusData);
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
        context.subscriptions.push(
            vscode.commands.registerCommand("runTests", async () => {
                const path = vscode.window.activeTextEditor?.document.fileName;
                if (path) {
                    const exerciseId = tmc.getExercisePath(path);
                    if (exerciseId) {
                        const temp = new TemporaryWebview(resources, ui,
                            "TMC Test Results", () => {});
                        temp.setContent("loading");
                        const testResult = await tmc.runTests(exerciseId);
                        if (testResult.ok) {
                            temp.setContent("test-result", testResult.val);
                        } else {
                            vscode.window.showErrorMessage(`Exercise test run failed: \
                                                            ${testResult.val.name} - ${testResult.val.message}`);
                            console.error(testResult.val);
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

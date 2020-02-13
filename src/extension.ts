import * as vscode from "vscode";
import * as init from "./init";

import ExerciseManager from "./api/exerciseManager";
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
        const exerciseManager = new ExerciseManager(storage, resources);
        const tmc = new TMC(exerciseManager, storage, resources);

        init.registerUiActions(ui, storage, tmc);

        context.subscriptions.push(
            vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
        );
        context.subscriptions.push(
            vscode.commands.registerCommand("uploadArchive", async () => {
                const path = vscode.window.activeTextEditor?.document.fileName;
                if (path) {
                    const exerciseId = exerciseManager.getExercisePath(path);
                    if (exerciseId) {
                        const submitResult = await tmc.submitExercise(exerciseId);
                        if (submitResult.ok) {
                            vscode.window.showInformationMessage("Exercise submitted successfully: " +
                                                                 submitResult.val.show_submission_url);
                            let temp = new TemporaryWebview(resources, ui,
                                                                    "TMC server submission", () => {});
                            while (true) {
                                const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
                                if (statusResult.ok) {
                                    const statusData = statusResult.val;
                                    if (statusResult.val.status !== "processing") {
                                        if (temp.disposed) {
                                            temp = new TemporaryWebview(resources, ui,
                                                    "TMC server submission", () => {});
                                        }
                                        temp.setContent("submission-result", statusData);
                                        break;
                                    }
                                    temp.setContent("submission-status", statusData);
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
                    const exerciseId = exerciseManager.getExercisePath(path);
                    if (exerciseId) {
                        const exerciseDetails = await tmc.getExerciseDetails(exerciseId);
                        if (exerciseDetails.ok) {
                            vscode.window.setStatusBarMessage(`Running tests for ${exerciseDetails.val.exercise_name}`);
                            const testResult = await tmc.runTests(exerciseId);
                            vscode.window.setStatusBarMessage("");
                            if (testResult.ok) {
                                vscode.window.setStatusBarMessage(`Tests finished for ${exerciseDetails.val.exercise_name}`, 5000);
                                const temp = new TemporaryWebview(resources, ui,
                                    "TMC Test Results", () => {});
                                const testResultVal = testResult.val;
                                const data = { testResultVal, exerciseId };
                                temp.setContent("test-result", data);
                            } else {
                                vscode.window.setStatusBarMessage(`Running tests for ${exerciseDetails.val.exercise_name} failed`, 5000);
                                vscode.window.showErrorMessage(`Exercise test run failed: \
                                                                ${testResult.val.name} - ${testResult.val.message}`);
                                console.error(testResult.val);
                            }
                        } else {
                            vscode.window.showErrorMessage(`Getting exercise details failed: \
                                                            ${exerciseDetails.val.name} - ${exerciseDetails.val.message}`);
                            console.error(exerciseDetails.val);
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

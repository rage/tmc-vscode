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
                            const temp = new TemporaryWebview(resources, ui, "TMC server submission", async (msg) => {
                                if (msg.feedback && msg.feedback.status.length > 0) {
                                    console.log(await tmc.submitSubmissionFeedback(msg.url, msg.feedback));
                                } else if (msg.setToBackground) {
                                    temp.dispose();
                                } else if (msg.showInBrowser) {
                                    vscode.env.openExternal(vscode.Uri.parse(submitResult.val.show_submission_url));
                                } else if (msg.showSolutionInBrowser) {
                                    vscode.env.openExternal(vscode.Uri.parse(msg.solutionUrl));
                                }
                            });

                            let timeWaited = 0;
                            let getStatus = true;
                            while (getStatus) {
                                const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
                                if (statusResult.ok) {
                                    const statusData = statusResult.val;
                                    if (statusResult.val.status !== "processing") {
                                        vscode.window.setStatusBarMessage("Tests finished, see result", 5000);
                                        temp.setContent("submission-result", statusData);
                                        break;
                                    }
                                    if (!temp.disposed) {
                                        temp.setContent("submission-status", statusData);
                                    } else {
                                        vscode.window.setStatusBarMessage("Waiting for results from server.", 5000);
                                    }
                                } else {
                                    console.error(statusResult.val);
                                    break;
                                }
                                await sleep(2500);
                                if (timeWaited === 120000) {
                                    vscode.window.showInformationMessage(`This seems to be taking a long time — consider continuing to the next exercise while this is running. \
                                    Your submission will still be graded. Check the results later at ${submitResult.val.show_submission_url}`, ...["Open URL and move on...", "No, I'll wait"])
                                    .then((selection) => {
                                        if (selection === "Open URL and move on...") {
                                            vscode.env.openExternal(
                                                vscode.Uri.parse(submitResult.val.show_submission_url));
                                            getStatus = false;
                                            temp.dispose();
                                        }
                                    });
                                }
                                timeWaited = timeWaited + 2500;
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
                            const exerciseName = exerciseDetails.val.exercise_name;
                            const temp = new TemporaryWebview(resources, ui,
                                "TMC Test Results", async (msg) => {
                                    if (msg.setToBackground) {
                                        temp.dispose();
                                    }
                                    if (msg.submit) {
                                        // TO-DO: create function, wich submits current exercise to server
                                        console.log("Submit to server");
                                        console.log(typeof msg.exerciseId); // number
                                    }
                                });
                            temp.setContent("running-tests", { exerciseName });
                            vscode.window.setStatusBarMessage(`Running tests for ${exerciseName}`);
                            const testResult = await tmc.runTests(exerciseId);
                            vscode.window.setStatusBarMessage("");
                            if (testResult.ok) {
                                vscode.window.setStatusBarMessage(`Tests finished for ${exerciseName}`, 5000);
                                const testResultVal = testResult.val;
                                const data = { testResultVal, exerciseId, exerciseName };
                                temp.setContent("test-result", data);
                            } else {
                                vscode.window.setStatusBarMessage(`Running tests for ${exerciseName} failed`, 5000);
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

        const resetStatusbar = vscode.window.createStatusBarItem();

        context.subscriptions.push(
            vscode.commands.registerCommand("resetExercise", async () => {
                resetStatusbar.text = `resetting exercise`;
                resetStatusbar.show();
                const path = vscode.window.activeTextEditor?.document.fileName;
                if (path) {
                    const exerciseId = exerciseManager.getExercisePath(path);
                    if (exerciseId) {
                        vscode.window.showInformationMessage("Resetting exercise...");
                        const submitResult = await tmc.submitExercise(exerciseId);
                        if (submitResult.ok) {
                            const slug = exerciseManager.getOrganizationSlugByExerciseId(exerciseId);
                            exerciseManager.deleteExercise(exerciseId);
                            await tmc.downloadExercise(exerciseId, slug.unwrap());

                            resetStatusbar.text = `Exercise resetted succesfully`, setTimeout(() => {
                                resetStatusbar.hide();
                            }, 5000);
                            resetStatusbar.show();

                        } else {
                            vscode.window.showErrorMessage(`Reset canceled, failed to submit exercise: \
                                                            ${submitResult.val.name} - ${submitResult.val.message}`);
                            console.error(submitResult.val);

                            resetStatusbar.text = `Something went wrong`, setTimeout(() => {
                                resetStatusbar.hide();
                            }, 5000);
                            resetStatusbar.show();
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

export function deactivate() { }

import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { showNotification } from "../api/vscode";
import { ExerciseStatus } from "../config/types";
import { isCorrectWorkspaceOpen, Logger } from "../utils";

export * from "./commands";
export * from "./resources";
export * from "./ui";
export * from "./settings";

/**
 * VSCode function that watches TMC workspace changes and syncs states accordingly.
 * @param actionContext
 */
export function watchForWorkspaceChanges(actionContext: ActionContext): void {
    const { resources, vsc, workspaceManager, ui } = actionContext;
    const currentWorkspace = vsc.getWorkspaceName();
    if (currentWorkspace && isCorrectWorkspaceOpen(resources, currentWorkspace)) {
        Logger.log("TMC Workspace identified, listening for folder changes.");
        vscode.workspace.onDidChangeWorkspaceFolders((listener) => {
            const foldersToRemove: vscode.Uri[] = [];

            listener.removed.forEach((item) => {
                const exercise = workspaceManager.getExerciseDataByPath(item.uri.fsPath);
                if (
                    exercise.ok &&
                    exercise.val.status !== ExerciseStatus.MISSING &&
                    exercise.val.status === ExerciseStatus.OPEN &&
                    currentWorkspace === exercise.val.course
                ) {
                    workspaceManager.updateExercisesStatus(exercise.val.id, ExerciseStatus.CLOSED);
                    ui.webview.postMessage({
                        key: `exercise-${exercise.val.id}-status`,
                        message: {
                            command: "exerciseStatusChange",
                            exerciseId: exercise.val.id,
                            status: "closed",
                        },
                    });
                }
            });

            listener.added.forEach((item) => {
                const exercise = workspaceManager.getExerciseDataByPath(item.uri.fsPath);
                if (
                    exercise.ok &&
                    exercise.val.status !== ExerciseStatus.MISSING &&
                    exercise.val.status === ExerciseStatus.CLOSED &&
                    currentWorkspace === exercise.val.course
                ) {
                    workspaceManager.updateExercisesStatus(exercise.val.id, ExerciseStatus.OPEN);
                    ui.webview.postMessage({
                        key: `exercise-${exercise.val.id}-status`,
                        message: {
                            command: "exerciseStatusChange",
                            exerciseId: exercise.val.id,
                            status: "opened",
                        },
                    });
                } else if (exercise.ok && currentWorkspace !== exercise.val.course) {
                    foldersToRemove.push(vsc.toUri(item.uri.fsPath));
                } else if (exercise.err) {
                    if (item.name !== ".tmc") {
                        Logger.warn(
                            "Added folder that isn't part of any course.",
                            exercise.val.message,
                            exercise.val.stack,
                        );
                        foldersToRemove.push(vsc.toUri(item.uri.fsPath));
                    }
                }
            });

            if (foldersToRemove.length !== 0) {
                Logger.log("Folders that was added.", foldersToRemove);
                showNotification(
                    `Exercises or folders you added to this workspace are not
                    part of the current course ${currentWorkspace} and will be removed later.`,
                    ["Ok", (): void => {}],
                );
            }
        });

        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            const workspace = vscode.workspace.name?.split(" ")[0];
            if (workspace && isCorrectWorkspaceOpen(resources, workspace)) {
                const languageId = doc.languageId;
                Logger.debug("Text document languageId", languageId);
                switch (languageId) {
                    case "c":
                    case "cpp":
                    case "objective-c":
                    case "objective-cpp":
                        if (!vscode.extensions.getExtension("ms-vscode.cpptools")) {
                            workspaceManager.addWorkspaceRecommendation(
                                workspace,
                                "ms-vscode.cpptools",
                            );
                        }
                        break;
                    case "csharp":
                        if (!vscode.extensions.getExtension("ms-dotnettools.csharp")) {
                            workspaceManager.addWorkspaceRecommendation(
                                workspace,
                                "ms-dotnettools.csharp",
                            );
                        }
                        break;
                    case "markdown":
                        await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
                        break;
                    case "r":
                        if (!vscode.extensions.getExtension("ikuyadeu.r")) {
                            workspaceManager.addWorkspaceRecommendation(workspace, "ikuyadeu.r");
                        }
                        break;
                    case "python":
                        if (!vscode.extensions.getExtension("ms-python.python")) {
                            workspaceManager.addWorkspaceRecommendation(
                                workspace,
                                "ms-python.python",
                            );
                        }
                        break;
                    case "java":
                        if (!vscode.extensions.getExtension("vscjava.vscode-java-pack")) {
                            workspaceManager.addWorkspaceRecommendation(
                                workspace,
                                "vscjava.vscode-java-pack",
                            );
                        }
                        break;
                }
            }
        });
    }
}

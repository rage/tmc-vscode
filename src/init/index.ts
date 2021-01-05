import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { ExerciseStatus } from "../api/storage";
import { isCorrectWorkspaceOpen, Logger } from "../utils";
import { showNotification } from "../window";

export * from "./commands";
export * from "./resources";
export * from "./ui";
export * from "./settings";
export * from "./downloadCorrectLangsVersion";

/**
 * VSCode function that watches TMC workspace changes and syncs states accordingly.
 * @param actionContext
 */
export function watchForWorkspaceChanges(actionContext: ActionContext): void {
    const { resources, workspaceManager, ui, userData } = actionContext;
    const currentWorkspace = vscode.workspace.name?.split(" ")[0];
    if (currentWorkspace && isCorrectWorkspaceOpen(resources, currentWorkspace)) {
        Logger.log("TMC Workspace identified, listening for folder changes.");
        vscode.workspace.onDidChangeWorkspaceFolders(async (listener) => {
            Logger.debug("WatchForWorkspaceChanges listener", listener);
            const foldersToRemove: vscode.Uri[] = [];

            listener.removed.forEach((item) => {
                const exercise = workspaceManager.getExerciseByPath(item.uri);
                if (
                    exercise &&
                    exercise.status !== ExerciseStatus.MISSING &&
                    exercise.status === ExerciseStatus.OPEN &&
                    currentWorkspace === exercise.course
                ) {
                    const exerciseId = userData
                        .getCourseByName(exercise.course)
                        .exercises.find((x) => x.name === exercise.name)?.id;
                    if (!exerciseId) {
                        return;
                    }

                    workspaceManager.setExerciseStatus(exerciseId, ExerciseStatus.CLOSED);
                    ui.webview.postMessage({
                        command: "exerciseStatusChange",
                        exerciseId,
                        status: "closed",
                    });
                }
            });

            listener.added.forEach((item) => {
                const exercise = workspaceManager.getExerciseByPath(item.uri);
                if (
                    exercise &&
                    exercise.status !== ExerciseStatus.MISSING &&
                    exercise.status === ExerciseStatus.CLOSED &&
                    currentWorkspace === exercise.course
                ) {
                    const exerciseId = userData
                        .getCourseByName(exercise.course)
                        .exercises.find((x) => x.name === exercise.name)?.id;
                    if (!exerciseId) {
                        return;
                    }

                    workspaceManager.setExerciseStatus(exerciseId, ExerciseStatus.OPEN);
                    ui.webview.postMessage({
                        command: "exerciseStatusChange",
                        exerciseId: exerciseId,
                        status: "opened",
                    });
                } else if (exercise && currentWorkspace !== exercise.course) {
                    foldersToRemove.push(vscode.Uri.file(item.uri.fsPath));
                } else if (exercise) {
                    if (item.name !== ".tmc") {
                        Logger.warn(
                            "Added folder that isn't part of any course.",
                            exercise.course,
                            exercise.name,
                        );
                        foldersToRemove.push(vscode.Uri.file(item.uri.fsPath));
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
            /** For less clutter on explorer tree.
             * If user opened more than 5 exercises we collapse all folders.
             * Currently this command doesn't take arguments, which folders to collapse.
             */
            if (listener.added.length > 5) {
                await vscode.commands.executeCommand(
                    "workbench.files.action.collapseExplorerFolders",
                );
            }
        });

        /**
         * VS Code doesn't recommend extension for workspaces if you start our extension
         * in development mode.
         */
        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            const workspace = vscode.workspace.name?.split(" ")[0];
            if (workspace && isCorrectWorkspaceOpen(resources, workspace)) {
                const languageId = doc.languageId;
                Logger.debug("Text document languageId " + languageId);
                switch (languageId) {
                    case "c":
                    case "cpp":
                    case "objective-c":
                    case "objective-cpp":
                        if (!vscode.extensions.getExtension("ms-vscode.cpptools")) {
                            workspaceManager.addWorkspaceRecommendation(workspace, [
                                "ms-vscode.cpptools",
                            ]);
                        }
                        break;
                    case "csharp":
                        if (!vscode.extensions.getExtension("ms-dotnettools.csharp")) {
                            workspaceManager.addWorkspaceRecommendation(workspace, [
                                "ms-dotnettools.csharp",
                            ]);
                        }
                        break;
                    case "markdown":
                        await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
                        break;
                    case "r":
                        if (!vscode.extensions.getExtension("ikuyadeu.r")) {
                            workspaceManager.addWorkspaceRecommendation(workspace, ["ikuyadeu.r"]);
                        }
                        break;
                    case "python":
                        if (
                            !vscode.extensions.getExtension("ms-python.python") ||
                            !vscode.extensions.getExtension("ms-python.vscode-pylance")
                        ) {
                            workspaceManager.addWorkspaceRecommendation(workspace, [
                                "ms-python.python",
                                "ms-python.vscode-pylance",
                            ]);
                        }
                        break;
                    case "java":
                        if (!vscode.extensions.getExtension("vscjava.vscode-java-pack")) {
                            workspaceManager.addWorkspaceRecommendation(workspace, [
                                "vscjava.vscode-java-pack",
                            ]);
                        }
                        break;
                }
            }
        });
    }
}

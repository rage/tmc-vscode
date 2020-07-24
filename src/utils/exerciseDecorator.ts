import * as vscode from "vscode";

import WorkspaceManager from "../api/workspaceManager";
import { UserData } from "../config/userdata";

export class ExerciseDecorator implements vscode.DecorationProvider {
    private disposables: vscode.Disposable[] = [];
    private userData: UserData;
    private workspaceManager: WorkspaceManager;
    constructor(userData: UserData, workspaceManager: WorkspaceManager) {
        this.userData = userData;
        this.workspaceManager = workspaceManager;
        this.disposables.push(vscode.window.registerDecorationProvider(this));
    }
    onDidChangeDecorations: vscode.Event<
        vscode.Uri | vscode.Uri[] | undefined
    > = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>().event;

    provideDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.Decoration> {
        const exercise = this.workspaceManager.getExerciseDataByPath(uri.fsPath);
        if (exercise.err) {
            return;
        }
        const workspace = vscode.workspace.name;
        if (!workspace) {
            return;
        }
        const passed = this.userData
            .getCourseByName(workspace.split(" ")[0])
            .exercises.find((ex) => ex.id === exercise.val.id)?.passed;
        if (passed) {
            return {
                letter: "C",
                title: "Completed!",
                color: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
                priority: 1,
                bubble: false,
            };
        }
    }
    dispose(): void {
        this.disposables.forEach((dispose) => dispose.dispose());
    }
}

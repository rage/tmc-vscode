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
        const exerciseAsPath = this.workspaceManager.getExerciseDataByPath(uri.fsPath);
        if (exerciseAsPath.err) {
            return;
        }
        const localExercise = exerciseAsPath.val;

        const deadlinePassed = localExercise.deadline
            ? Date.now() > Date.parse(localExercise.deadline)
            : undefined;

        const workspace = vscode.workspace.name;
        if (!workspace) {
            return;
        }

        const course = this.userData.getCourseByName(workspace.split(" ")[0]);
        const exercise = course.exercises.find((ex) => ex.id === localExercise.id);
        if (!exercise) {
            return {
                letter: "ⓘ",
                title:
                    "Exercise not found in course. " +
                    "This could be an old exercise that has been renamed or removed from course.",
                color: new vscode.ThemeColor("gitDecoration.ignoredResourceForeground"),
                priority: 2,
            };
        }

        if (exercise.passed) {
            return {
                letter: "✓",
                title: "Exercise completed!",
                priority: 1,
            };
        }

        if (deadlinePassed) {
            return {
                letter: "✗",
                title: "Deadline exceeded.",
                priority: 1,
            };
        }
    }
    dispose(): void {
        this.disposables.forEach((dispose) => dispose.dispose());
    }
}

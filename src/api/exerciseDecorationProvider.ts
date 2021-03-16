import * as vscode from "vscode";

import WorkspaceManager from "../api/workspaceManager";
import { UserData } from "../config/userdata";

/**
 * Class that adds decorations like completion icons for exercises.
 */
export class ExerciseDecorationProvider implements vscode.FileDecorationProvider {
    public onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined>;

    private static _passedExercise = new vscode.FileDecoration(
        "✓",
        "Exercise completed!",
        new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
    );

    private static _missingExercise = new vscode.FileDecoration(
        "ⓘ",
        "Exercise not found in course. This could be an old exercise that has been renamed or removed from course.",
        new vscode.ThemeColor("gitDecoration.ignoredResourceForeground"),
    );

    private static _expiredExercise = new vscode.FileDecoration("✗", "Deadline exceeded.");

    /**
     * Creates a new instance of an `ExerciseDecorationProvider`.
     */
    constructor(
        private readonly userData: UserData,
        private readonly workspaceManager: WorkspaceManager,
    ) {
        this.onDidChangeFileDecorations = new vscode.EventEmitter<
            vscode.Uri | vscode.Uri[]
        >().event;
    }

    public provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        const exercise = this.workspaceManager.getExerciseByPath(uri);
        if (!exercise || exercise.uri.fsPath !== uri.fsPath) {
            return;
        }

        const apiExercise = this.userData.getExerciseByName(
            exercise.courseSlug,
            exercise.exerciseSlug,
        );
        if (!apiExercise) {
            return ExerciseDecorationProvider._missingExercise;
        }

        if (apiExercise.passed) {
            return ExerciseDecorationProvider._passedExercise;
        }

        const deadlinePassed = apiExercise.deadline
            ? Date.now() > Date.parse(apiExercise.deadline)
            : undefined;
        if (deadlinePassed) {
            return ExerciseDecorationProvider._expiredExercise;
        }
    }
}

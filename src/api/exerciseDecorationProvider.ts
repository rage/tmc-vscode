import * as vscode from "vscode";

import WorkspaceManager, { WorkspaceExercise } from "../api/workspaceManager";
import { UserData } from "../config/userdata";

/**
 * Class that adds decorations like completion icons for exercises.
 */
export default class ExerciseDecorationProvider
    implements vscode.Disposable, vscode.FileDecorationProvider {
    public onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined>;

    private static _passedExercise = new vscode.FileDecoration(
        "⬤",
        "Exercise completed!",
        new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
    );

    private static _partiallyCompletedExercise = new vscode.FileDecoration(
        "○",
        "Some points gained",
        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
    );

    private static _missingExercise = new vscode.FileDecoration(
        "ⓘ",
        "Exercise not found in course. This could be an old exercise that has been renamed or removed from course.",
        new vscode.ThemeColor("gitDecoration.ignoredResourceForeground"),
    );

    private static _expiredExercise = new vscode.FileDecoration("✗", "Deadline exceeded.");

    private _eventEmiter: vscode.EventEmitter<vscode.Uri | vscode.Uri[]>;

    /**
     * Creates a new instance of an `ExerciseDecorationProvider`.
     */
    constructor(
        private readonly userData: UserData,
        private readonly workspaceManager: WorkspaceManager,
    ) {
        this._eventEmiter = new vscode.EventEmitter();
        this.onDidChangeFileDecorations = this._eventEmiter.event;
    }

    public dispose(): void {
        this._eventEmiter.dispose();
    }

    public provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        const exercise = this.workspaceManager.getExerciseByPath(uri);
        if (!exercise || exercise.uri.fsPath !== uri.fsPath) {
            return;
        }

        const apiExercise = this.userData.getTmcExerciseByName(
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

        if (apiExercise.awardedPoints > 0) {
            return ExerciseDecorationProvider._partiallyCompletedExercise;
        }
    }

    /**
     * Trigger decorator event for given exercises. Requires this object to be registered with
     * `vscode.window.registerFileDecorationProvider` for any effects to take any effect.
     */
    public updateDecorationsForExercises(...exercises: ReadonlyArray<WorkspaceExercise>): void {
        this._eventEmiter.fire(exercises.map((x) => x.uri));
    }
}

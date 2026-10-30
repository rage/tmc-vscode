import WorkspaceManager, { ExerciseStatus, WorkspaceExercise } from "../../api/workspaceManager";
import Resources from "../../config/resources";
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

suite("WorkspaceManager", function () {
    const coursePath = path.join(__dirname, "course");
    const exercise = (slug: string): WorkspaceExercise => ({
        courseSlug: "course",
        exerciseSlug: slug,
        status: ExerciseStatus.Open,
        uri: vscode.Uri.file(path.join(coursePath, slug)),
    });
    const exercises = [exercise("part1-01"), exercise("part1-02")];

    let workspaceManager: WorkspaceManager;

    setup(function () {
        const resources = new Resources(
            "",
            "",
            "",
            "",
            path.join(__dirname, "workspaces"),
            coursePath,
        );
        workspaceManager = new WorkspaceManager(resources, exercises);
    });

    teardown(function () {
        workspaceManager.dispose();
    });

    test("finds the exercise containing a file", function () {
        const file = vscode.Uri.file(path.join(coursePath, "part1-02", "src", "main.py"));
        assert.strictEqual(workspaceManager.getExerciseByPath(file), exercises[1]);
    });

    test("finds no exercise for a file outside all exercises", function () {
        const file = vscode.Uri.file(path.join(__dirname, "elsewhere", "main.py"));
        assert.strictEqual(workspaceManager.getExerciseByPath(file), undefined);
    });
});

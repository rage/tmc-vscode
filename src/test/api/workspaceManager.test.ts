import WorkspaceManager from "../../api/workspaceManager";
import Resources from "../../config/resources";
import { exerciseHelloWorld, workspaceExercises } from "../fixtures/workspaceManager";
import { expect } from "chai";
import * as vscode from "vscode";

/** A course workspace whose file VS Code refuses one section of, recording the others. */
class RefusingWorkspaceManager extends WorkspaceManager {
    public readonly written: string[] = [];

    constructor(private readonly _refusedSection: string) {
        super(new Resources("", "", "", "", "/tmc/workspaces", undefined), []);
    }

    public get activeCourse(): string | undefined {
        return "test-course";
    }

    public async updateWorkspaceSetting(section: string): Promise<void> {
        if (section === this._refusedSection) {
            throw new Error(
                "Unable to write into workspace settings because the file has unsaved changes.",
            );
        }
        this.written.push(section);
    }
}

suite("WorkspaceManager class", function () {
    let workspaceManager: WorkspaceManager;

    setup(function () {
        const resources = new Resources("", "", "", "", "/tmc/workspaces", undefined);
        workspaceManager = new WorkspaceManager(resources, workspaceExercises);
    });

    teardown(function () {
        workspaceManager.dispose();
    });

    test("exerciseFolders lists only the workspace folders that are exercises", function () {
        const folders = [
            { uri: vscode.Uri.file("/tmc/workspaces/.tmc") },
            { uri: exerciseHelloWorld.uri },
            { uri: vscode.Uri.file("/home/student/notes") },
            { uri: vscode.Uri.file(exerciseHelloWorld.uri.fsPath + "/src") },
        ];

        expect(workspaceManager.exerciseFolders(folders).map((uri) => uri.fsPath)).to.deep.equal([
            exerciseHelloWorld.uri.fsPath,
        ]);
    });

    test("fires onDidChangeExercises when exercises are added", function () {
        let fired = 0;
        const listener = workspaceManager.onDidChangeExercises(() => fired++);

        workspaceManager.addExercise({ ...exerciseHelloWorld, exerciseSlug: "another" });

        listener.dispose();
        expect(fired).to.equal(1);
    });

    test("a refused integrity write neither throws nor stops the other sections", async function () {
        const refusing = new RefusingWorkspaceManager("files.exclude");

        await refusing.verifyWorkspaceSettingsIntegrity();

        refusing.dispose();
        expect(refusing.written).to.include.members([
            "files.watcherExclude",
            "explorer.decorations.colors",
            "explorer.decorations.badges",
            "problems.decorations.enabled",
        ]);
    });
});

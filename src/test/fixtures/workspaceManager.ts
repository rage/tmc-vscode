import * as vscode from "vscode";

import { ExerciseStatus, WorkspaceExercise } from "../../api/workspaceManager";

const workspaceExercises: WorkspaceExercise[] = [
    {
        courseSlug: "test-python-course",
        exerciseSlug: "hello_world",
        status: ExerciseStatus.Open,
        uri: vscode.Uri.file("/tmc/vscode/test-python-course/hello_world"),
    },
    {
        courseSlug: "test-python-course",
        exerciseSlug: "other_world",
        status: ExerciseStatus.Closed,
        uri: vscode.Uri.file("/tmc/vscode/test-python-course/other_world"),
    },
];

export { workspaceExercises };

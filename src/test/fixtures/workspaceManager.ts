import * as vscode from "vscode";

import { ExerciseStatus, WorkspaceExercise } from "../../api/workspaceManager";

export const exerciseHelloWorld: WorkspaceExercise = {
    backend: "tmc",
    courseSlug: "test-python-course",
    exerciseSlug: "hello_world",
    status: ExerciseStatus.Open,
    uri: vscode.Uri.file("/tmc/vscode/test-python-course/hello_world"),
};

export const exerciseOtherWorld: WorkspaceExercise = {
    backend: "tmc",
    courseSlug: "test-python-course",
    exerciseSlug: "other_world",
    status: ExerciseStatus.Closed,
    uri: vscode.Uri.file("/tmc/vscode/test-python-course/other_world"),
};

export const workspaceExercises: WorkspaceExercise[] = [exerciseHelloWorld, exerciseOtherWorld];

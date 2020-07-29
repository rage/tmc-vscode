import * as vscode from "vscode";

import { askForItem } from "../api/vscode";
import { LocalExerciseData } from "../config/types";

import { ActionContext } from "./types";
import { submitExercise, testExercise } from "./user";

export * from "./user";
export * from "./webview";
export * from "./workspace";
export * as legacy from "./legacy";

export async function selectAction(
    actionContext: ActionContext,
    exercise: LocalExerciseData,
): Promise<void> {
    const options: [string, () => Thenable<void>][] = [
        [
            "Run tests (CTRL + SHIFT + T)",
            (): Promise<void> => testExercise(actionContext, exercise.id),
        ],
        ["Submit to server", (): Promise<void> => submitExercise(actionContext, exercise.id)],
        [
            "Upload to TMC Pastebin",
            (): Thenable<void> => vscode.commands.executeCommand("tmc.pasteExercise"),
        ],
        [
            "Close exercise (CTRL + SHIFT + C)",
            async (): Promise<void> => await vscode.commands.executeCommand("tmc.closeExercise"),
        ],
        [
            "Reset exercise",
            async (): Promise<void> => await vscode.commands.executeCommand("tmc.resetExercise"),
        ],
        [
            "Download old submission",
            async (): Promise<void> =>
                await vscode.commands.executeCommand("tmc.downloadOldSubmission"),
        ],
        [
            "Clean exercise meta files",
            async (): Promise<void> => await vscode.commands.executeCommand("tmc.cleanExercise"),
        ],
        [
            "Change course workspace",
            async (): Promise<void> => await vscode.commands.executeCommand("tmc.switchWorkspace"),
        ],
    ];

    (
        await askForItem<() => Thenable<unknown>>(
            `Select TMC Action for ${exercise.name}`,
            false,
            ...options,
        )
    )?.();
}

import * as vscode from "vscode";

import { LocalExerciseData } from "../config/types";
import { askForItem } from "../utils";

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
            (): Thenable<void> => vscode.commands.executeCommand("pasteExercise"),
        ],
        [
            "Close exercise (CTRL + SHIFT + C)",
            async (): Promise<void> => await vscode.commands.executeCommand("closeExercise"),
        ],
        [
            "Reset exercise",
            async (): Promise<void> => await vscode.commands.executeCommand("resetExercise"),
        ],
        [
            "Download old submission",
            async (): Promise<void> =>
                await vscode.commands.executeCommand("downloadOldSubmission"),
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

import * as vscode from "vscode";
import { ActionContext } from "./types";
import { askForItem } from "../utils";
import { pasteExercise, submitExercise, testExercise } from "./user";
import { LocalExerciseData } from "../config/types";

export * from "./user";
export * from "./webview";
export * from "./workspace";

export async function selectAction(
    actionContext: ActionContext,
    exercise: LocalExerciseData,
): Promise<void> {
    const options: [string, () => Promise<unknown>][] = [
        [
            "Run tests (CTRL + SHIFT + T)",
            (): Promise<void> => testExercise(actionContext, exercise.id),
        ],
        ["Submit to server", (): Promise<void> => submitExercise(actionContext, exercise.id)],
        ["Upload to TMC Pastebin", (): Promise<void> => pasteExercise(actionContext, exercise.id)],
        [
            "Close exercise (CTRL + SHIFT + C)",
            async (): Promise<void> => await vscode.commands.executeCommand("closeExercise"),
        ],
        [
            "Reset exercise",
            async (): Promise<void> => await vscode.commands.executeCommand("resetExercise"),
        ],
    ];

    (
        await askForItem<() => Promise<unknown>>(
            `Select TMC Action for ${exercise.name}`,
            false,
            ...options,
        )
    )?.();
}

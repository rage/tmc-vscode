import * as vscode from "vscode";
import { ActionContext } from "./types";
import { askForItem, showNotification } from "../utils";
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
        [
            "Upload to TMC Pastebin",
            async (): Promise<void> => {
                const link = await pasteExercise(actionContext, exercise.id);
                showNotification(`Paste to TMC Server successful: ${link}`, [
                    "Open URL",
                    (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(link)),
                ]);
            },
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
        await askForItem<() => Promise<unknown>>(
            `Select TMC Action for ${exercise.name}`,
            false,
            ...options,
        )
    )?.();
}

import * as vscode from "vscode";

import { Logger, LogLevel } from "../utils/logger";

/**
 * Prompts the user with a yes/no dialog.
 * @param prompt A prompt to present to the user
 * @param explicit Require user to explicitely type 'yes' for the answer to count as true
 */
export async function askForConfirmation(prompt: string, explicit?: boolean): Promise<boolean> {
    const explicitOptions: vscode.InputBoxOptions = {
        placeHolder: "Write 'Yes' to confirm or 'No' to cancel and press 'Enter'.",
        prompt,
    };

    return explicit
        ? (await vscode.window.showInputBox(explicitOptions))?.toLowerCase() === "yes"
        : (await askForItem<boolean>(prompt, false, ["Yes", true], ["No", false])) || false;
}

/**
 * Prompts a selection to the user for multiple different options and returns its associated
 * generic type.
 */
export async function askForItem<T>(
    prompt: string,
    multiple: boolean,
    ...items: Array<[string, T]>
): Promise<T | undefined> {
    const options: vscode.QuickPickOptions = {
        canPickMany: multiple || false,
        placeHolder: prompt,
    };

    const selection = await vscode.window.showQuickPick(
        items.map((i) => i[0]),
        options,
    );
    return items.find((item) => item[0] === selection)?.[1];
}

/**
 * Wrapper for vscode.window.showErrorMessage that resolves optional items to associated callbacks.
 */
export async function showError(
    error: string,
    ...items: Array<[string, () => void]>
): Promise<void> {
    const items2 =
        items.length > 0
            ? items
            : Logger.level === LogLevel.None
            ? items.concat([["Ok", (): void => {}]])
            : items.concat([["Details", (): void => Logger.show()]]);
    return vscode.window
        .showErrorMessage(`TestMyCode: ${error}`, ...items2.map((item) => item[0]))
        .then((selection) => {
            items2.find((item) => item[0] === selection)?.[1]();
        });
}

/**
 * Wrapper for vscode.window.showInformationMessage that resolves optional items to associated
 * callbacks.
 */
export async function showNotification(
    message: string,
    ...items: Array<[string, () => void]>
): Promise<void> {
    return vscode.window
        .showInformationMessage(`TestMyCode: ${message}`, ...items.map((item) => item[0]))
        .then((selection) => {
            items.find((item) => item[0] === selection)?.[1]();
        });
}

/**
 * Wrapper for vscode.window.showWarningMessage that resolves optional items to associated
 * callbacks.
 */
export async function showWarning(
    message: string,
    ...items: Array<[string, () => void]>
): Promise<void> {
    const items2 = items.length > 0 ? items : items.concat([["Ok", (): void => {}]]);
    return vscode.window
        .showWarningMessage(`TestMyCode: ${message}`, ...items2.map((item) => item[0]))
        .then((selection) => {
            items2.find((item) => item[0] === selection)?.[1]();
        });
}

/**
 * Wrapper for vscode.window.withProgress that can display the progress as a sum of several
 * simultaneous tasks. Like when using withProgress, tasks are expected to report of their progress
 * with positive increments that will sum up to 100. In addition, completed promises are handled
 * automatically.
 *
 * @param message Message bing displayed along the progress notification.
 * @param tasks Tasks that will be displayed as one single comprehensive progress.
 */
export async function showProgressNotification<T>(
    message: string,
    ...tasks: Array<(progress: vscode.Progress<{ increment: number }>) => Promise<T>>
): Promise<T[]> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "TestMyCode",
        },
        (progress) => {
            progress.report({ message: `${message} (0%)`, increment: 0 });

            let percentDone = 0;
            let increments = 0;
            const maxIncrements = 100 * tasks.length;

            return Promise.all(
                tasks.map(async (task) => {
                    let subIncrements = 0;

                    const report = (p: { increment: number }): void => {
                        increments += p.increment;
                        subIncrements += p.increment;
                        const oldPercentDone = percentDone;
                        percentDone = (increments * 100) / maxIncrements;
                        progress.report({
                            message: `${message} (${Math.floor(percentDone)}%)`,
                            increment: percentDone - oldPercentDone,
                        });
                    };

                    const result = await task({ report });
                    report({ increment: 100 - subIncrements });
                    return result;
                }),
            );
        },
    );
}

/**
 * Wraps increment-style `vscode.Progress` with a version that allows reporting direct percentages.
 * This is mostly useful when using `vscode.window.withProgress`.
 */
export const incrementPercentageWrapper: (
    progress: vscode.Progress<{ message?: string; increment: number }>,
) => vscode.Progress<{ message?: string; percent: number }> = (progress) => {
    let peak = 0;
    const report: (value: { message?: string; percent: number }) => void = ({
        message,
        percent,
    }) => {
        const increment = 100 * (percent - peak);
        if (increment > 0) {
            progress.report({ message, increment });
            peak = percent;
        }
    };

    return { report };
};

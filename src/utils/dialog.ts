import * as vscode from "vscode";

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
 * Prompts a selection to the user for multiple different options and returns its associated generic type.
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
 * Wrapper for vscode.window.showInformationMessage that resolves optional items to associated callbacks.
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

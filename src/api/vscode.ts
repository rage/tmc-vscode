import * as vscode from "vscode";

import Settings from "../config/settings";
import { Logger } from "../utils/logger";

/**
 * A Class for interacting with Visual Studio Code.
 */
export default class VSC {
    private readonly settings: Settings;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    public async activate(): Promise<void> {
        await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);
    }

    public getWorkspaceFile(): vscode.Uri | undefined {
        return vscode.workspace.workspaceFile;
    }

    public getExtensionVersion(extension: string): string | undefined {
        return vscode.extensions.getExtension(extension)?.packageJSON.version;
    }

    public getVSCodeVersion(): string {
        return vscode.version;
    }

    /**
     * Returns python executable path for ms-python.python extension.
     */
    private getPythonPath(document: vscode.TextDocument): string | undefined {
        try {
            const extension = vscode.extensions.getExtension("ms-python.python");
            if (!extension) {
                Logger.warn("Extension ms-python.python not found.");
                return undefined;
            }
            const usingNewInterpreterStorage =
                extension.packageJSON?.featureFlags?.usingNewInterpreterStorage;
            if (usingNewInterpreterStorage) {
                if (!extension.isActive) {
                    Logger.log("Python extension not active.");
                    return undefined;
                }
                // Support old and new python extension versions. vscode-python issue #11294
                const execCommand: string[] = extension.exports.settings.getExecutionDetails
                    ? extension.exports.settings.getExecutionDetails(document.uri).execCommand
                    : extension.exports.settings.getExecutionCommand(document.uri);
                return execCommand.join(" ");
            } else {
                return this.settings.getWorkspaceSettings()?.get<string>("python.pythonPath");
            }
        } catch (error) {
            Logger.error(error, "Some error while fetching python execution string");
            return undefined;
        }
    }

    /**
     * Get the active text editor and figure out the language ID
     * and the executable path from recommended extensions
     * If languageID not supported, returns undefined.
     */
    public getActiveEditorExecutablePath(): string | undefined {
        const resource = vscode.window.activeTextEditor;
        if (!resource) {
            return undefined;
        }
        Logger.log("Active text document language:", resource.document.languageId);
        switch (resource.document.languageId) {
            case "python":
                return this.getPythonPath(resource.document);
        }
        return undefined;
    }

    public openUri(uri: string): void {
        vscode.env.openExternal(vscode.Uri.parse(uri));
    }

    public toUri(uri: string): vscode.Uri {
        return vscode.Uri.file(uri);
    }
}

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
    return vscode.window
        .showErrorMessage(`TestMyCode: ${error}`, ...items.map((item) => item[0]))
        .then((selection) => {
            items.find((item) => item[0] === selection)?.[1]();
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

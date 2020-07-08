import * as vscode from "vscode";

import Settings from "../config/settings";
import Logger from "../utils/logger";

export default class VSCApi {
    private readonly settings: Settings;
    private logger: Logger;

    constructor(settings: Settings, logger: Logger) {
        this.logger = logger;
        this.settings = settings;
    }

    public async activate(): Promise<void> {
        await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);
    }

    public getExtensionVersion(extension: string): string | undefined {
        return vscode.extensions.getExtension(extension)?.packageJSON.version;
    }

    public getVSCodeVersion(): string {
        return vscode.version;
    }

    /**
     * Returns python executable for active text editor if open and python extension is active.
     * @param actionContext
     * @param document
     */
    private getPythonPath(document: vscode.TextDocument): string | undefined {
        try {
            const extension = vscode.extensions.getExtension("ms-python.python");
            if (!extension) {
                this.logger.warn("Extension ms-python.python not found.");
                return undefined;
            }
            const usingNewInterpreterStorage =
                extension.packageJSON?.featureFlags?.usingNewInterpreterStorage;
            if (usingNewInterpreterStorage) {
                if (!extension.isActive) {
                    this.logger.log("Python extension not active.");
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
            this.logger.error("Some error while fetching python execution string", error);
            return undefined;
        }
    }

    public getActiveEditorExecutablePath(): string | undefined {
        const resource = vscode.window.activeTextEditor;
        if (!resource) {
            return undefined;
        }
        this.logger.log("Active text document", resource.document);
        switch (resource.document.languageId) {
            case "python":
                this.logger.warn("Python");
                return this.getPythonPath(resource.document);
        }
        return undefined;
    }
}

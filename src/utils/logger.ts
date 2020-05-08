import { OutputChannel } from "vscode";
import * as vscode from "vscode";
import { OUTPUT_CHANNEL_NAME } from "../config/constants";
import { superfluousPropertiesEnabled } from ".";

export default class Logger {
    private output: OutputChannel;
    private productionMode: boolean;
    constructor() {
        this.output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        this.productionMode = superfluousPropertiesEnabled();
    }

    public log(message: string): void {
        if (this.productionMode) {
            this.output.appendLine(`${this.timestamp} INFO: ${message}`);
        } else {
            console.log(`${this.timestamp} - ${message}`);
        }
    }

    public error(message: string, type?: string): void {
        if (this.productionMode) {
            this.output.appendLine(`${this.timestamp} - ${type || "ERROR"}: ${message}`);
        } else {
            console.error(`${this.timestamp} - ${message}`);
        }
    }

    public show(): void {
        this.output.show(true);
    }

    /**
     * Wrapper for vscode.window.showErrorMessage that resolves optional items to associated callbacks.
     */
    public async showError(error: string, ...items: Array<[string, () => void]>): Promise<void> {
        this.error(error);
        return vscode.window
            .showErrorMessage(`TestMyCode: ${error}`, ...items.map((item) => item[0]))
            .then((selection) => {
                items.find((item) => item[0] === selection)?.[1]();
            });
    }

    private get timestamp(): string {
        const now = new Date();
        return `[${now
            .toISOString()
            .replace(/T/, " ")
            .replace(/\..+/, "")}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`;
    }
}

import { OutputChannel } from "vscode";
import * as vscode from "vscode";
import { OUTPUT_CHANNEL_NAME } from "../config/constants";
import { superfluousPropertiesEnabled } from ".";

export enum LogLevel {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
    Debug = "debug",
}
export default class Logger {
    private output: OutputChannel | undefined;
    private productionMode: boolean;
    // TODO: Get loglevel from settings
    private level: LogLevel = LogLevel.None;
    constructor() {
        this.productionMode = superfluousPropertiesEnabled();
        this.productionMode ? this.setLogLevel(this.level) : this.setLogLevel(LogLevel.Debug);
    }

    public log(message: string, ...params: unknown[]): void {
        if (this.level === LogLevel.None && this.productionMode) return;

        if (this.level === LogLevel.Debug) {
            console.log(`${this.timestamp} INFO: ${message} ${this.toLoggableParams(params)}`);
        }

        if (this.output && (this.level === LogLevel.Verbose || this.level === LogLevel.Debug)) {
            this.output.appendLine(
                `${this.timestamp} INFO: ${message} ${this.toLoggableParams(params)}`,
            );
        }
    }

    public error(message: string, ...params: unknown[]): void {
        if (this.level === LogLevel.None && this.productionMode) return;

        if (this.level === LogLevel.Debug) {
            console.error(`${this.timestamp} ERROR: ${message} ${this.toLoggableParams(params)}`);
        }

        if (this.output && this.level !== LogLevel.None) {
            this.output.appendLine(
                `${this.timestamp} ERROR: ${message} ${this.toLoggableParams(params)}`,
            );
        }
    }

    public warn(message: string, ...params: unknown[]): void {
        if (this.level === LogLevel.None && this.productionMode) return;

        if (this.level === LogLevel.Debug) {
            console.warn(`${this.timestamp} WARNING: ${message} ${this.toLoggableParams(params)}`);
        }

        if (this.output && (this.level === LogLevel.Verbose || this.level === LogLevel.Debug)) {
            this.output.appendLine(
                `${this.timestamp} WARNING: ${message} ${this.toLoggableParams(params)}`,
            );
        }
    }

    public show(): void {
        this.output ? this.output.show(true) : "";
    }

    public dispose(): void {
        if (this.output) {
            this.output.dispose();
            this.output = undefined;
        }
    }

    private toLoggableParams(params: unknown[]): string {
        if (params.length === 0) {
            return "";
        }
        const loggableParams = params.map((p) => this.toLoggable(p)).join(", ");
        return loggableParams.length !== 0 ? `\u2014 ${loggableParams}` : "";
    }

    private toLoggable(p: unknown): string {
        if (typeof p !== "object") {
            return String(p);
        }
        try {
            return JSON.stringify(p);
        } catch {
            return "<failed to log param to JSON>";
        }
    }

    private get timestamp(): string {
        const now = new Date();
        return `[${now
            .toISOString()
            .replace(/T/, " ")
            .replace(/\..+/, "")}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`;
    }

    private setLogLevel(value: LogLevel): void {
        this.level = value;
        if (value === LogLevel.None) {
            this.dispose();
        } else {
            this.output = this.output || vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        }
    }
}

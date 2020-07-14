import { OutputChannel, Uri, window } from "vscode";

import { DEBUG_MODE, OUTPUT_CHANNEL_NAME } from "../config/constants";

const emptyStr = "";

export enum LogLevel {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
    Debug = "debug",
}

const channel = `[${OUTPUT_CHANNEL_NAME}]`;

export class Logger {
    static output: OutputChannel | undefined;

    static configure(level: LogLevel): void {
        this.level = level;
    }

    private static _level: LogLevel = LogLevel.None;
    static get level(): LogLevel {
        return this._level;
    }
    static set level(value: LogLevel) {
        this._level = value;
        if (value === LogLevel.None) {
            if (this.output !== undefined) {
                this.output.dispose();
                this.output = undefined;
            }
        } else {
            this.output = this.output || window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        }
    }

    static debug(message: string | undefined, ...params: unknown[]): void {
        if (this.level !== LogLevel.Debug && !Logger.isDebugging) return;
        if (Logger.isDebugging) {
            console.log(this.timestamp, channel, message || emptyStr, ...params);
        }
        if (this.output !== undefined && this.level === LogLevel.Debug) {
            this.output.appendLine(
                `${this.timestamp} [DEBUG] ${message || emptyStr}${this.toLoggableParams(
                    true,
                    params,
                )}`,
            );
        }
    }

    static error(message?: string, ...params: unknown[]): void {
        if (this.level === LogLevel.None && !Logger.isDebugging) return;

        if (Logger.isDebugging) {
            console.error(this.timestamp, channel, message || emptyStr, ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.None) {
            this.output.appendLine(
                `${this.timestamp} [ERROR] ${message || emptyStr}${this.toLoggableParams(
                    false,
                    params,
                )}`,
            );
        }
    }

    static log(message: string, ...params: unknown[]): void {
        if (
            this.level !== LogLevel.Verbose &&
            this.level !== LogLevel.Debug &&
            !Logger.isDebugging
        ) {
            return;
        }

        if (Logger.isDebugging) {
            console.log(this.timestamp, channel, message || emptyStr, ...params);
        }

        if (
            this.output !== undefined &&
            (this.level === LogLevel.Verbose || this.level === LogLevel.Debug)
        ) {
            this.output.appendLine(
                `${this.timestamp} [INFO] ${message || emptyStr}${this.toLoggableParams(
                    false,
                    params,
                )}`,
            );
        }
    }

    static logWithDebugParams(message: string, ...params: unknown[]): void {
        if (
            this.level !== LogLevel.Verbose &&
            this.level !== LogLevel.Debug &&
            !Logger.isDebugging
        ) {
            return;
        }

        if (Logger.isDebugging) {
            console.log(this.timestamp, channel, message || emptyStr, ...params);
        }

        if (
            this.output !== undefined &&
            (this.level === LogLevel.Verbose || this.level === LogLevel.Debug)
        ) {
            this.output.appendLine(
                `${this.timestamp} [INFO] ${message || emptyStr}${this.toLoggableParams(
                    true,
                    params,
                )}`,
            );
        }
    }

    static warn(message: string, ...params: unknown[]): void {
        if (this.level === LogLevel.None && !Logger.isDebugging) return;

        if (Logger.isDebugging) {
            console.warn(this.timestamp, channel, message || emptyStr, ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.None) {
            this.output.appendLine(
                `${this.timestamp} [WARNING] ${message || emptyStr}${this.toLoggableParams(
                    false,
                    params,
                )}`,
            );
        }
    }

    static show(): void {
        if (this.output === undefined) {
            return;
        }
        this.output.show();
    }

    static toLoggable(p: unknown): string {
        if (typeof p !== "object") return String(p);
        if (p instanceof Uri) return `Uri(${p.toString(true)})`;

        try {
            return JSON.stringify(p);
        } catch {
            return "<error>";
        }
    }

    private static get timestamp(): string {
        const now = new Date();
        return `[${now
            .toISOString()
            .replace(/T/, " ")
            .replace(/\..+/, emptyStr)}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`;
    }

    private static toLoggableParams(debugOnly: boolean, params: unknown[]): string {
        if (
            params.length === 0 ||
            (debugOnly && this.level !== LogLevel.Debug && !Logger.isDebugging)
        ) {
            return emptyStr;
        }

        const loggableParams = params.map((p) => this.toLoggable(p)).join(", ");
        return loggableParams.length !== 0 ? ` \u2014 ${loggableParams}` : emptyStr;
    }

    private static _isDebugging: boolean | undefined;
    static get isDebugging(): boolean {
        if (this._isDebugging === undefined) {
            this._isDebugging = DEBUG_MODE;
        }

        return this._isDebugging;
    }
}

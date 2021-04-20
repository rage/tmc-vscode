import { OutputChannel, Uri, window } from "vscode";

import { DEBUG_MODE, OUTPUT_CHANNEL_NAME } from "../config/constants";

export enum LogLevel {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
}

const channel = `[${OUTPUT_CHANNEL_NAME}]`;

export class Logger {
    static output: OutputChannel | undefined;

    static configure(level?: LogLevel): void {
        this.level = level ?? LogLevel.Errors;
    }

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

    static debug(...params: unknown[]): void {
        if (DEBUG_MODE && this.output !== undefined) {
            console.log(this._timestamp, "[DEBUG]", ...params);
            this.output.appendLine(`${this._timestamp} [DEBUG] ${this._toLoggableParams(params)}`);
        }
    }

    static error(...params: unknown[]): void {
        if (this.level === LogLevel.None && !DEBUG_MODE) return;

        if (DEBUG_MODE) {
            console.error(this._timestamp, channel, ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.None) {
            this.output.appendLine(`${this._timestamp} [ERROR] ${this._toLoggableParams(params)}`);
        }
    }

    static log(...params: unknown[]): void {
        if (this.level !== LogLevel.Verbose && !DEBUG_MODE) {
            return;
        }

        if (DEBUG_MODE) {
            console.log(this._timestamp, channel, ...params);
        }

        if (this.output !== undefined && (this.level === LogLevel.Verbose || DEBUG_MODE)) {
            this.output.appendLine(`${this._timestamp} [INFO] ${this._toLoggableParams(params)}`);
        }
    }

    static warn(...params: unknown[]): void {
        if (this.level === LogLevel.None && !DEBUG_MODE) return;

        if (DEBUG_MODE) {
            console.warn(this._timestamp, channel, ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.None) {
            this.output.appendLine(
                `${this._timestamp} [WARNING] ${this._toLoggableParams(params)}`,
            );
        }
    }

    static show(): void {
        if (this.output === undefined) {
            return;
        }
        if (this.level !== LogLevel.None) {
            this.output.show();
        }
    }

    static toLoggable(p: unknown): string {
        if (p instanceof Error) return `${p.name} \u2014 ${p.message} \u2014 ${p.stack}`;
        if (typeof p !== "object") return String(p);
        if (p instanceof Uri) return `Uri(${p.toString(true)})`;

        try {
            return JSON.stringify(p);
        } catch {
            return "<error>";
        }
    }

    private static _level: LogLevel = LogLevel.None;

    private static get _timestamp(): string {
        const now = new Date();
        return `[${now
            .toISOString()
            .replace(/T/, " ")
            .replace(/\..+/, "")}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`;
    }

    private static _toLoggableParams(params: unknown[]): string {
        const loggableParams = params.map((p) => this.toLoggable(p)).join("\n");
        return loggableParams.length !== 0 ? loggableParams : "";
    }
}

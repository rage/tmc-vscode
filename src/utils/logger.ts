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

    static debug(...params: unknown[]): void {
        if (DEBUG_MODE && this.output !== undefined) {
            console.log(this.timestamp, "[DEBUG]", ...params);
            this.output.appendLine(`${this.timestamp} [DEBUG] ${this.toLoggableParams(params)}`);
        }
    }

    static error(...params: unknown[]): void {
        if (this.level === LogLevel.None && !DEBUG_MODE) return;

        if (DEBUG_MODE) {
            console.error(this.timestamp, channel, ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.None) {
            this.output.appendLine(`${this.timestamp} [ERROR] ${this.toLoggableParams(params)}`);
        }
    }

    static log(...params: unknown[]): void {
        if (this.level !== LogLevel.Verbose && !DEBUG_MODE) {
            return;
        }

        if (DEBUG_MODE) {
            console.log(this.timestamp, channel, ...params);
        }

        if (this.output !== undefined && (this.level === LogLevel.Verbose || DEBUG_MODE)) {
            this.output.appendLine(`${this.timestamp} [INFO] ${this.toLoggableParams(params)}`);
        }
    }

    static warn(...params: unknown[]): void {
        if (this.level === LogLevel.None && !DEBUG_MODE) return;

        if (DEBUG_MODE) {
            console.warn(this.timestamp, channel, ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.None) {
            this.output.appendLine(`${this.timestamp} [WARNING] ${this.toLoggableParams(params)}`);
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

    private static get timestamp(): string {
        const now = new Date();
        return `[${now
            .toISOString()
            .replace(/T/, " ")
            .replace(/\..+/, "")}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`;
    }

    private static toLoggableParams(params: unknown[]): string {
        const loggableParams = params.map((p) => this.toLoggable(p)).join("\n");
        return loggableParams.length !== 0 ? loggableParams : "";
    }
}

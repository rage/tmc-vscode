import { env } from "process";
import { OutputChannel, Uri, window } from "vscode";

import { DEBUG_MODE, OUTPUT_CHANNEL_NAME } from "../config/constants";

export enum LogLevel {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
}

enum ConsoleLogLevel {
    Debug = "DEBUG",
    Info = "INFO",
    Warn = "WARN",
    Error = "ERROR",
}

const channel = `[${OUTPUT_CHANNEL_NAME}]`;

export class Logger {
    static output: OutputChannel | undefined;
    static testmode: boolean = !!env["TMC_VSCODE_TESTMODE"];

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
        this._log(ConsoleLogLevel.Debug, ...params);
    }

    static info(...params: unknown[]): void {
        this._log(ConsoleLogLevel.Info, ...params);
    }

    static warn(...params: unknown[]): void {
        this._log(ConsoleLogLevel.Warn, ...params);
    }

    static error(...params: unknown[]): void {
        this._log(ConsoleLogLevel.Error, ...params);
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
        if (p instanceof Error) {
            return `${p.name} \u2014 ${p.message} \u2014 ${p.stack}`;
        }
        if (typeof p !== "object") {
            return String(p);
        }
        if (p instanceof Uri) {
            return `Uri(${p.toString(true)})`;
        }

        try {
            return JSON.stringify(p);
        } catch {
            return "<error>";
        }
    }

    private static _level: LogLevel = LogLevel.None;

    /**
     * Logs the params if the extension has been configured to log with this level.
     *
     * @param level The logging level.
     * @param params The things that should be logged.
     */
    private static _log(level: ConsoleLogLevel, ...params: unknown[]): void {
        if (DEBUG_MODE) {
            // in debug mode, we log to console with the appropriate level
            switch (level) {
                case "DEBUG": {
                    console.debug(this._timestamp, channel, ...params);
                    break;
                }
                case "INFO": {
                    console.info(this._timestamp, channel, ...params);
                    break;
                }
                case "WARN": {
                    console.warn(this._timestamp, channel, ...params);
                    break;
                }
                case "ERROR": {
                    console.error(this._timestamp, channel, ...params);
                    break;
                }
            }
        } else if (this.testmode) {
            console.log(this._timestamp, channel, ...params);
        }
        if (this.output !== undefined) {
            switch (this._level) {
                case LogLevel.None: {
                    // do not log anything
                    break;
                }
                case LogLevel.Errors: {
                    // only log warnings and errors
                    if (level === "WARN" || level === "ERROR") {
                        this._logToOutput(this.output, level, ...params);
                    }
                    break;
                }
                case LogLevel.Verbose: {
                    // log everything
                    this._logToOutput(this.output, level, ...params);
                    break;
                }
            }
        }
    }

    /**
     * Logs the output channel with the
     *
     * @param output Output channel to log to.
     * @param level The logging level. Doesn't check the logging config.
     * @param params The parameters to be logged.
     */
    private static _logToOutput(
        output: OutputChannel,
        level: ConsoleLogLevel,
        ...params: unknown[]
    ): void {
        output.appendLine(`${this._timestamp} [${level}] ${this._toLoggableParams(params)}`);
    }

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

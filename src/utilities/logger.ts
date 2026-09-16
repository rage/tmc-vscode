import { env } from "process"

import type { OutputChannel } from "vscode"
import { Uri, window } from "vscode"

import type Dialog from "../api/dialog"
import { DEBUG_MODE, OUTPUT_CHANNEL_NAME } from "../config/constants"
import { BaseError } from "../shared/shared"

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

const channel = `[${OUTPUT_CHANNEL_NAME}]`

// Key names whose values must never reach the output channel: users are asked to paste it
// into bug reports, and an OAuth token or a completed device-flow URL in it is a live
// credential. Matched with separators and case removed, so `access_token`, `accessToken`
// and `ACCESS-TOKEN` all hit.
const SECRET_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "authorization",
  "clientsecret",
  "secret",
  "password",
  "devicecode",
  "usercode",
  "verificationuricomplete",
])

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.replaceAll(/[-_\s]/g, "").toLowerCase())
}

export class Logger {
  public static output: OutputChannel | undefined
  public static testmode = !!env["TMC_VSCODE_TESTMODE"]

  public static configure(level?: LogLevel): void {
    this.level = level ?? LogLevel.Errors
  }

  public static get level(): LogLevel {
    return this._level
  }

  public static set level(value: LogLevel) {
    this._level = value
    if (value === LogLevel.None) {
      this.dispose()
    } else {
      this.output = this.output || window.createOutputChannel(OUTPUT_CHANNEL_NAME)
    }
  }

  public static debug(...params: unknown[]): void {
    this._log(ConsoleLogLevel.Debug, ...params)
  }

  public static info(...params: unknown[]): void {
    this._log(ConsoleLogLevel.Info, ...params)
  }

  public static warn(...params: unknown[]): void {
    this._log(ConsoleLogLevel.Warn, ...params)
  }

  public static error(...params: unknown[]): void {
    this._log(ConsoleLogLevel.Error, ...params)
  }

  /**
   * Writes a line to the output channel whatever log level is configured, for the
   * activation banner users are asked to paste into bug reports.
   *
   * Pass only facts that carry no credential: this deliberately skips the level check
   * that keeps CLI responses, and the OAuth tokens in them, out of the channel. The
   * `none` level still silences it.
   */
  public static banner(...params: unknown[]): void {
    this._write(ConsoleLogLevel.Info, this._level !== LogLevel.None, params)
  }

  public static errorWithDialog(dialog: Dialog, ...params: unknown[]): void {
    const loggable = this._toLoggableParams(params)
    dialog.errorNotification(loggable)
    this._log(ConsoleLogLevel.Error, ...params)
  }

  /**
   * Reveals the output channel, creating one to explain itself if logging is off.
   *
   * `none` disposes the channel, so every "Show logs" affordance would otherwise do
   * nothing at all — including the one offered next to a fatal activation error.
   */
  public static show(): void {
    if (this.output === undefined) {
      this.output = window.createOutputChannel(OUTPUT_CHANNEL_NAME)
      this.output.appendLine(
        `Nothing is being logged: testMyCode.logLevel is "${LogLevel.None}". ` +
          `Set it to "${LogLevel.Errors}" or "${LogLevel.Verbose}" and reproduce the problem.`,
      )
    }
    this.output.show()
  }

  /** Closes the output channel; `show()` or a non-`none` level creates a fresh one. */
  public static dispose(): void {
    this.output?.dispose()
    this.output = undefined
  }

  public static toLoggable(p: unknown): string {
    if (p instanceof Error) {
      return formatError(p, this._level)
    }
    if (typeof p === "function") {
      return `[Function ${p.name || "anonymous"}]`
    }
    if (typeof p !== "object") {
      return String(p)
    }
    if (p instanceof Uri) {
      return `Uri(${p.toString(true)})`
    }

    try {
      return JSON.stringify(p, (key, value) => (isSecretKey(key) ? "<redacted>" : value))
    } catch {
      return "<error>"
    }
  }

  private static _level: LogLevel = LogLevel.None

  /**
   * Logs the params if the extension has been configured to log with this level.
   *
   * @param level The logging level.
   * @param params The things that should be logged.
   */
  private static _log(level: ConsoleLogLevel, ...params: unknown[]): void {
    this._write(level, this._channelKeeps(level), params)
  }

  /** @param toOutput Whether the line reaches the channel, already weighed against the level. */
  private static _write(level: ConsoleLogLevel, toOutput: boolean, params: unknown[]): void {
    if (DEBUG_MODE) {
      // in debug mode, we log to console with the appropriate level
      const loggableParams = this._toLoggableParams(params)
      switch (level) {
        case ConsoleLogLevel.Debug: {
          console.debug(this._timestamp, channel, loggableParams)
          break
        }
        case ConsoleLogLevel.Info: {
          console.info(this._timestamp, channel, loggableParams)
          break
        }
        case ConsoleLogLevel.Warn: {
          console.warn(this._timestamp, channel, loggableParams)
          break
        }
        case ConsoleLogLevel.Error: {
          console.error(this._timestamp, channel, loggableParams)
          break
        }
      }
    } else if (this.testmode) {
      console.log(this._timestamp, channel, this._toLoggableParams(params))
    }
    if (toOutput && this.output !== undefined) {
      this._logToOutput(this.output, level, ...params)
    }
  }

  private static _channelKeeps(level: ConsoleLogLevel): boolean {
    switch (this._level) {
      case LogLevel.None: {
        return false
      }
      case LogLevel.Errors: {
        return level === ConsoleLogLevel.Warn || level === ConsoleLogLevel.Error
      }
      case LogLevel.Verbose: {
        return true
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
    output.appendLine(`${this._timestamp} [${level}] ${this._toLoggableParams(params)}`)
  }

  private static get _timestamp(): string {
    const now = new Date()
    return `[${now
      .toISOString()
      .replace(/T/, " ")
      .replace(/\..+/, "")}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`
  }

  private static _toLoggableParams(params: unknown[]): string {
    const loggableParams = params.map((p) => this.toLoggable(p)).join("\n")
    return loggableParams.length > 0 ? loggableParams : ""
  }
}

// A cause chain can be cyclic; `BaseError` copies whatever it was handed.
const MAX_CAUSE_DEPTH = 8

function formatError(error: Error, level: LogLevel, depth = 0): string {
  if (error instanceof BaseError) {
    let errorMessage = ""
    if (error.errno) {
      errorMessage += `[${error.errno}] `
    }
    if (error.code) {
      errorMessage += `(${error.code}) `
    }
    if (error.syscall) {
      errorMessage += `\`${error.syscall}\` `
    }
    if (error.path) {
      errorMessage += `@${error.path} `
    }
    errorMessage += `${error.name}: ${error.message}.`
    if (error.details) {
      errorMessage += ` ${error.details}.`
    }
    if (error.cause) {
      if (typeof error.cause === "string") {
        errorMessage += ` ${error.cause}.`
      } else if (depth >= MAX_CAUSE_DEPTH) {
        errorMessage += " Caused by: {...}."
      } else {
        const cause = formatError(error.cause, level, depth + 1)
        errorMessage += ` Caused by: {${cause}}.`
      }
    }
    if (error.stack && level === LogLevel.Verbose) {
      errorMessage += `\n<TRACE>\n${error.stack}\n</TRACE>`
    }
    return errorMessage
  }
  let errorMessage = `${error.name}: ${error.message}.`
  if (error.cause) {
    errorMessage += ` ${error.cause}.`
  }
  if (error.stack && level === LogLevel.Verbose) {
    errorMessage += `\n<TRACE>\n${error.stack}\n</TRACE>`
  }
  return errorMessage
}

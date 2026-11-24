import * as os from "os"
import { env } from "process"

import * as _ from "lodash"
import type { OutputChannel } from "vscode"
import { Uri, window } from "vscode"

import { asSentence, BaseError } from "../../shared/lib"
import { DEBUG_MODE, OUTPUT_CHANNEL_NAME } from "../config/constants"

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

const TAIL_MAX_LINES = 300
const TAIL_MAX_CHARS = 64 * 1024
// One CLI trace must not push every other line out of the tail.
const TAIL_LINE_MAX_CHARS = 8 * 1024

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

/**
 * `url` with its query and fragment replaced, for logging a URL that may carry a credential
 * such as the device-flow user code: redaction by key cannot see inside a message string.
 */
export function redactUrlQuery(url: string): string {
  return url.replace(/[?#].*$/s, "?<redacted>")
}

const SECRET_KEY_PATTERN = [...SECRET_KEYS]
  .map((key) => key.replaceAll(/token|code|secret|uri|complete/g, "[-_\\s]?$&"))
  .join("|")
// A secret key, its separator in JSON, YAML, a header or a query, and the value after it.
const KEYED_SECRET = new RegExp(`\\b(${SECRET_KEY_PATTERN})("?\\s*[:=]\\s*"?)([^\\s",&;}]+)`, "gi")
// A plain word after "token: " is prose, as in "the access token: host is not trusted".
const PROSE_WORD = /^[A-Za-z]{1,19}$/
const BEARER = /\bBearer\s+[^\s",;]+/gi
const URL_WITH_QUERY = /\b(https?:\/\/[^\s?#"'<>]+)([?#][^\s"'<>]*)/gi
// Student output prints URLs too; only a query that may carry a credential goes.
const SECRET_QUERY = new RegExp(`${SECRET_KEY_PATTERN}|code|state|key`, "i")
// courses.mooc.fi tokens are 64 alphanumerics; mixed case and a digit keep hex digests,
// UUIDs and ordinary words out.
const BARE_TOKEN =
  /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g
// A device-flow user code: two groups of four Crockford base32 characters, after the word
// "code"; elsewhere the shape is as likely an identifier in a student's output.
const USER_CODE = /(?<=\b[Cc]ode\W{1,3})[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}(?![\w-])/g

/**
 * `text` with the credentials free-form output may carry replaced: OAuth tokens, bearer
 * headers, device-flow codes and URL queries. For output nobody structured, such as a CLI's
 * stderr; structured values are redacted by key in {@link Logger.toLoggable}.
 */
export function redactSecrets(text: string): string {
  return text
    .replaceAll(URL_WITH_QUERY, (url, base: string, query: string) =>
      SECRET_QUERY.test(query) ? `${base}?<redacted>` : url,
    )
    .replaceAll(BEARER, "Bearer <redacted>")
    .replaceAll(KEYED_SECRET, (keyed, key: string, separator: string, value: string) =>
      /\s/.test(separator) && !separator.includes('"') && PROSE_WORD.test(value)
        ? keyed
        : `${key}${separator}<redacted>`,
    )
    .replaceAll(BARE_TOKEN, "<redacted>")
    .replaceAll(USER_CODE, "<redacted>")
}

let redactedExtensionStorage: string | undefined

/** Sets the extension's storage directory, which {@link redactPersonalInfo} shortens. */
export function setRedactedExtensionStorage(directory: string | undefined): void {
  redactedExtensionStorage = directory
}

/**
 * `text` with the extension's storage directory written as `<extension storage>`, the home
 * directory as `~` (`%USERPROFILE%` on Windows) and the OS username replaced, for what a student
 * may screenshot or paste into a bug report.
 */
export function redactPersonalInfo(
  text: string,
  home = os.homedir(),
  username = currentUsername(),
  isWindows = process.platform === "win32",
  extensionStorage = redactedExtensionStorage,
): string {
  // A path in a file URI is percent-encoded, which would hide the name from the patterns below.
  let redacted = text.replaceAll(/file:\/\/[^\s"'<>]+/g, (uri) => {
    try {
      return decodeURIComponent(uri)
    } catch {
      return uri
    }
  })
  // First, as it may lie in the home.
  if (extensionStorage !== undefined) {
    redacted = replaceDirectory(redacted, extensionStorage, "<extension storage>", isWindows)
  }
  redacted = replaceDirectory(redacted, home, isWindows ? "%USERPROFILE%" : "~", isWindows)
  if (isWindows) {
    // The 8.3 short form of a profile folder, such as C:\Users\JOHNSM~1, still names the user.
    redacted = redacted.replaceAll(/[a-z]:[\\/]+Users[\\/]+[^\\/\s~]{1,6}~\d+/gi, "%USERPROFILE%")
  }
  // A name this short would match inside ordinary words.
  if (username && username.length >= 3) {
    const userPattern = new RegExp(
      `(?<![\\w.-])${_.escapeRegExp(username)}(?![\\w-])`,
      isWindows ? "gi" : "g",
    )
    redacted = redacted.replace(userPattern, "<user>")
  }
  return redacted
}

/** `text` with `directory` written as `replacement`, in each separator it may be spelled with. */
function replaceDirectory(
  text: string,
  directory: string,
  replacement: string,
  isWindows: boolean,
): string {
  if (directory.length <= 1) {
    return text
  }
  const separators = isWindows ? ["\\", "/", "\\\\"] : ["/"]
  const spellings = _.uniq(
    separators.map((separator) => directory.split(/[\\/]/).join(separator)),
  ).map((spelling) => _.escapeRegExp(spelling))
  // Not a longer name that starts with the directory's, such as /home/al for /home/alice.
  const pattern = new RegExp(`(?:${spellings.join("|")})(?![\\w.-])`, isWindows ? "gi" : "g")
  return text.replace(pattern, replacement)
}

function currentUsername(): string | undefined {
  try {
    return os.userInfo().username
  } catch {
    // A directory-service account may have no passwd entry.
    return env["USER"] ?? env["USERNAME"]
  }
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

  /**
   * Reveals the output channel, creating one to explain itself if logging is off.
   *
   * `none` disposes the channel, so "Show Logs" would otherwise do nothing, even next to a
   * fatal activation error.
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

  /**
   * The latest info, warning and error lines, oldest first, whatever the configured level: what
   * an error's Show Details screen shows of the log. Kept in memory only, with credentials, the
   * home directory and the OS username redacted.
   */
  public static tail(): string {
    return redactPersonalInfo(this._tail.join("\n"))
  }

  /** Closes the output channel; `show()` or a non-`none` level creates a fresh one. */
  public static dispose(): void {
    this.output?.dispose()
    this.output = undefined
  }

  public static toLoggable(p: unknown): string {
    if (p instanceof Error) {
      return formatError(p, this._level === LogLevel.Verbose)
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

  private static readonly _tail: string[] = []
  private static _tailChars = 0

  /** Logs `params` at `level` if the configured log level allows it. */
  private static _log(level: ConsoleLogLevel, ...params: unknown[]): void {
    this._write(level, this._channelKeeps(level), params)
  }

  /** @param toOutput Whether the line reaches the channel, already weighed against the level. */
  private static _write(level: ConsoleLogLevel, toOutput: boolean, params: unknown[]): void {
    if (DEBUG_MODE) {
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
    const isTailed = level !== ConsoleLogLevel.Debug
    if ((toOutput && this.output !== undefined) || isTailed) {
      const line = `${this._timestamp} [${level}] ${this._toLoggableParams(params)}`
      if (toOutput) {
        // Students are told to attach this log to public bug reports.
        this.output?.appendLine(redactPersonalInfo(redactSecrets(line)))
      }
      if (isTailed) {
        this._appendToTail(line)
      }
    }
  }

  private static _appendToTail(line: string): void {
    const redacted = redactSecrets(line)
    const kept =
      redacted.length > TAIL_LINE_MAX_CHARS
        ? `${redacted.slice(0, TAIL_LINE_MAX_CHARS)}…`
        : redacted
    this._tail.push(kept)
    this._tailChars += kept.length
    while (this._tail.length > TAIL_MAX_LINES || this._tailChars > TAIL_MAX_CHARS) {
      this._tailChars -= this._tail.shift()?.length ?? 0
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

function formatError(error: Error, withStack: boolean, depth = 0): string {
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
    errorMessage += `${error.name}: ${asSentence(error.message)}`
    if (error.details) {
      errorMessage += ` ${asSentence(error.details)}`
    }
    if (error.cause) {
      if (typeof error.cause === "string") {
        errorMessage += ` ${asSentence(error.cause)}`
      } else if (depth >= MAX_CAUSE_DEPTH) {
        errorMessage += " Caused by: {...}."
      } else {
        const cause = formatError(error.cause, withStack, depth + 1)
        errorMessage += ` Caused by: {${cause}}.`
      }
    }
    if (error.stack && withStack) {
      errorMessage += `\n<TRACE>\n${error.stack}\n</TRACE>`
    }
    return errorMessage
  }
  let errorMessage = `${error.name}: ${error.message}.`
  if (error.cause) {
    errorMessage += ` ${error.cause}.`
  }
  if (error.stack && withStack) {
    errorMessage += `\n<TRACE>\n${error.stack}\n</TRACE>`
  }
  return errorMessage
}

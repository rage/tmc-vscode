import * as os from "os"
import * as path from "path"

import type { Mock } from "vitest"
import { onTestFinished } from "vitest"
import type { OutputChannel } from "vscode"
import { window } from "vscode"

import { BaseError } from "../../../shared/lib"
import {
  Logger,
  LogLevel,
  redactPersonalInfo,
  setRedactedExtensionStorage,
  redactSecrets,
  redactUrlQuery,
} from "../../utilities/logger"

const TOKEN = "super-secret-refresh-token"

suite("Logger redaction", function () {
  test("an OAuth token is not loggable under any spelling of its key", function () {
    const loggable = Logger.toLoggable({
      access_token: TOKEN,
      refreshToken: TOKEN,
      "ID-Token": TOKEN,
      token: TOKEN,
      client_secret: TOKEN,
      password: TOKEN,
    })
    expect(loggable).not.toContain(TOKEN)
    expect(loggable).toContain("access_token")
  })

  test("the device-flow codes and the completed verification url are not loggable", function () {
    const loggable = Logger.toLoggable({
      userCode: "ABCD-EFGH",
      verificationUri: "https://courses.mooc.fi/oauth_device",
      verificationUriComplete: `https://courses.mooc.fi/oauth_device?user_code=ABCD-EFGH`,
      verification_uri_complete: `https://courses.mooc.fi/oauth_device?user_code=ABCD-EFGH`,
      device_code: TOKEN,
    })
    expect(loggable).not.toContain("ABCD-EFGH")
    expect(loggable).not.toContain(TOKEN)
    // The bare verification URL is what the user is told to open, and carries no code.
    expect(loggable).toContain("https://courses.mooc.fi/oauth_device")
  })

  test("a url logged inside a message loses its query, user code included", function () {
    expect(redactUrlQuery("http://project-331.local/oauth_device?user_code=2X9D-VPMW")).toBe(
      "http://project-331.local/oauth_device?<redacted>",
    )
    expect(redactUrlQuery("https://courses.mooc.fi/oauth_device")).toBe(
      "https://courses.mooc.fi/oauth_device",
    )
  })

  test("free-form output loses its tokens, device codes and url queries", function () {
    const accessToken = "Qx7mZ2pL9vR4tY8wK3nB6cF1hJ5dS0aGeUoIiPlMkNjHbVgCfXdZsAqWeRtYuIo1"
    const output = [
      `refreshing with token ${accessToken}`,
      "Authorization: Bearer abc.def-ghi",
      '{"access_token":"short1","refresh-token": "short2"}',
      "user_code=2X9D-VPMW device code 7KQM-PRZT",
      "GET http://project-331.local/oauth_device?user_code=2X9D-VPMW failed",
    ].join("\n")

    const redacted = redactSecrets(output)

    for (const secret of [
      accessToken,
      "abc.def-ghi",
      "short1",
      "short2",
      "2X9D-VPMW",
      "7KQM-PRZT",
    ]) {
      expect(redacted).not.toContain(secret)
    }
    expect(redacted).toContain("http://project-331.local/oauth_device?<redacted>")
  })

  test("free-form output keeps what reads like an identifier, not a credential", function () {
    const output = [
      "not authenticating with http://localhost:4999/ using the courses.mooc.fi access token: host is not trusted with it",
      "expected ABCD-EFGH but got ABCD-EFGJ",
      "see https://example.com/search?q=python for more",
      "exercise 3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
      "sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "at 2026-11-13 in /home/student/mooc/part-01/src/Main.java",
      "Error occurred during initialization of VM",
    ].join("\n")

    expect(redactSecrets(output)).toBe(output)
  })

  test("a logged error reads as sentences, with no doubled full stop", function () {
    const loggable = Logger.toLoggable(
      new BaseError("Show the logs.", "HTTP error 404 Not Found for http://x/files."),
    )

    expect(loggable).toContain("Show the logs. HTTP error 404 Not Found for http://x/files.")
    expect(loggable).not.toContain("..")
  })

  test("a secret nested in an array or a child object is still redacted", function () {
    const loggable = Logger.toLoggable({
      credentials: [{ access_token: TOKEN }],
      nested: { deeper: { refresh_token: TOKEN } },
    })
    expect(loggable).not.toContain(TOKEN)
  })

  test("everything that is not a secret survives", function () {
    const loggable = Logger.toLoggable({
      token_type: "bearer",
      scope: "exercise-services",
      message: "logged in",
    })
    expect(loggable).toContain("bearer")
    expect(loggable).toContain("exercise-services")
    expect(loggable).toContain("logged in")
  })

  test("a function is named, not dumped in full", function () {
    function namedHelper(): string {
      return TOKEN
    }

    expect(Logger.toLoggable(namedHelper)).toBe("[Function namedHelper]")
  })

  test("a cause chain that loops back on itself terminates", function () {
    const outer = new BaseError("outer")
    const inner = new BaseError("inner")
    outer.cause = inner
    inner.cause = outer

    expect(Logger.toLoggable(outer)).toContain("{...}")
  })

  test("a value that cannot be serialized does not throw", function () {
    const circular: Record<string, unknown> = { access_token: TOKEN }
    circular.self = circular
    expect(Logger.toLoggable(circular)).toBe("<error>")
  })
})

suite("Logger output channel", function () {
  let lines: string[]

  function captureChannel(level: LogLevel): void {
    lines = []
    Logger.output = {
      appendLine: (line: string) => lines.push(line),
      dispose: () => {},
    } as unknown as OutputChannel
    Logger.configure(level)
  }

  afterEach(function () {
    Logger.configure(LogLevel.None)
    Logger.output = undefined
  })

  // The banner names the VS Code and extension versions and the workspace, which makes a
  // pasted log answerable; `errors` is the default level.
  test("the activation banner reaches the channel at the default level", function () {
    captureChannel(LogLevel.Errors)

    Logger.banner("TestMyCode version: 3.0.0")

    expect(lines.join("\n")).toContain("TestMyCode version: 3.0.0")
  })

  test("ordinary info is still withheld at the default level", function () {
    captureChannel(LogLevel.Errors)

    Logger.info("logged in as someone")

    expect(lines).toHaveLength(0)
  })

  test("the banner is written once, not twice, when everything is logged", function () {
    captureChannel(LogLevel.Verbose)

    Logger.banner("TestMyCode version: 3.0.0")

    expect(lines).toHaveLength(1)
  })

  test("logging turned off silences the banner too", function () {
    captureChannel(LogLevel.None)

    Logger.banner("TestMyCode version: 3.0.0")

    expect(lines).toHaveLength(0)
  })
})

suite("Logger reveal", function () {
  // The overloaded `createOutputChannel` resolves to its LogOutputChannel signature,
  // which the plain channel the Logger asks for does not satisfy.
  const createOutputChannel = window.createOutputChannel as unknown as Mock<
    (name: string) => OutputChannel
  >
  let lines: string[]
  let revealed: number

  beforeEach(function () {
    lines = []
    revealed = 0
    createOutputChannel.mockImplementation(
      () =>
        ({
          appendLine: (line: string) => lines.push(line),
          show: () => {
            revealed += 1
          },
          dispose: () => {},
        }) as unknown as OutputChannel,
    )
  })

  afterEach(function () {
    Logger.configure(LogLevel.None)
    Logger.output = undefined
    createOutputChannel.mockReset()
  })

  test("the logs open with an explanation when logging is turned off", function () {
    Logger.configure(LogLevel.None)

    Logger.show()

    expect(revealed).toBe(1)
    expect(lines.join("\n")).toContain("testMyCode.logLevel")
  })

  test("opening the logs while logging adds no explanation", function () {
    Logger.configure(LogLevel.Errors)

    Logger.show()

    expect(revealed).toBe(1)
    expect(lines).toHaveLength(0)
  })

  test("opening the logs does not start logging", function () {
    Logger.configure(LogLevel.None)
    Logger.show()
    lines.length = 0

    Logger.banner("TestMyCode version: 3.0.0")
    Logger.error("boom")

    expect(lines).toHaveLength(0)
  })
})

suite("Logger diagnostics", function () {
  afterEach(function () {
    Logger.configure(LogLevel.None)
    Logger.output = undefined
  })

  test("a logged error keeps its details and its stack", function () {
    Logger.configure(LogLevel.Verbose)
    const loggable = Logger.toLoggable(new BaseError(new Error("boom"), "exit status 1"))

    expect(loggable).toContain("exit status 1")
    expect(loggable).toContain("<TRACE>")
  })
})

suite("Logger tail", function () {
  afterEach(function () {
    Logger.configure(LogLevel.None)
  })

  test("keeps info, warnings and errors whatever the channel keeps, but not debug", function () {
    Logger.configure(LogLevel.None)

    Logger.debug("tail-debug-line")
    Logger.info("tail-info-line")
    Logger.warn("tail-warn-line")
    Logger.error("tail-error-line")

    const tail = Logger.tail()
    expect(tail).not.toContain("tail-debug-line")
    expect(tail).toMatch(
      /\[INFO\] tail-info-line\n.*\[WARN\] tail-warn-line\n.*\[ERROR\] tail-error-line$/,
    )
  })

  test("leaves credentials out", function () {
    Logger.info(`Authorization: Bearer ${TOKEN}`)

    expect(Logger.tail()).not.toContain(TOKEN)
  })

  test("shortens the extension's storage directory, in the log as in its tail", function () {
    const lines: string[] = []
    Logger.output = {
      appendLine: (line: string) => lines.push(line),
      dispose: () => {},
    } as unknown as OutputChannel
    Logger.configure(LogLevel.Verbose)
    setRedactedExtensionStorage("/var/vscode/globalStorage/moocfi.test-my-code")
    onTestFinished(() => {
      setRedactedExtensionStorage(undefined)
      Logger.output = undefined
    })

    Logger.info("CLI at /var/vscode/globalStorage/moocfi.test-my-code/cli")

    expect(Logger.tail()).toContain("CLI at <extension storage>/cli")
    expect(Logger.tail()).not.toContain("/var/vscode/globalStorage")
    expect(lines.join("\n")).toContain("CLI at <extension storage>/cli")
  })

  test("names no user through a percent-encoded file URI or a Windows short path", function () {
    expect(redactPersonalInfo("file:///home/ann%20lee/x", "/home/ann lee", "annlee", false)).toBe(
      "file://~/x",
    )
    expect(
      redactPersonalInfo("at C:\\Users\\JOHNSM~1\\AppData", "C:\\Users\\John Smith", "john", true),
    ).toBe("at %USERPROFILE%\\AppData")
  })

  test("leaves the home directory out", function () {
    Logger.info(`Running ${path.join(os.homedir(), "tmc", "cli")}`)

    expect(Logger.tail()).not.toContain(os.homedir())
  })

  test("drops the oldest lines beyond its 300", function () {
    for (let line = 0; line < 400; line++) {
      Logger.info(`tail-line-${line}`)
    }

    const lines = Logger.tail().split("\n")
    expect(lines).toHaveLength(300)
    expect(lines[0]).toContain("tail-line-100")
    expect(lines.at(-1)).toContain("tail-line-399")
  })

  test("cuts a huge line short instead of letting it push everything else out", function () {
    Logger.info("tail-before-huge")
    Logger.error(`tail-huge ${"x".repeat(100_000)}`)

    const tail = Logger.tail()
    expect(tail).toContain("tail-before-huge")
    expect(tail.length).toBeLessThanOrEqual(64 * 1024)
    expect(tail.endsWith("…")).toBe(true)
  })
})

suite("redactPersonalInfo", function () {
  test("writes the home directory as ~, and the username elsewhere as <user>", function () {
    expect(
      redactPersonalInfo(
        "/home/alice/tmc/cli failed for alice; /home/alice2 and /home/al stay",
        "/home/alice",
        "alice",
        false,
      ),
    ).toBe("~/tmc/cli failed for <user>; /home/alice2 and /home/al stay")
  })

  test("leaves a word that contains the username alone", function () {
    expect(redactPersonalInfo("malice and alice-b", "/home/alice", "alice", false)).toBe(
      "malice and alice-b",
    )
  })

  test("finds a Windows home in any case and in either separator, and as escaped in JSON", function () {
    const text = 'C:\\Users\\Alice\\tmc, c:/users/alice/tmc, {"path":"C:\\\\Users\\\\Alice"}'

    expect(redactPersonalInfo(text, "C:\\Users\\Alice", "Alice", true)).toBe(
      '%USERPROFILE%\\tmc, %USERPROFILE%/tmc, {"path":"%USERPROFILE%"}',
    )
  })

  test("writes the extension's storage directory as <extension storage>, wherever it is", function () {
    const text =
      "spawn /var/vscode/User/globalStorage/moocfi.test-my-code/cli/tmc-langs-cli failed; " +
      "/home/alice/notes stays under ~"

    expect(
      redactPersonalInfo(
        text,
        "/home/alice",
        "alice",
        false,
        "/var/vscode/User/globalStorage/moocfi.test-my-code",
      ),
    ).toBe("spawn <extension storage>/cli/tmc-langs-cli failed; ~/notes stays under ~")
  })

  test("names the storage directory, not the home, of a storage directory in the home", function () {
    expect(
      redactPersonalInfo(
        "C:\\Users\\Alice\\AppData\\Code\\cli and c:/users/alice/appdata/code/cli",
        "C:\\Users\\Alice",
        "Alice",
        true,
        "C:\\Users\\Alice\\AppData\\Code",
      ),
    ).toBe("<extension storage>\\cli and <extension storage>/cli")
  })

  test("leaves a username too short to tell from a word", function () {
    expect(redactPersonalInfo("an error in al", "/home/al", "al", false)).toBe("an error in al")
  })
})

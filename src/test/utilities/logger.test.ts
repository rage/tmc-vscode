import type { OutputChannel } from "vscode"

import { Logger, LogLevel } from "../../utilities/logger"

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

  // The banner is what makes a pasted log answerable: it names the VS Code and
  // extension versions and the open workspace, and `errors` is the default level.
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

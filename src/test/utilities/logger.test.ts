import { Logger } from "../../utilities/logger"

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

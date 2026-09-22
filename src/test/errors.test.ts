import {
  InsufficientScopeError,
  NotEnrolledError,
  ObsoleteClientError,
  presentationFor,
  RuntimeError,
  UploadExpiredError,
} from "../errors"
import { Logger, LogLevel } from "../utilities/logger"

suite("presentationFor", function () {
  afterEach(function () {
    Logger.configure(LogLevel.None)
    Logger.output = undefined
  })

  test("an unmapped error is its own message with nothing to press", function () {
    const presentation = presentationFor(new RuntimeError("the CLI exited with 1"))

    expect(presentation.message).toBe("Runtime Error: the CLI exited with 1.")
    expect(presentation.actions).toEqual([])
  })

  test("a lost courses.mooc.fi scope offers the login command", function () {
    const presentation = presentationFor(new InsufficientScopeError("403 forbidden"))

    expect(presentation.message).toContain("Log in again to continue")
    expect(presentation.actions).toEqual([{ label: "Log in", command: "tmc.showMoocLogin" }])
  })

  test("a dropped enrollment names the backend to re-enroll on when the caller knows it", function () {
    const withBackend = presentationFor(new NotEnrolledError("not enrolled"), "tmc")
    const withoutBackend = presentationFor(new NotEnrolledError("not enrolled"))

    expect(withBackend.message).toContain("Enroll on the course again on TMC Server")
    expect(withoutBackend.message).toContain("Enroll on the course again,")
    expect(withoutBackend.message).not.toContain("TMC Server")
  })

  test("an expired upload and an obsolete client each state their own remedy", function () {
    expect(presentationFor(new UploadExpiredError("410 gone")).message).toContain("try again")
    expect(presentationFor(new ObsoleteClientError("too old")).message).toContain("out of date")
  })

  test("the sentence holds none of a CLI failure's diagnostics", function () {
    Logger.configure(LogLevel.Verbose)
    // What a langs failure attaches: the CLI's own backtrace, then the tail of the
    // process's stderr, which a long test run measures in kilobytes.
    const details = ["at tmc_langs::submit", "", "thread 'main' panicked", "note: run with…"].join(
      "\n",
    )
    const error = new RuntimeError(new Error("the CLI exited with 1"), details)
    error.cause = "EPIPE while writing the submission archive"

    const { message } = presentationFor(error)

    expect(error.stack).toBeTruthy()
    expect(message).toBe("Runtime Error: the CLI exited with 1.")
    for (const line of details.split("\n").filter(Boolean)) {
      expect(message).not.toContain(line)
    }
    expect(message).not.toContain("EPIPE")
    expect(message).not.toContain("<TRACE>")
  })
})

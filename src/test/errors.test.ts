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

  test("the sentence carries no stack trace even when everything is logged", function () {
    Logger.configure(LogLevel.Verbose)
    const error = new RuntimeError(new Error("boom"))

    expect(error.stack).toBeTruthy()
    expect(presentationFor(error).message).not.toContain("<TRACE>")
  })
})
